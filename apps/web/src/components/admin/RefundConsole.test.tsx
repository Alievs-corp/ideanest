import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { issueRefund, listRefunds, readRefundable } from '../../lib/admin/refunds';
import type { Refund, RefundableAmount } from '../../lib/admin/refunds';
import { RefundConsole } from './RefundConsole';
import { formatDay } from './RefundBankTransfer';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { refundConsoleCopyFrom } from '../../lib/i18n/admin/money-copy';
import {
  recordRefundBankTransfer,
  revealRefundBankDetails,
  routeRefundToBankTransfer,
  todayInBaku,
} from '../../lib/admin/refund-bank-transfers';
import { ROLE_CAPABILITIES, type StaffMembership, type StaffRole } from '../../lib/admin/staff';
import { ApiError } from '../../lib/api/problem';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { capabilityLabel } from '../../lib/admin/refusals';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { raiseBackerTicket, type Ticket } from '../../lib/admin/tickets';
import { recordRefundBankDetails } from '../../lib/admin/refund-bank-details';

/* Built from `messages/en.json` with the route's own builders; `src/test-copy.ts` says why. */
const COPY = refundConsoleCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

/**
 * §4.11's AD-06 refund console, for #176: a refund the provider did not answer comes back
 * REQUESTED, and the banner has to say it settles on its own rather than read as a fault
 * somebody should retry.
 */

vi.mock('../../lib/admin/refunds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/refunds')>();
  return { ...actual, listRefunds: vi.fn(), issueRefund: vi.fn(), readRefundable: vi.fn() };
});

vi.mock('../../lib/admin/refund-bank-transfers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/refund-bank-transfers')>();
  return {
    ...actual,
    revealRefundBankDetails: vi.fn(),
    recordRefundBankTransfer: vi.fn(),
    routeRefundToBankTransfer: vi.fn(),
  };
});

vi.mock('../../lib/admin/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/tickets')>();
  return { ...actual, raiseBackerTicket: vi.fn() };
});

vi.mock('../../lib/admin/refund-bank-details', () => ({ recordRefundBankDetails: vi.fn() }));

/* #457's section reads its own list; `PlanPaymentReturns.test.tsx` covers it. Empty here. */
vi.mock('../../lib/admin/plan-payment-refunds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/plan-payment-refunds')>()),
  listUnappliedPlanPayments: vi.fn().mockResolvedValue({ payments: [] }),
}));

const listMock = vi.mocked(listRefunds);
const issueMock = vi.mocked(issueRefund);
const refundableMock = vi.mocked(readRefundable);
const revealMock = vi.mocked(revealRefundBankDetails);
const recordMock = vi.mocked(recordRefundBankTransfer);
const routeMock = vi.mocked(routeRefundToBankTransfer);

const PLEDGE = '11111111-2222-3333-4444-555555555555';
const OTHER_PLEDGE = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function refund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    pledgeId: PLEDGE,
    projectId: 'bbbbbbbb-0000-0000-0000-000000000001',
    amount: { amount: '25.00', currency: 'AZN' },
    fullRefund: true,
    reason: 'BACKER_REQUEST',
    detail: 'Asked by email',
    state: 'SUCCEEDED',
    requestedAt: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

function refundable(overrides: Partial<RefundableAmount> = {}): RefundableAmount {
  return {
    pledgeId: PLEDGE,
    reason: 'BACKER_REQUEST',
    remaining: { amount: '40.00', currency: 'AZN' },
    withheldFee: { amount: '0.00', currency: 'AZN' },
    projectId: 'bbbbbbbb-0000-0000-0000-000000000001',
    ...overrides,
  };
}

const ME = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const SUPPORT_PERSON = 'dddddddd-0000-4000-8000-000000000001';
const IBAN = 'AZ21NABZ00000000137010001944';

function reader(roles: readonly StaffRole[], accountId = ME): StaffMembership {
  const capabilities = new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]));
  return { accountId, staff: true, bootstrapped: false, roles: [...roles], capabilities: [...capabilities] };
}

