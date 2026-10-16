import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lookUpNames } from '../../lib/admin/directory';
import { readLedger, type LedgerPosting, type LedgerView } from '../../lib/admin/ledger';
import { LedgerExplorer } from './LedgerExplorer';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { ledgerExplorerCopyFrom } from '../../lib/i18n/admin/money-copy';

const ADMIN = translatorFor('admin');
const COPY = ledgerExplorerCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('../../lib/admin/ledger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/ledger')>()),
  readLedger: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const readMock = vi.mocked(readLedger);

const PROJECT_ID = '0199b7c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';

function posting(transactionId: string, amount = '100.00'): LedgerPosting {
  return {
    transactionId,
    projectId: PROJECT_ID,
    createdAt: '2026-10-15T12:03:56.120044Z',
    lines: [
      { account: 'escrow', direction: 'DEBIT', amount: { amount, currency: 'AZN' } },
      { account: 'platform_fee', direction: 'CREDIT', amount: { amount, currency: 'AZN' } },
    ],
    balanced: true,
  };
}

function view(postings: LedgerPosting[], nextCursor: number | null = null): LedgerView {
  return {
    postings,
    nextCursor,
    balances: [{ account: 'escrow', net: { amount: '1.00', currency: 'AZN' } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(view([posting('0199e3b0-0000-7a11-8b22-3c44d55e66f7')]));
  vi.mocked(lookUpNames).mockResolvedValue({ accounts: [], projects: [] });
});

describe('the ledger explorer', () => {
  it('never says nothing matches while there is a next page to read', async () => {
    readMock.mockResolvedValue(view([], 4812));

    render(<LedgerExplorer copy={COPY} />);

    expect(await screen.findByText(COPY.emptyPageMore)).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.filteredTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.loadMore })).toBeInTheDocument();
  });

  it('refuses a campaign that is not a UUID at the field, and sends nothing', async () => {
    render(<LedgerExplorer copy={COPY} />);
    await screen.findAllByText('100.00 AZN');
    const asked = readMock.mock.calls.length;

    await userEvent.type(screen.getByLabelText(COPY.campaignLabel), 'not-a-campaign');
    await userEvent.click(screen.getByRole('button', { name: COPY.apply }));

    expect(await screen.findByText(COPY.invalidId)).toBeInTheDocument();
    expect(readMock.mock.calls.length).toBe(asked);

    await userEvent.clear(screen.getByLabelText(COPY.campaignLabel));
    await userEvent.type(screen.getByLabelText(COPY.campaignLabel), PROJECT_ID);
    await userEvent.click(screen.getByRole('button', { name: COPY.apply }));
    await waitFor(() =>
      expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PROJECT_ID })),
    );
    expect(screen.queryByText(COPY.invalidId)).not.toBeInTheDocument();
  });

  it('drops a page that arrives after the account filter changed', async () => {
    readMock.mockResolvedValueOnce(view([posting('0199e3b0-0000-7a11-8b22-3c44d55e66f7')], 4812));
    render(<LedgerExplorer copy={COPY} />);
    await screen.findAllByText('100.00 AZN');

    let late: (value: LedgerView) => void = () => undefined;
    readMock.mockReturnValueOnce(new Promise<LedgerView>((resolve) => (late = resolve)));
    await userEvent.click(screen.getByRole('button', { name: COPY.loadMore }));

    readMock.mockResolvedValueOnce(view([posting('0199e100-abcd-7ef0-8123-456789abcdef', '25.00')]));
    await userEvent.click(screen.getByRole('button', { name: COPY.money.account['refunds'] as string }));
    await screen.findAllByText('25.00 AZN');

    await act(async () => late(view([posting('0199e3d4-1111-7222-8333-444455556666', '2310.40')], 4000)));

    expect(screen.queryByText('2310.40 AZN')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.loadMore })).not.toBeInTheDocument();
  });
});
