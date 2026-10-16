import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lookUpNames } from '../../lib/admin/directory';
import {
  readPaymentLog,
  type LoggedTransaction,
  type PaymentLogPage,
} from '../../lib/admin/payments';
import { PaymentLogView } from './PaymentLogView';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { paymentLogCopyFrom } from '../../lib/i18n/admin/money-copy';

/*
 * The copy is built from `messages/en.json` with the same builder the route calls — see
 * `src/test-copy.ts`. Every assertion reads its words from COPY.
 */
const ADMIN = translatorFor('admin');
const COPY = paymentLogCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('../../lib/admin/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/payments')>()),
  readPaymentLog: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const readMock = vi.mocked(readPaymentLog);

const PROJECT_ID = '0199b7c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';

function transaction(overrides: Partial<LoggedTransaction> = {}): LoggedTransaction {
  return {
    id: '0199e3a1-7c2b-7d41-9a3e-5b1f2c8d4e07',
    pledgeId: '0199d0f2-33aa-7b10-8e4c-1a2b3c4d5e6f',
    projectId: PROJECT_ID,
    type: 'CHARGE',
    status: 'SUCCEEDED',
    amount: { amount: '45.00', currency: 'AZN' },
    provider: 'PAYRIFF',
    providerTransactionId: '8f2c1e7a-0b9d-4c3e-a5f6-7d8e9f0a1b2c',
    attemptNumber: 1,
    createdAt: '2026-10-14T08:41:07.512334Z',
    ...overrides,
  };
}

function page(transactions: LoggedTransaction[], nextCursor: string | null = null): PaymentLogPage {
  return { transactions, nextCursor };
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(page([transaction()]));
  vi.mocked(lookUpNames).mockResolvedValue({ accounts: [], projects: [] });
});

describe('the identifier box', () => {
  it('refuses what is not a UUID at the field, in the reader’s words, and sends nothing', async () => {
    render(<PaymentLogView copy={COPY} />);
    await screen.findByText('45.00 AZN');
    const asked = readMock.mock.calls.length;

    const box = screen.getByLabelText(COPY.identifierLabel);
    await userEvent.type(box, 'abc');
    await userEvent.click(screen.getByRole('button', { name: COPY.search }));

    expect(await screen.findByText(COPY.invalidId)).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // Spring's own "Failed to convert 'projectId'" never gets the chance to appear.
    expect(readMock.mock.calls.length).toBe(asked);
  });

  it('sends a whole UUID, and asks again under the other scope when the radio changes', async () => {
    render(<PaymentLogView copy={COPY} />);
    await screen.findByText('45.00 AZN');

    await userEvent.type(screen.getByLabelText(COPY.identifierLabel), PROJECT_ID);
    await userEvent.click(screen.getByRole('button', { name: COPY.search }));
    await waitFor(() =>
      expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PROJECT_ID, pledgeId: null })),
    );

    // The results on screen must be about what the radio says was searched.
    await userEvent.click(screen.getByRole('radio', { name: COPY.scopePledge }));
    await waitFor(() =>
      expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ pledgeId: PROJECT_ID, projectId: null })),
    );
  });
});

describe('a row', () => {
  it('says a call without a reference may have reached the provider only when it did not succeed', async () => {
    readMock.mockResolvedValue(
      page([
        transaction({ id: 'a', type: 'REFUND', status: 'SUCCEEDED', providerTransactionId: null }),
        transaction({ id: 'b', status: 'FAILED', providerTransactionId: null, failureCode: 'provider_unreachable' }),
      ]),
    );

    render(<PaymentLogView copy={COPY} />);
    await screen.findAllByText('45.00 AZN');

    expect(screen.getAllByText(COPY.noReference)).toHaveLength(1);
    expect(screen.getAllByText(COPY.noReferenceSettled)).toHaveLength(1);
  });

  it('words a refusal the service wrote, and prints a provider’s own code beside a plain “refused”', async () => {
    readMock.mockResolvedValue(
      page([
        transaction({
          id: 'a',
          status: 'FAILED',
          failureCode: 'payment_failed',
          failureMessage: 'The provider reported the payment failed.',
        }),
        transaction({ id: 'b', status: 'FAILED', failureCode: '51', failureMessage: 'Insufficient funds' }),
      ]),
    );

    render(<PaymentLogView copy={COPY} />);
    await screen.findAllByText('45.00 AZN');

    expect(screen.getByText(COPY.failure['payment_failed'] as string)).toBeInTheDocument();
    const unknown = screen.getByText('51');
    expect(unknown.closest('p')).toHaveTextContent(COPY.failureUnknown);
    // The provider's English is kept for quoting, on the title, and not in the text.
    expect(unknown.closest('p')).toHaveAttribute('title', 'Insufficient funds');
    expect(screen.queryByText(/Insufficient funds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/payment_failed/)).not.toBeInTheDocument();
  });

  it('names the provider rather than printing the service’s enum', async () => {
    readMock.mockResolvedValue(page([transaction({ type: 'PAYOUT', provider: 'BANK_TRANSFER', pledgeId: null })]));

    render(<PaymentLogView copy={COPY} />);
    const row = (await screen.findByText('45.00 AZN')).closest('li') as HTMLElement;

    expect(within(row).getByText(COPY.provider.BANK_TRANSFER)).toBeInTheDocument();
    expect(within(row).queryByText('BANK_TRANSFER')).not.toBeInTheDocument();
    expect(within(row).getByText(COPY.type.PAYOUT)).toBeInTheDocument();
  });
});

describe('load more', () => {
  it('drops a page that arrives after the question changed', async () => {
    readMock.mockResolvedValueOnce(page([transaction({ id: 'first' })], 'cursor-1'));
    render(<PaymentLogView copy={COPY} />);
    await screen.findByText('45.00 AZN');

    let late: (value: PaymentLogPage) => void = () => undefined;
    readMock.mockReturnValueOnce(new Promise<PaymentLogPage>((resolve) => (late = resolve)));
    await userEvent.click(screen.getByRole('button', { name: COPY.loadMore }));

    // The reader narrows to failures while the next page of everything is still on its way.
    readMock.mockResolvedValueOnce(
      page([transaction({ id: 'failed', status: 'FAILED', amount: { amount: '7.00', currency: 'AZN' } })]),
    );
    await userEvent.click(screen.getByRole('button', { name: COPY.status.FAILED }));
    await screen.findByText('7.00 AZN');

    await act(async () =>
      late(page([transaction({ id: 'stale', amount: { amount: '99.00', currency: 'AZN' } })], 'cursor-2')),
    );

    expect(screen.queryByText('99.00 AZN')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.loadMore })).not.toBeInTheDocument();
  });
});