function renderConsole(membership: StaffMembership = reader(['FINANCE'])) {
  return render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
      <RefundConsole copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

/** Fills the form and presses the first of the two buttons. */
async function fill(user: User, { pledge = PLEDGE, amount = '' }: { pledge?: string; amount?: string } = {}): Promise<void> {
  const field = await screen.findByPlaceholderText('00000000-0000-0000-0000-000000000000');
  await user.clear(field);
  await user.type(field, pledge);
  const amountField = screen.getByRole('textbox', { name: new RegExp(`^${COPY.amountLabel}`) });
  await user.clear(amountField);
  if (amount !== '') await user.type(amountField, amount);
  const note = screen.getByRole('textbox', { name: new RegExp(COPY.noteLabel, 'i') });
  if ((note as HTMLTextAreaElement).value === '') await user.type(note, 'Asked by email');
  await user.click(screen.getByRole('button', { name: COPY.issue }));
}

/** Fills, confirms. */
async function issue(user: User = userEvent.setup(), options: { pledge?: string; amount?: string } = {}): Promise<void> {
  renderConsole();
  await fill(user, options);
  await user.click(await screen.findByRole('button', { name: COPY.confirmAction }));
}

beforeEach(() => {
  listMock.mockReset();
  issueMock.mockReset();
  refundableMock.mockReset();
  listMock.mockResolvedValue({ refunds: [], page: 0, hasMore: false });
  refundableMock.mockResolvedValue(refundable());
});

describe('the refund console', () => {
  it('says an unanswered refund settles on its own and must not be issued again', async () => {
    issueMock.mockResolvedValue(refund({ state: 'REQUESTED' }));

    await issue();

    expect(await screen.findByText(new RegExp(COPY.awaitingProvider.slice(0, 40)))).toBeInTheDocument();
  });

  it('does not say so for a refund the provider confirmed', async () => {
    issueMock.mockResolvedValue(refund({ state: 'SUCCEEDED' }));

    await issue();

    expect(await screen.findByText(COPY.sentTitle)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(COPY.awaitingProvider.slice(0, 40)))).not.toBeInTheDocument();
  });

  it('offers the form only to a reader holding ISSUE_REFUND', async () => {
    renderConsole(reader(['MODERATOR']));

    expect(await screen.findByRole('heading', { name: COPY.logHeading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COPY.issueHeading })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.issue })).not.toBeInTheDocument();
  });

  it('asks before sending, naming everything left, the reason and the pledge', async () => {
    const user = userEvent.setup();
    issueMock.mockResolvedValue(refund());
    renderConsole();

    await fill(user);

    expect(refundableMock).toHaveBeenCalledWith(PLEDGE, 'BACKER_REQUEST');
    expect(issueMock).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('group', { name: COPY.confirmHeading });
    expect(confirm).toHaveTextContent(
      fillPlaceholders(COPY.allRemaining, { amount: formatMoney({ amount: '40.00', currency: 'AZN' }) }),
    );
    expect(confirm).toHaveTextContent(COPY.reason.BACKER_REQUEST);
    expect(confirm).toHaveTextContent(PLEDGE.slice(0, 8));

    await user.click(within(confirm).getByRole('button', { name: COPY.cancel }));
    expect(screen.queryByRole('group', { name: COPY.confirmHeading })).not.toBeInTheDocument();
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('sends a comma amount as a decimal string in the pledge’s own currency', async () => {
    const user = userEvent.setup();
    refundableMock.mockResolvedValue(refundable({ remaining: { amount: '40.00', currency: 'USD' } }));
    issueMock.mockResolvedValue(refund({ amount: { amount: '25.00', currency: 'USD' } }));

    await issue(user, { amount: '25,5' });

    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({ pledgeId: PLEDGE, amount: { amount: '25.50', currency: 'USD' } }),
    );
  });

  it.each([
    ['not-a-pledge', '', 'pledgeInvalid'],
    [PLEDGE, '25.555', 'amountInvalid'],
    [PLEDGE, '0', 'amountInvalid'],
  ] as const)('refuses %s / %s in the field, before asking the service', async (pledge, amount, sentence) => {
    const user = userEvent.setup();
    renderConsole();

    await fill(user, { pledge, amount });

    expect(await screen.findByText(COPY[sentence])).toBeInTheDocument();
    expect(refundableMock).not.toHaveBeenCalled();
  });

  it('says how much is left when the amount is more than that, and asks nothing', async () => {
    const user = userEvent.setup();
    renderConsole();

    await fill(user, { amount: '50' });

    expect(
      await screen.findByText(
        fillPlaceholders(COPY.issueErrors['REFUND_EXCEEDS_COLLECTION'] ?? '', {
          remaining: formatMoney({ amount: '40.00', currency: 'AZN' }),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: COPY.confirmHeading })).not.toBeInTheDocument();
  });

  it('says the provider fee a campaign’s reason keeps back, before and after', async () => {
    const user = userEvent.setup();
    refundableMock.mockResolvedValue(
      refundable({ reason: 'CAMPAIGN_FAILED', remaining: { amount: '97.00', currency: 'AZN' }, withheldFee: { amount: '3.00', currency: 'AZN' } }),
    );
    issueMock.mockResolvedValue(
      refund({ reason: 'CAMPAIGN_FAILED', amount: { amount: '97.00', currency: 'AZN' }, withheldFee: { amount: '3.00', currency: 'AZN' } }),
    );
    renderConsole();
    await user.selectOptions(await screen.findByRole('combobox', { name: COPY.reasonLabel }), 'CAMPAIGN_FAILED');
    await fill(user);

    const sentence = fillPlaceholders(COPY.confirmWithheld, { fee: formatMoney({ amount: '3.00', currency: 'AZN' }) });
    expect(within(await screen.findByRole('group', { name: COPY.confirmHeading })).getByText(sentence)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.confirmAction }));
    expect(await screen.findByText(new RegExp(sentence.slice(0, 30)))).toBeInTheDocument();
  });

  it('adds up a refund sent in parts', async () => {
    const user = userEvent.setup();
    issueMock.mockResolvedValue(
      refund({
        amount: { amount: '30.00', currency: 'AZN' },
        parts: [
          refund({ id: 'p1', amount: { amount: '30.00', currency: 'AZN' } }),
          refund({ id: 'p2', amount: { amount: '10.00', currency: 'AZN' } }),
        ],
      }),
    );

    await issue(user);

    expect(
      await screen.findByText(
        new RegExp(fillPlaceholders(COPY.issuedBody, { amount: formatMoney({ amount: '40.00', currency: 'AZN' }), id: '11111111' }).slice(0, 20)),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(fillPlaceholders(COPY.partsNote, { count: '2' })))).toBeInTheDocument();
  });

  it.each([
    [new ApiError(409, { code: 'NOTHING_TO_REFUND', title: 'Nothing was collected' }), COPY.issueErrors['NOTHING_TO_REFUND']],
    [new ApiError(409, { code: 'REFUND_AFTER_PAYOUT', title: 'Paid out' }), COPY.issueErrors['REFUND_AFTER_PAYOUT']],
    [
      new ApiError(409, { code: 'REFUND_EXCEEDS_COLLECTION', title: 'More', meta: { remaining: '12.50 AZN' } }),
      fillPlaceholders(COPY.issueErrors['REFUND_EXCEEDS_COLLECTION'] ?? '', {
        remaining: formatMoney({ amount: '12.50', currency: 'AZN' }),
      }),
    ],
    [
      new ApiError(400, { code: 'CURRENCY_MISMATCH', title: 'Not the pledge’s currency', meta: { currency: 'USD' } }),
      fillPlaceholders(COPY.issueErrors['CURRENCY_MISMATCH'] ?? '', { currency: 'USD' }),
    ],
    [new ApiError(400, { title: 'Bad Request', detail: 'Failed to read request' }), COPY.refusals.invalidRequest],
    [
      new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'ISSUE_REFUND' } }),
      fillPlaceholders(COPY.refusals.needsCapabilityToAct ?? '', {
        capability: capabilityLabel('ISSUE_REFUND', COPY.refusals),
      }),
    ],
  ])('words a refused send in the reader’s language (%#)', async (refusal, sentence) => {
    issueMock.mockRejectedValue(refusal);

    await issue();

    expect(sentence).toBeTruthy();
    expect(await screen.findByText(sentence ?? '')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to read request|Not the pledge/)).not.toBeInTheDocument();
  });

  it('names the capability in words, not only as its identifier', () => {
    expect(capabilityLabel('ISSUE_REFUND', COPY.refusals)).toContain('ISSUE_REFUND');
    expect(capabilityLabel('ISSUE_REFUND', COPY.refusals)).not.toBe('ISSUE_REFUND');
  });
});

