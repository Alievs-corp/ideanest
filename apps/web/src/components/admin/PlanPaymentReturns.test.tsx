import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  listUnappliedPlanPayments,
  recordPlanPaymentBankTransfer,
  refundPlanPaymentToCard,
  type UnappliedPlanPayment,
} from '../../lib/admin/plan-payment-refunds';
import { lookUpNames } from '../../lib/admin/directory';
import { ApiError } from '../../lib/api/problem';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { refundConsoleCopyFrom } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatMoney } from '../../lib/money';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { PlanPaymentReturns } from './PlanPaymentReturns';

/* Built from `messages/en.json` with the route's own builders; `src/test-copy.ts` says why. */
const COPY = refundConsoleCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);
const WORDS = COPY.planPayments;

vi.mock('../../lib/admin/plan-payment-refunds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/plan-payment-refunds')>()),
  listUnappliedPlanPayments: vi.fn(),
  refundPlanPaymentToCard: vi.fn(),
  recordPlanPaymentBankTransfer: vi.fn(),
}));

// `lookUpNames` and not `readDirectory`, for `console-identity.test.tsx`'s reason.
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const listMock = vi.mocked(listUnappliedPlanPayments);
const refundMock = vi.mocked(refundPlanPaymentToCard);
const recordMock = vi.mocked(recordPlanPaymentBankTransfer);
const namesMock = vi.mocked(lookUpNames);

const CREATOR = 'cccccccc-0000-4000-8000-000000000001';