describe('the idempotency key (#6)', () => {
  function keys(): string[] {
    return issueMock.mock.calls.map(([request]) => request.idempotencyKey);
  }

  it('is kept when the same refund is sent again after a refusal', async () => {
    const user = userEvent.setup();
    issueMock.mockRejectedValueOnce(new ApiError(503, { title: 'Unavailable' })).mockResolvedValue(refund());
    await issue(user);
    await screen.findByText(COPY.failedTitle);

    await user.click(screen.getByRole('button', { name: COPY.issue }));
    await user.click(await screen.findByRole('button', { name: COPY.confirmAction }));

    expect(keys()).toHaveLength(2);
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('is new once the service refused and the pledge was changed', async () => {
    const user = userEvent.setup();
    issueMock
      .mockRejectedValueOnce(new ApiError(409, { code: 'NOTHING_TO_REFUND', title: 'Nothing' }))
      .mockResolvedValue(refund({ pledgeId: OTHER_PLEDGE }));
    await issue(user);
    await screen.findByText(COPY.issueErrors['NOTHING_TO_REFUND'] ?? '');

    refundableMock.mockResolvedValue(refundable({ pledgeId: OTHER_PLEDGE }));
    await fill(user, { pledge: OTHER_PLEDGE });
    await user.click(await screen.findByRole('button', { name: COPY.confirmAction }));

    expect(keys()).toHaveLength(2);
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('is kept when the answer was lost, even for another pledge, and renewed when the service says it is spent', async () => {
    const user = userEvent.setup();
    issueMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(409, { code: 'IDEMPOTENCY_KEY_REUSED', title: 'Used', meta: { operation: 'refund' } }))
      .mockResolvedValue(refund({ pledgeId: OTHER_PLEDGE }));
    await issue(user);
    await screen.findByText(COPY.failedTitle);

    refundableMock.mockResolvedValue(refundable({ pledgeId: OTHER_PLEDGE }));
    await fill(user, { pledge: OTHER_PLEDGE });
    await user.click(await screen.findByRole('button', { name: COPY.confirmAction }));
    expect(await screen.findByText(COPY.issueErrors['IDEMPOTENCY_KEY_REUSED'] ?? '')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.issue }));
    await user.click(await screen.findByRole('button', { name: COPY.confirmAction }));

    expect(keys()).toHaveLength(3);
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[0]);
  });
});

describe('the refund log', () => {
  it('names the backer and the campaign, dates the row in the reader’s locale, and says the fee kept back', async () => {
    listMock.mockResolvedValue({
      refunds: [
        refund({
          withheldFee: { amount: '3.00', currency: 'AZN' },
          amount: { amount: '97.00', currency: 'AZN' },
          reason: 'CAMPAIGN_FAILED',
          requestedBy: null,
          backerId: 'cccccccc-0000-4000-8000-000000000001',
          detail: 'The campaign ended below its success threshold; the backer is refunded less the fee.',
        }),
      ],
      page: 0,
      hasMore: false,
    });
    renderConsole();

    expect(
      await screen.findByText(
        new RegExp(fillPlaceholders(COPY.withheldNote, { fee: formatMoney({ amount: '3.00', currency: 'AZN' }) })),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatDate('2026-09-29T10:00:00.000Z', 'en')))).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-29/)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(COPY.detailPlatform['CAMPAIGN_FAILED'] ?? '-'))).toBeInTheDocument();
    expect(screen.queryByText(/refunded less the fee/)).not.toBeInTheDocument();
  });

  it('words a failure code rather than printing it', async () => {
    listMock.mockResolvedValue({
      refunds: [
        refund({ id: 'f1', state: 'FAILED', failureCode: 'not_sent', failureMessage: 'The circuit breaker is open.' }),
        refund({ id: 'f2', state: 'FAILED', failureCode: 'reverse_not_confirmed' }),
      ],
      page: 0,
      hasMore: false,
    });
    renderConsole();

    expect(await screen.findByText(COPY.failure['not_sent'] ?? '-')).toBeInTheDocument();
    expect(screen.getByText(COPY.failure['reverse_not_confirmed'] ?? '-')).toBeInTheDocument();
    expect(screen.queryByText(/not_sent|reverse_not_confirmed|circuit breaker/)).not.toBeInTheDocument();
  });

  it('words a bank-routed refund and a chargeback from their fields, not the service’s English', async () => {
    listMock.mockResolvedValue({
      refunds: [
        refund({
          id: 'r1',
          state: 'AWAITING_BANK_DETAILS',
          routedFrom: 'eeeeeeee-1111-4000-8000-000000000001',
          detail: 'By bank transfer, after refund eeeeeeee-1111-4000-8000-000000000001 was refused (declined).',
        }),
        refund({
          id: 'r2',
          reason: 'CHARGEBACK',
          disputeId: 'ffffffff-2222-4000-8000-000000000002',
          detail: 'The card network took this charge back: dispute ffffffff (PAYRIFF case 1) was resolved LOST.',
        }),
      ],
      page: 0,
      hasMore: false,
    });
    renderConsole(reader(['FINANCE']));

    expect(await screen.findAllByText('eeeeeeee')).not.toHaveLength(0);
    expect(screen.queryByText(/after refund|took this charge back: dispute/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/ffffffff/)).not.toHaveLength(0);
  });

  it('stops offering the bank fallback on a refused refund once it is routed, and says where it went', async () => {
    listMock.mockResolvedValue({
      refunds: [refund({ id: 'refused-1', state: 'FAILED', failureCode: 'declined', routedTo: { id: 'new', state: 'SUCCEEDED' } })],
      page: 0,
      hasMore: false,
    });
    renderConsole();

    expect(await screen.findByText(fillPlaceholders(COPY.bank.routedTo, { state: COPY.state.SUCCEEDED }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.bank.refundByBank })).not.toBeInTheDocument();
  });

  it('marks the chosen state filter as pressed', async () => {
    const user = userEvent.setup();
    renderConsole();

    expect(await screen.findByRole('button', { name: COPY.state.REQUESTED })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: COPY.all }));
    expect(screen.getByRole('button', { name: COPY.all })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: COPY.state.REQUESTED })).toHaveAttribute('aria-pressed', 'false');
  });
});