function payment(overrides: Partial<UnappliedPlanPayment> = {}): UnappliedPlanPayment {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    subscriptionId: 'bbbbbbbb-0000-4000-8000-000000000001',
    accountId: CREATOR,
    amount: '19.00',
    currency: 'AZN',
    provider: 'PAYRIFF',
    providerTransactionId: 'ORDER-0001',
    paidAt: '2026-10-01T09:00:00Z',
    // Far ahead, so the window is open whatever day the suite runs on.
    cardRefundUntil: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

/** A second payment, past its window. */
const CLOSED = payment({
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  amount: '49.00',
  providerTransactionId: 'ORDER-0002',
  cardRefundUntil: '2020-01-01T00:00:00Z',
});

function show(
  payments: readonly UnappliedPlanPayment[],
  { canIssue = true, canOpenAccount = false }: { canIssue?: boolean; canOpenAccount?: boolean } = {},
) {
  listMock.mockResolvedValue({ payments: [...payments] });
  return render(<PlanPaymentReturns copy={COPY} canIssue={canIssue} canOpenAccount={canOpenAccount} />);
}

async function rowOf(order: string): Promise<HTMLElement> {
  const text = await screen.findByText(order);
  const row = text.closest('li');
  if (row === null) throw new Error(`no row for ${order}`);
  return row;
}

const amountOf = (value: string) => formatMoney({ amount: value, currency: 'AZN' });

beforeEach(() => {
  listMock.mockReset();
  refundMock.mockReset();
  recordMock.mockReset();
  namesMock.mockReset();
  namesMock.mockResolvedValue({ accounts: [], projects: [] });
});

describe('plan payments to return (#457)', () => {
  it('lists each payment with its amount, provider order, account and card window', async () => {
    show([payment(), CLOSED]);

    const open = await rowOf('ORDER-0001');
    expect(within(open).getByText(amountOf('19.00'))).toBeInTheDocument();
    // The provider as staff say it, not the service's constant.
    expect(within(open).getByText(/Payriff/)).toBeInTheDocument();
    expect(within(open).queryByText(/PAYRIFF/)).not.toBeInTheDocument();
    expect(within(open).getByText(/Refund to card until/)).toBeInTheDocument();
    expect(within(open).getByText(/Paid by/)).toBeInTheDocument();

    const closed = await rowOf('ORDER-0002');
    expect(within(closed).getByText(amountOf('49.00'))).toBeInTheDocument();
    expect(within(closed).getByText(/Card window closed on/)).toBeInTheDocument();
  });

  it('says so when there is nothing to return', async () => {
    show([]);

    expect(await screen.findByText(WORDS.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(WORDS.emptyBody)).toBeInTheDocument();
  });

  it('refunds to the card after asking, and takes the row off the list', async () => {
    const user = userEvent.setup();
    refundMock.mockResolvedValue(payment());
    show([payment(), CLOSED]);

    const row = await rowOf('ORDER-0001');
    await user.click(within(row).getByRole('button', { name: WORDS.refundToCard }));

    const confirm = within(row).getByRole('group', { name: WORDS.refundToCard });
    expect(
      within(confirm).getByText(
        fillPlaceholders(WORDS.confirmRefund, { amount: amountOf('19.00'), provider: 'Payriff' }),
      ),
    ).toBeInTheDocument();
    expect(refundMock).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: WORDS.confirmRefundAction }));

    expect(refundMock).toHaveBeenCalledWith(payment().id);
    expect(await screen.findByText(WORDS.refundedTitle)).toBeInTheDocument();
    expect(screen.queryByText('ORDER-0001')).not.toBeInTheDocument();
    expect(screen.getByText('ORDER-0002')).toBeInTheDocument();
  });

  it('does not offer the card refund past the window, and says why in words', async () => {
    show([CLOSED]);

    const row = await rowOf('ORDER-0002');
    expect(within(row).queryByRole('button', { name: WORDS.refundToCard })).not.toBeInTheDocument();
    expect(within(row).getByText(WORDS.cardClosedReason)).toBeInTheDocument();
    const bank = within(row).getByRole('button', { name: WORDS.recordBankTransfer });
    expect(bank).toBeEnabled();
    expect(bank).toHaveAccessibleDescription(WORDS.cardClosedReason);
  });

  it('turns the row to the bank-transfer form when the service says the window has closed', async () => {
    const user = userEvent.setup();
    refundMock.mockRejectedValue(new ApiError(409, { code: 'PLAN_REFUND_CARD_WINDOW_CLOSED', title: 'Closed' }));
    show([payment()]);

    const row = await rowOf('ORDER-0001');
    await user.click(within(row).getByRole('button', { name: WORDS.refundToCard }));
    await user.click(within(row).getByRole('button', { name: WORDS.confirmRefundAction }));

    expect(await within(row).findByRole('form', { name: WORDS.recordBankTransfer })).toBeInTheDocument();
    expect(within(row).getByText(WORDS.errors['PLAN_REFUND_CARD_WINDOW_CLOSED'] ?? '')).toBeInTheDocument();
    expect(screen.getByText('ORDER-0001')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: WORDS.cancel }));
    expect(within(row).queryByRole('button', { name: WORDS.refundToCard })).not.toBeInTheDocument();
  });

  it('keeps the bank transfer away from a payment whose card refund was never answered', async () => {
    show([payment({ cardRefundStartedAt: '2026-10-15T08:00:00Z' })]);

    const row = await rowOf('ORDER-0001');
    expect(within(row).getByText(WORDS.unconfirmedTitle)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.recordBankTransfer })).not.toBeInTheDocument();
    // Asking again is the way out: the service asks the provider before it sends anything.
    expect(within(row).getByRole('button', { name: WORDS.refundToCard })).toBeEnabled();
  });

  it('turns to the unconfirmed state when the provider does not answer a refund', async () => {
    const user = userEvent.setup();
    refundMock.mockRejectedValue(new ApiError(503, { code: 'PLAN_REFUND_UNCONFIRMED', title: 'Unconfirmed' }));
    show([payment()]);

    const row = await rowOf('ORDER-0001');
    await user.click(within(row).getByRole('button', { name: WORDS.refundToCard }));
    await user.click(within(row).getByRole('button', { name: WORDS.confirmRefundAction }));

    expect(await within(row).findByText(WORDS.errors['PLAN_REFUND_UNCONFIRMED'] ?? '')).toBeInTheDocument();
    expect(within(row).getByText(WORDS.unconfirmedTitle)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.recordBankTransfer })).not.toBeInTheDocument();
  });

  it('stops offering the transfer when the service says a card refund is unsettled', async () => {
    const user = userEvent.setup();
    recordMock.mockRejectedValue(new ApiError(409, { code: 'PLAN_REFUND_CARD_REFUND_UNSETTLED', title: 'Unsettled' }));
    show([CLOSED]);

    const row = await rowOf('ORDER-0002');
    await user.click(within(row).getByRole('button', { name: WORDS.recordBankTransfer }));
    const form = within(row).getByRole('form', { name: WORDS.recordBankTransfer });
    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), 'BANK-REF-78');
    await user.click(within(form).getByRole('button', { name: WORDS.recordBankTransfer }));
    await user.click(within(form).getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(await within(row).findByText(WORDS.unconfirmedTitle)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.recordBankTransfer })).not.toBeInTheDocument();
  });

  it('words a request the service rejected before any code ran, never in its English', async () => {
    const user = userEvent.setup();
    recordMock.mockRejectedValue(new ApiError(400, { status: 400, detail: 'Invalid request content.' }));
    show([CLOSED]);

    const row = await rowOf('ORDER-0002');
    await user.click(within(row).getByRole('button', { name: WORDS.recordBankTransfer }));
    const form = within(row).getByRole('form', { name: WORDS.recordBankTransfer });
    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), 'BANK-REF-79');
    await user.click(within(form).getByRole('button', { name: WORDS.recordBankTransfer }));
    await user.click(within(form).getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(await within(row).findByText(WORDS.errors['INVALID_REQUEST'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Invalid request content.')).not.toBeInTheDocument();
  });

  it('records a bank transfer with its reference and note after asking', async () => {
    const user = userEvent.setup();
    recordMock.mockResolvedValue(CLOSED);
    show([CLOSED]);

    const row = await rowOf('ORDER-0002');
    await user.click(within(row).getByRole('button', { name: WORDS.recordBankTransfer }));

    const form = within(row).getByRole('form', { name: WORDS.recordBankTransfer });
    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), 'BANK-REF-77');
    await user.type(within(form).getByLabelText(new RegExp(`^${WORDS.note}`)), 'Sent to the creator’s IBAN');
    await user.click(within(form).getByRole('button', { name: WORDS.recordBankTransfer }));

    const confirm = within(form).getByRole('group', { name: WORDS.recordBankTransfer });
    expect(
      within(confirm).getByText(
        fillPlaceholders(WORDS.confirmRecord, { amount: amountOf('49.00'), reference: 'BANK-REF-77' }),
      ),
    ).toBeInTheDocument();
    expect(recordMock).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith(CLOSED.id, {
      bankReference: 'BANK-REF-77',
      note: 'Sent to the creator’s IBAN',
    });
    expect(await screen.findByText(WORDS.recordedTitle)).toBeInTheDocument();
    expect(screen.queryByText('ORDER-0002')).not.toBeInTheDocument();
    expect(await screen.findByText(WORDS.emptyTitle)).toBeInTheDocument();
  });

  it('says a payment somebody else returned is already returned, and reads the list again', async () => {
    const user = userEvent.setup();
    refundMock.mockRejectedValue(new ApiError(409, { code: 'PLAN_REFUND_NOT_UNAPPLIED', title: 'Not unapplied' }));
    show([payment()]);

    const row = await rowOf('ORDER-0001');
    listMock.mockResolvedValue({ payments: [] });
    await user.click(within(row).getByRole('button', { name: WORDS.refundToCard }));
    await user.click(within(row).getByRole('button', { name: WORDS.confirmRefundAction }));

    expect(await screen.findByText(WORDS.alreadyReturnedTitle)).toBeInTheDocument();
    expect(screen.getByText(WORDS.errors['PLAN_REFUND_NOT_UNAPPLIED'] ?? '')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(WORDS.emptyTitle)).toBeInTheDocument();
  });

  it('words a provider refusal in the row and keeps it', async () => {
    const user = userEvent.setup();
    refundMock.mockRejectedValue(new ApiError(409, { code: 'PLAN_REFUND_PROVIDER_REFUSED', title: 'Refused' }));
    show([payment()]);

    const row = await rowOf('ORDER-0001');
    await user.click(within(row).getByRole('button', { name: WORDS.refundToCard }));
    await user.click(within(row).getByRole('button', { name: WORDS.confirmRefundAction }));

    expect(await within(row).findByText(WORDS.errors['PLAN_REFUND_PROVIDER_REFUSED'] ?? '')).toBeInTheDocument();
    expect(screen.getByText('ORDER-0001')).toBeInTheDocument();
  });

  it('offers no controls to a reader without ISSUE_REFUND', async () => {
    show([payment()], { canIssue: false });

    const row = await rowOf('ORDER-0001');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('links to the account page only for a reader who can open it', async () => {
    const { unmount } = show([payment()]);
    await rowOf('ORDER-0001');
    expect(screen.queryByRole('link', { name: /Open the account/ })).not.toBeInTheDocument();
    unmount();

    show([payment()], { canOpenAccount: true });
    const row = await rowOf('ORDER-0001');
    const link = within(row).getByRole('link', {
      name: fillPlaceholders(WORDS.openAccountLabel, { id: CREATOR.slice(0, 8) }),
    });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/admin/users/${CREATOR}`));
  });

  it('has no accessibility violations, with both windows and the bank form open', async () => {
    const user = userEvent.setup();
    const { container } = show([payment(), CLOSED], { canOpenAccount: true });

    const row = await rowOf('ORDER-0002');
    await user.click(within(row).getByRole('button', { name: WORDS.recordBankTransfer }));

    await expectNoViolations(container);
  });
});