/* -------------------------------------------------------------------------
 * #400: refunds paid by bank transfer.
 * ---------------------------------------------------------------------- */

function awaitingTransfer(overrides: Partial<Refund> = {}): Refund {
  return refund({
    id: 'aaaaaaaa-0000-0000-0000-000000000077',
    state: 'AWAITING_TRANSFER',
    amount: { amount: '1234.50', currency: 'AZN' },
    bankTransfer: {
      ibanHint: 'AZ21…1944',
      ticketId: 'eeeeeeee-0000-4000-8000-000000000001',
      detailsRecordedBy: SUPPORT_PERSON,
      detailsRecordedAt: '2026-10-11T09:00:00.000Z',
    },
    ...overrides,
  });
}

const REVEALED = {
  refundId: 'aaaaaaaa-0000-0000-0000-000000000077',
  pledgeId: PLEDGE,
  amount: { amount: '1234.50', currency: 'AZN' },
  iban: IBAN,
  ibanHint: 'AZ21…1944',
  holderName: 'Aysel Məmmədova',
  ticketId: 'eeeeeeee-0000-4000-8000-000000000001',
  detailsRecordedBy: SUPPORT_PERSON,
};

function showList(refunds: readonly Refund[], membership: StaffMembership = reader(['FINANCE'])) {
  listMock.mockResolvedValue({ refunds: [...refunds], page: 0, hasMore: false });
  return render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
      <RefundConsole copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

async function fillRecordForm(user: ReturnType<typeof userEvent.setup>, reference: string): Promise<void> {
  const form = await screen.findByRole('form', { name: BANK.recordTransfer });
  await user.type(within(form).getByLabelText(new RegExp(BANK.bankReference)), reference);
  await user.click(within(form).getByRole('button', { name: BANK.recordTransfer }));
}

const BANK = COPY.bank;

describe('refunds paid by bank transfer (#400)', () => {
  beforeEach(() => {
    revealMock.mockReset();
    recordMock.mockReset();
    routeMock.mockReset();
  });

  it('filters by the two states a bank refund waits in', async () => {
    const user = userEvent.setup();
    showList([]);

    await user.click(await screen.findByRole('button', { name: COPY.state.AWAITING_TRANSFER }));
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'AWAITING_TRANSFER' }));

    await user.click(screen.getByRole('button', { name: COPY.state.AWAITING_BANK_DETAILS }));
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'AWAITING_BANK_DETAILS' }));
  });

  it('says a refund waiting for bank details waits for support, and offers finance nothing to reveal', async () => {
    showList([refund({ state: 'AWAITING_BANK_DETAILS' })]);

    expect(await screen.findByText(BANK.awaitingBankDetails)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BANK.reveal.action })).not.toBeInTheDocument();
  });

  it('reveals the account only on a press, with the amount, the IBAN in fours and three named copies', async () => {
    const user = userEvent.setup();
    revealMock.mockResolvedValue(REVEALED);
    showList([awaitingTransfer()]);

    const reveal = await screen.findByRole('button', { name: BANK.reveal.action });
    expect(revealMock).not.toHaveBeenCalled();
    expect(screen.getByText(BANK.reveal.audited)).toBeInTheDocument();

    await user.click(reveal);

    expect(revealMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('AZ21 NABZ 0000 0000 1370 1000 1944')).toBeInTheDocument();
    expect(screen.getByText('Aysel Məmmədova')).toBeInTheDocument();
    expect(screen.getByText(BANK.amountLabel)).toBeInTheDocument();
    for (const name of [BANK.copy.amount, BANK.copy.iban, BANK.copy.holder]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: BANK.reveal.hide }));
    expect(screen.queryByText('AZ21 NABZ 0000 0000 1370 1000 1944')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: BANK.reveal.action }));
    expect(revealMock).toHaveBeenCalledTimes(2);
  });

  it('copies the amount as the decimal string it came as, and the IBAN in one piece', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    revealMock.mockResolvedValue(REVEALED);
    showList([awaitingTransfer()]);

    await user.click(await screen.findByRole('button', { name: BANK.reveal.action }));
    await user.click(await screen.findByRole('button', { name: BANK.copy.amount }));
    expect(writeText).toHaveBeenCalledWith('1234.50');
    expect(await screen.findByText(BANK.copy.copied)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: BANK.copy.iban }));
    expect(writeText).toHaveBeenLastCalledWith(IBAN);
  });

  it('says a reveal during a chargeback is refused, in its own words', async () => {
    const user = userEvent.setup();
    revealMock.mockRejectedValue(new ApiError(409, { code: 'REFUND_CHARGE_DISPUTED', title: 'Disputed' }));
    showList([awaitingTransfer()]);

    await user.click(await screen.findByRole('button', { name: BANK.reveal.action }));

    expect(await screen.findByText(BANK.errors['REFUND_CHARGE_DISPUTED'] ?? '')).toBeInTheDocument();
  });

  it('records the transfer after saying what it is about to record, dated today in Baku by default', async () => {
    const user = userEvent.setup();
    recordMock.mockResolvedValue(awaitingTransfer({ state: 'SUCCEEDED' }));
    showList([awaitingTransfer()]);

    const form = await screen.findByRole('form', { name: BANK.recordTransfer });
    expect(within(form).getByLabelText(new RegExp(BANK.transferredOn))).toHaveValue(todayInBaku());

    await fillRecordForm(user, 'KB-2026-0042');

    expect(recordMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        fillPlaceholders(BANK.confirmRecord, {
          amount: formatMoney({ amount: '1234.50', currency: 'AZN' }),
          hint: 'AZ21…1944',
          date: formatDay(todayInBaku(), 'en'),
          reference: 'KB-2026-0042',
        }),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: BANK.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000077', {
      bankReference: 'KB-2026-0042',
      transferredOn: todayInBaku(),
    });
    expect(await screen.findByText(BANK.recordedTitle)).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('sends the bank fee typed from the statement and says it is a platform expense', async () => {
    const user = userEvent.setup();
    recordMock.mockResolvedValue(awaitingTransfer({ state: 'SUCCEEDED' }));
    showList([awaitingTransfer()]);

    const form = await screen.findByRole('form', { name: BANK.recordTransfer });
    await user.type(within(form).getByLabelText(new RegExp(`^${BANK.bankFee}`)), '0,50');
    await fillRecordForm(user, 'KB-2026-0042');

    expect(
      screen.getByText(
        fillPlaceholders(BANK.confirmBankFee, { amount: formatMoney({ amount: '0.50', currency: 'AZN' }) }),
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: BANK.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000077', {
      bankReference: 'KB-2026-0042',
      transferredOn: todayInBaku(),
      bankFee: '0.50',
    });
  });

  it.each([
    'BANK_REFERENCE_TAKEN',
    'TRANSFER_DATE_IN_FUTURE',
    'REFUND_CHARGE_DISPUTED',
    'REFUND_DUTIES_NOT_SEPARATE',
    'REFUND_NOT_AWAITING_TRANSFER',
    'REFUND_NOT_FOUND',
    'ENCRYPTED_STORAGE_UNAVAILABLE',
  ])('words the refusal %s', async (code) => {
    const user = userEvent.setup();
    recordMock.mockRejectedValue(new ApiError(409, { code, title: 'Refused' }));
    showList([awaitingTransfer()]);

    await fillRecordForm(user, 'KB-1');
    await user.click(screen.getByRole('button', { name: BANK.confirmRecordAction }));

    const sentence = BANK.errors[code];
    expect(sentence).toBeTruthy();
    expect(await screen.findByText(sentence ?? '')).toBeInTheDocument();
  });

  it('says why the person who recorded the account cannot record the transfer, and offers neither control', async () => {
    showList([awaitingTransfer()], reader(['FINANCE'], SUPPORT_PERSON));

    expect(await screen.findByText(BANK.fourEyesTitle)).toBeInTheDocument();
    expect(screen.getByText(BANK.fourEyes)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BANK.reveal.action })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: BANK.recordTransfer })).not.toBeInTheDocument();
  });

  it('offers nothing to a reader without ISSUE_REFUND', async () => {
    showList([awaitingTransfer(), refund({ id: 'f', state: 'FAILED' })], reader(['MODERATOR']));

    expect(await screen.findByText('AZ21…1944')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BANK.reveal.action })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BANK.refundByBank })).not.toBeInTheDocument();
  });

  it('sends a refused refund by bank transfer after asking', async () => {
    const user = userEvent.setup();
    routeMock.mockResolvedValue(refund({ id: 'new', state: 'AWAITING_BANK_DETAILS' }));
    showList([refund({ id: 'refused-1', state: 'FAILED', failureCode: 'declined' })]);

    await user.click(await screen.findByRole('button', { name: BANK.refundByBank }));
    expect(routeMock).not.toHaveBeenCalled();
    expect(screen.getByText(BANK.confirmRefundByBank)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: BANK.confirmRefundByBankAction }));

    expect(routeMock).toHaveBeenCalledWith('refused-1');
    expect(await screen.findByText(BANK.routedTitle)).toBeInTheDocument();
  });

  it('says a repeated fallback found the bank refund it made before, as it now stands', async () => {
    const user = userEvent.setup();
    routeMock.mockResolvedValue(refund({ id: 'new', state: 'SUCCEEDED' }));
    showList([refund({ id: 'refused-1', state: 'FAILED', failureCode: 'declined' })]);

    await user.click(await screen.findByRole('button', { name: BANK.refundByBank }));
    await user.click(screen.getByRole('button', { name: BANK.confirmRefundByBankAction }));

    expect(await screen.findByText(BANK.routedAlreadyTitle)).toBeInTheDocument();
    expect(
      screen.getByText(fillPlaceholders(BANK.routedAlready, { id: PLEDGE.slice(0, 8), state: COPY.state.SUCCEEDED })),
    ).toBeInTheDocument();
    expect(screen.queryByText(BANK.routedTitle)).not.toBeInTheDocument();
  });

  it('words a fallback refused because nothing is left on the charge', async () => {
    const user = userEvent.setup();
    routeMock.mockRejectedValue(new ApiError(409, { code: 'NOTHING_TO_REFUND', title: 'Nothing was collected' }));
    showList([refund({ id: 'refused-1', state: 'FAILED' })]);

    await user.click(await screen.findByRole('button', { name: BANK.refundByBank }));
    await user.click(screen.getByRole('button', { name: BANK.confirmRefundByBankAction }));

    expect(await screen.findByText(BANK.errors['NOTHING_TO_REFUND'] ?? '-')).toBeInTheDocument();
  });

  it('words a refused fallback', async () => {
    const user = userEvent.setup();
    routeMock.mockRejectedValue(new ApiError(409, { code: 'REFUND_NOT_FAILED', title: 'Not failed' }));
    showList([refund({ id: 'refused-1', state: 'FAILED' })]);

    await user.click(await screen.findByRole('button', { name: BANK.refundByBank }));
    await user.click(screen.getByRole('button', { name: BANK.confirmRefundByBankAction }));

    expect(await screen.findByText(BANK.errors['REFUND_NOT_FAILED'] ?? '')).toBeInTheDocument();
  });

  it('shows the transfer once it is recorded', async () => {
    showList([
      awaitingTransfer({
        state: 'SUCCEEDED',
        bankTransfer: {
          ibanHint: 'AZ21…1944',
          ticketId: 'eeeeeeee-0000-4000-8000-000000000001',
          detailsRecordedBy: SUPPORT_PERSON,
          detailsRecordedAt: '2026-10-11T09:00:00.000Z',
          bankReference: 'KB-77',
          transferredOn: '2026-10-12',
          transferRecordedBy: ME,
          transferRecordedAt: '2026-10-12T10:00:00.000Z',
        },
      }),
    ]);

    expect(await screen.findByText('KB-77')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: BANK.recordTransfer })).not.toBeInTheDocument();
  });
});

describe('today in Baku', () => {
  it('is already tomorrow after eight in the evening in UTC', () => {
    expect(todayInBaku(new Date('2026-10-12T20:30:00Z'))).toBe('2026-10-13');
    expect(todayInBaku(new Date('2026-10-12T19:30:00Z'))).toBe('2026-10-12');
  });
});

/* -------------------------------------------------------------------------
 * #416: support's step on a refund waiting for bank details.
 * ---------------------------------------------------------------------- */

const raiseMock = vi.mocked(raiseBackerTicket);
const recordDetailsMock = vi.mocked(recordRefundBankDetails);
const RAISE = COPY.backerTicket;
const DETAILS = COPY.bankDetails;

const RAISED: Ticket = {
  id: '99999999-0000-4000-8000-000000000001',
  requesterId: 'bbbbbbbb-0000-4000-8000-000000000009',
  subject: RAISE.subjectDefault,
  subjectType: 'PLEDGE',
  subjectRef: PLEDGE,
  state: 'OPEN',
  priority: 'NORMAL',
  assigneeId: null,
  createdAt: '2026-10-13T09:00:00.000Z',
  updatedAt: '2026-10-13T09:00:00.000Z',
  resolvedAt: null,
};

describe('a refund waiting for bank details: the backer’s ticket and account (#416)', () => {
  beforeEach(() => {
    raiseMock.mockReset();
    recordDetailsMock.mockReset();
  });

  it('opens the ticket in the backer’s name from the row’s pledge and goes straight on to the account', async () => {
    const user = userEvent.setup();
    raiseMock.mockResolvedValue({ ticket: RAISED, messages: [] });
    recordDetailsMock.mockResolvedValue({
      refunds: [
        refund({
          state: 'AWAITING_TRANSFER',
          bankTransfer: {
            ibanHint: 'AZ21…1944',
            ticketId: RAISED.id,
            detailsRecordedBy: ME,
            detailsRecordedAt: '2026-10-13T09:05:00.000Z',
          },
        }),
      ],
      page: 0,
      hasMore: false,
    });
    showList([refund({ state: 'AWAITING_BANK_DETAILS' })]);

    await user.click(await screen.findByRole('button', { name: RAISE.openFromRefund }));
    /* The row knows the pledge, so the form does not ask for it. */
    const form = screen.getByRole('region', { name: RAISE.heading });
    expect(within(form).queryByLabelText(new RegExp(RAISE.pledgeLabel))).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText(new RegExp(RAISE.bodyLabel)), 'WhatsApp, 2026-10-12: my IBAN is below.');
    await user.click(screen.getByRole('button', { name: RAISE.raise }));

    expect(raiseMock).toHaveBeenCalledWith({
      pledgeId: PLEDGE,
      subject: RAISE.subjectDefault,
      body: 'WhatsApp, 2026-10-12: my IBAN is below.',
    });

    /* Open at once, bound to the ticket just raised. */
    await user.type(await screen.findByLabelText(new RegExp(DETAILS.ibanLabel)), IBAN);
    await user.type(screen.getByLabelText(new RegExp(DETAILS.holderLabel)), 'Aysel Məmmədova');
    expect(screen.getByLabelText(new RegExp(DETAILS.ticketLabel))).toHaveValue(RAISED.id);
    const reads = listMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: DETAILS.save }));

    expect(recordDetailsMock).toHaveBeenCalledWith(PLEDGE, {
      iban: IBAN,
      holderName: 'Aysel Məmmədova',
      ticketId: RAISED.id,
    });
    /*
     * Said above the list too, which is read again so the refund moves on. A real read redraws
     * the row; the mocked one answers before it is drawn, so the form's own word may still be there.
     */
    const said = fillPlaceholders(DETAILS.savedBody, {
      hint: 'AZ21…1944',
      amount: formatMoney({ amount: '25.00', currency: 'AZN' }),
    });
    expect((await screen.findAllByText(said)).length).toBeGreaterThan(0);
    expect(listMock.mock.calls.length).toBeGreaterThan(reads);
  });

  it('is not offered to a reader without HANDLE_SUPPORT', async () => {
    showList([refund({ state: 'AWAITING_BANK_DETAILS' })], reader(['CURATOR']));

    expect(await screen.findByText(BANK.awaitingBankDetails)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RAISE.openFromRefund })).not.toBeInTheDocument();
  });

  it('is not offered on a refund that is not waiting for bank details', async () => {
    showList([awaitingTransfer()], reader(['FINANCE'], SUPPORT_PERSON));

    expect(await screen.findByText(BANK.fourEyesTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RAISE.openFromRefund })).not.toBeInTheDocument();
  });
});
