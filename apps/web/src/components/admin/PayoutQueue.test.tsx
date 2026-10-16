import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { lookUpNames } from '../../lib/admin/directory';
import { bakuToday } from '../../lib/admin/dashboard';
import {
  abandonBankTransfer,
  readBankTransfer,
  recordBankTransfer,
  startBankTransfer,
  type BankTransferInstruction,
} from '../../lib/admin/payout-bank-transfers';
import {
  approvePayout,
  calculatePayout,
  cancelPayout,
  listPayouts,
  readPayout,
  readPayoutQueue,
  recordUnconfirmedNotSent,
  recordUnconfirmedSent,
  sendPayout,
  type Payout,
  type PayoutFile,
} from '../../lib/admin/payouts';
import { calendarDate } from '../../lib/admin/console-dates';
import {
  readMembership,
  ROLE_CAPABILITIES,
  type StaffCapability,
  type StaffMembership,
} from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { payoutQueueCopyFrom } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { PayoutQueue } from './PayoutQueue';

/*
 * The payout queue's "transfer by hand" — issue #398. The copy is built from `messages/en.json`
 * through the builder the route calls, for `src/test-copy.ts`'s reason.
 */
const ADMIN = translatorFor('admin');
const COPY = payoutQueueCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));
const WORDS = COPY.bankTransfer;

vi.mock('../../lib/admin/payouts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/payouts')>()),
  readPayoutQueue: vi.fn(),
  readPayout: vi.fn(),
  sendPayout: vi.fn(),
  approvePayout: vi.fn(),
  cancelPayout: vi.fn(),
  calculatePayout: vi.fn(),
  listPayouts: vi.fn(),
  recordUnconfirmedSent: vi.fn(),
  recordUnconfirmedNotSent: vi.fn(),
}));
vi.mock('../../lib/admin/payout-bank-transfers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/payout-bank-transfers')>()),
  startBankTransfer: vi.fn(),
  readBankTransfer: vi.fn(),
  recordBankTransfer: vi.fn(),
  abandonBankTransfer: vi.fn(),
}));
vi.mock('../../lib/admin/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/staff')>()),
  readMembership: vi.fn(),
}));
// `lookUpNames` and not `readDirectory`, for `console-identity.test.tsx`'s reason.
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const queueMock = vi.mocked(readPayoutQueue);
const fileMock = vi.mocked(readPayout);
const sendMock = vi.mocked(sendPayout);
const approveMock = vi.mocked(approvePayout);
const cancelMock = vi.mocked(cancelPayout);
const calculateMock = vi.mocked(calculatePayout);
const historyMock = vi.mocked(listPayouts);
const sentMock = vi.mocked(recordUnconfirmedSent);
const notSentMock = vi.mocked(recordUnconfirmedNotSent);
const startMock = vi.mocked(startBankTransfer);
const revealMock = vi.mocked(readBankTransfer);
const recordMock = vi.mocked(recordBankTransfer);
const abandonMock = vi.mocked(abandonBankTransfer);
const membershipMock = vi.mocked(readMembership);
const namesMock = vi.mocked(lookUpNames);

const ME = '0193f2a1-0000-7000-8000-0000000000aa';
const COLLEAGUE = '0193f2a1-0000-7000-8000-0000000000bb';
const CREATOR = '0193f2a1-0000-7000-8000-0000000000cc';
const PROJECT = '0193f2a1-0000-7000-8000-0000000000dd';
const PAYOUT = '0193f2a1-0000-7000-8000-0000000000ee';

const IBAN = 'AZ21NABZ00000000137010001944';
const ZERO = { amount: '0.00', currency: 'AZN' } as const;

/** Approved, signed by two, and paid into a bank account. */
function bankPayout(overrides: Partial<Payout> = {}): Payout {
  return {
    id: PAYOUT,
    projectId: PROJECT,
    creatorId: CREATOR,
    gross: { amount: '1400.00', currency: 'AZN' },
    platformFee: { amount: '112.00', currency: 'AZN' },
    processingFee: { amount: '38.00', currency: 'AZN' },
    taxWithheld: ZERO,
    refunded: ZERO,
    net: { amount: '1250.00', currency: 'AZN' },
    state: 'APPROVED',
    payableAt: '2026-08-01T00:00:00Z',
    payableNow: true,
    approvalsRequired: 2,
    creatorStanding: 'VERIFIED',
    heldForVerification: false,
    destinationStanding: 'VERIFIED',
    heldForDestination: false,
    destinationKind: 'BANK_TRANSFER',
    calculatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

/** Started a moment ago by a colleague, so today is inside the value-date window. */
function startedPayout(): Payout {
  return bankPayout({ bankTransferStartedAt: new Date().toISOString(), bankTransferStartedBy: COLLEAGUE });
}

function fileOf(payout: Payout): PayoutFile {
  return {
    payout,
    approvals: [
      { approverId: COLLEAGUE, approvedAt: '2026-08-02T00:00:00Z', note: null },
      { approverId: '0193f2a1-0000-7000-8000-0000000000ff', approvedAt: '2026-08-02T00:00:00Z', note: null },
    ],
    stillNeeded: 0,
  };
}

function instructionFor(payout: Payout): BankTransferInstruction {
  return {
    payout,
    iban: IBAN,
    holderName: 'AYAN MAMMADOVA',
    accountHint: 'AZ21…1944',
    amount: { amount: '1250.00', currency: 'AZN' },
    description: `IdeyaNest payout ${PAYOUT}`,
  };
}

function reader(capabilities: readonly StaffCapability[]): StaffMembership {
  return {
    accountId: ME,
    staff: true,
    bootstrapped: false,
    roles: ['SUPER_ADMIN'],
    capabilities: [...capabilities],
  };
}

function refusal(status: number, code: string, meta?: Record<string, string>): ApiError {
  return new ApiError(status, { status, code, title: code, ...(meta === undefined ? {} : { meta }) });
}

/** Renders the queue with one payout on it and opens its file. */
async function openFile(payout: Payout, capabilities: readonly StaffCapability[] = ROLE_CAPABILITIES.SUPER_ADMIN) {
  const user = userEvent.setup();
  queueMock.mockResolvedValue({ payouts: [payout], page: 0, hasMore: false });
  fileMock.mockResolvedValue(fileOf(payout));
  membershipMock.mockResolvedValue(reader(capabilities));

  render(<PayoutQueue copy={COPY} />);
  await user.click(await screen.findByRole('button', { expanded: false }));
  await screen.findByRole('heading', { name: WORDS.heading });
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  namesMock.mockResolvedValue({ accounts: [], projects: [] });
  historyMock.mockResolvedValue({ payouts: [], page: 0, hasMore: false });
});

/** The queue's own section, so a state's word on a row is not confused with the history's chip. */
function queueSection(): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${COPY.queueHeading}`) });
}

/** Send, then the confirmation it asks for — #8. */
async function sendAndConfirm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: COPY.send }));
  await user.click(screen.getByRole('button', { name: COPY.confirmSendAction }));
}

describe('a payout paid into a bank account', () => {
  it('offers to transfer it by hand instead of Send, and opens nothing until asked', async () => {
    await openFile(bankPayout());

    expect(screen.queryByRole('button', { name: COPY.send })).not.toBeInTheDocument();
    const start = screen.getByRole('button', { name: WORDS.startTransfer });
    expect(start).toBeEnabled();
    // The warning is beside the control and part of its description, before anybody presses it.
    expect(start).toHaveAccessibleDescription(WORDS.audited);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('shows the amount, the grouped IBAN, the holder and the description once started', async () => {
    const user = await openFile(bankPayout());
    startMock.mockResolvedValue(instructionFor(startedPayout()));

    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));

    const panel = (await screen.findByText(WORDS.amountLabel)).closest('dl');
    if (panel === null) throw new Error('the amount is not inside the transfer panel');
    expect(within(panel).getByText('1,250.00 AZN')).toBeInTheDocument();
    expect(within(panel).getByText('AZ21 NABZ 0000 0000 1370 1000 1944')).toBeInTheDocument();
    expect(within(panel).getByText('AYAN MAMMADOVA')).toBeInTheDocument();
    expect(within(panel).getByText(`IdeyaNest payout ${PAYOUT}`)).toBeInTheDocument();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(PAYOUT, expect.any(AbortSignal));

    // The row says a transfer is in progress, without a second read of the queue.
    expect(screen.getByText(WORDS.inProgressTag)).toBeInTheDocument();
    expect(queueMock).toHaveBeenCalledTimes(1);
  });

  it('names each copy control and copies what a bank form wants', async () => {
    const user = await openFile(bankPayout());
    startMock.mockResolvedValue(instructionFor(startedPayout()));
    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));

    const copyOf = (field: string) =>
      screen.findByRole('button', { name: fillPlaceholders(WORDS.copyField, { field }) });

    await user.click(await copyOf(WORDS.ibanLabel));
    await expect(navigator.clipboard.readText()).resolves.toBe(IBAN);

    // The service's decimal string, not the grouped figure with its currency.
    await user.click(await copyOf(WORDS.amountLabel));
    await expect(navigator.clipboard.readText()).resolves.toBe('1250.00');

    await user.click(await copyOf(WORDS.holderLabel));
    await expect(navigator.clipboard.readText()).resolves.toBe('AYAN MAMMADOVA');

    await user.click(await copyOf(WORDS.descriptionLabel));
    await expect(navigator.clipboard.readText()).resolves.toBe(`IdeyaNest payout ${PAYOUT}`);
    expect(screen.getAllByText(WORDS.copied).length).toBeGreaterThan(0);
  });

  it('drops the account when hidden, and reading it again is another request', async () => {
    const user = await openFile(bankPayout());
    startMock.mockResolvedValue(instructionFor(startedPayout()));
    revealMock.mockResolvedValue(instructionFor(startedPayout()));
    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));
    await screen.findByText('AYAN MAMMADOVA');

    await user.click(screen.getByRole('button', { name: WORDS.hide }));
    expect(screen.queryByText('AYAN MAMMADOVA')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: WORDS.revealIban }));
    expect(await screen.findByText('AYAN MAMMADOVA')).toBeInTheDocument();
    expect(revealMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Send for a payout sent through the provider', async () => {
    const user = userEvent.setup();
    const payout = bankPayout({ destinationKind: 'PROVIDER_TOKEN' });
    queueMock.mockResolvedValue({ payouts: [payout], page: 0, hasMore: false });
    fileMock.mockResolvedValue(fileOf(payout));
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));

    render(<PayoutQueue copy={COPY} />);
    await user.click(await screen.findByRole('button', { expanded: false }));

    expect(await screen.findByRole('button', { name: COPY.send })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: WORDS.heading })).not.toBeInTheDocument();
  });

  it('says so when Send meets a creator paid into a bank account', async () => {
    const user = userEvent.setup();
    // A node that has not been redeployed sends no `destinationKind`, so Send is still drawn.
    const payout = bankPayout({ destinationKind: null });
    queueMock.mockResolvedValue({ payouts: [payout], page: 0, hasMore: false });
    fileMock.mockResolvedValue(fileOf(payout));
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));
    sendMock.mockRejectedValue(refusal(409, 'PAYOUT_SETTLES_BY_BANK_TRANSFER'));

    render(<PayoutQueue copy={COPY} />);
    await user.click(await screen.findByRole('button', { expanded: false }));
    await sendAndConfirm(user);

    expect(await screen.findByText(COPY.refusal.PAYOUT_SETTLES_BY_BANK_TRANSFER)).toBeInTheDocument();
  });
});

describe('who is offered the transfer', () => {
  it('offers nothing to a reader without APPROVE_PAYOUT, and says why', async () => {
    await openFile(bankPayout(), ROLE_CAPABILITIES.FINANCE);

    expect(screen.getByText(WORDS.needsApprovePayout)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WORDS.startTransfer })).not.toBeInTheDocument();
  });

  it('disables Start for a reader who may pay but may not open the account, and says why', async () => {
    await openFile(bankPayout(), ['VIEW_FINANCE', 'APPROVE_PAYOUT']);

    expect(screen.getByRole('button', { name: WORDS.startTransfer })).toBeDisabled();
    expect(screen.getByText(WORDS.needsReadBankDetails)).toBeInTheDocument();
  });

  it('does not offer a start before the payout is approved', async () => {
    await openFile(bankPayout({ state: 'PENDING_APPROVAL' }));

    expect(screen.queryByRole('button', { name: WORDS.startTransfer })).not.toBeInTheDocument();
    expect(screen.getByText(WORDS.notApproved)).toBeInTheDocument();
  });
});

describe('starting refused', () => {
  it.each([
    [refusal(409, 'PAYOUT_SETTLES_THROUGH_PROVIDER'), COPY.refusal.PAYOUT_SETTLES_THROUGH_PROVIDER],
    [refusal(409, 'PAYOUT_BACKER_DISPUTE_OPEN', { projectId: PROJECT }), COPY.refusal.PAYOUT_BACKER_DISPUTE_OPEN],
    [refusal(409, 'PAYOUT_NOT_SENDABLE', { state: 'CANCELLED' }), COPY.refusal.FIGURES_MOVED],
    [refusal(409, 'PAYOUT_NOT_SENDABLE', { state: 'PAID' }), COPY.refusal.PAYOUT_NOT_SENDABLE],
    [
      refusal(409, 'PAYOUT_DESTINATION_NOT_VERIFIED', { standing: 'AWAITING_VERIFICATION', creator: CREATOR }),
      COPY.refusal.PAYOUT_DESTINATION_NOT_VERIFIED,
    ],
    [refusal(403, 'SELF_PAID_PAYOUT'), COPY.refusal.SELF_PAID_PAYOUT],
    [refusal(409, 'PAYOUT_SIGNATURES_SHORT', { signatures: '1', required: '2' }), COPY.refusal.PAYOUT_SIGNATURES_SHORT],
  ])('explains %s', async (cause, words) => {
    const user = await openFile(bankPayout());
    startMock.mockRejectedValue(cause);

    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));

    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.queryByText('AYAN MAMMADOVA')).not.toBeInTheDocument();
  });
});

describe('the figures moved', () => {
  const moved = () => refusal(409, 'PAYOUT_NOT_SENDABLE', { state: 'CANCELLED' });

  it('reads the file again after a start is refused, and keeps saying why — #419', async () => {
    const user = await openFile(bankPayout());
    startMock.mockRejectedValue(moved());
    fileMock.mockResolvedValue(fileOf(bankPayout({ state: 'CANCELLED' })));

    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));

    expect(await screen.findByText(COPY.refusal.FIGURES_MOVED)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: WORDS.heading })).not.toBeInTheDocument());
    expect(fileMock).toHaveBeenCalledTimes(2);
    // The row says cancelled without a second read of the queue, which would close the file.
    expect(within(queueSection()).getByText(COPY.state.CANCELLED)).toBeInTheDocument();
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: COPY.cancelPayout })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.refusal.FIGURES_MOVED)).toBeInTheDocument();
  });

  it('does the same when Send is refused', async () => {
    const user = userEvent.setup();
    const payout = bankPayout({ destinationKind: 'PROVIDER_TOKEN' });
    queueMock.mockResolvedValue({ payouts: [payout], page: 0, hasMore: false });
    fileMock.mockResolvedValue(fileOf(payout));
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));
    sendMock.mockRejectedValue(moved());

    render(<PayoutQueue copy={COPY} />);
    await user.click(await screen.findByRole('button', { expanded: false }));
    fileMock.mockResolvedValue(fileOf({ ...payout, state: 'CANCELLED' }));
    await sendAndConfirm(user);

    expect(await screen.findByText(COPY.refusal.FIGURES_MOVED)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: COPY.send })).not.toBeInTheDocument());
    expect(within(queueSection()).getByText(COPY.state.CANCELLED)).toBeInTheDocument();
    expect(queueMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the file as it was when the second read fails', async () => {
    const user = await openFile(bankPayout());
    startMock.mockRejectedValue(moved());
    fileMock.mockRejectedValue(new Error('offline'));

    await user.click(screen.getByRole('button', { name: WORDS.startTransfer }));

    expect(await screen.findByText(COPY.refusal.FIGURES_MOVED)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: WORDS.heading })).toBeInTheDocument();
  });
});

describe('a transfer in progress', () => {
  it('says who started it, offers the account again, and blocks cancelling', async () => {
    await openFile(startedPayout());

    expect(screen.getByText(WORDS.inProgressTag)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WORDS.revealIban })).toBeEnabled();
    expect(screen.getByRole('button', { name: COPY.cancelPayout })).toBeDisabled();
    expect(screen.getByText(COPY.refusal.PAYOUT_BANK_TRANSFER_IN_PROGRESS)).toBeInTheDocument();
    const lead = WORDS.transferStarted.split('{who}')[0] ?? '';
    const started = screen.getByText(
      (_, element) => element?.tagName === 'P' && (element.textContent ?? '').startsWith(lead),
    );
    expect(within(started).getByText(COLLEAGUE.slice(0, 8))).toBeInTheDocument();
    // Opening the file is not opening the account.
    expect(revealMock).not.toHaveBeenCalled();
  });

  it('records from the statement after asking, with today in Baku as the value date', async () => {
    const user = await openFile(startedPayout());
    const paid = bankPayout({
      state: 'PAID',
      bankTransferStartedAt: '2026-10-12T08:00:00Z',
      bankTransferStartedBy: COLLEAGUE,
      bankTransferredOn: bakuToday(),
    });
    recordMock.mockResolvedValue(paid);

    const form = screen.getByRole('form', { name: WORDS.recordHeading });
    expect(within(form).getByLabelText(new RegExp(WORDS.transferredOn))).toHaveValue(bakuToday());
    const submit = within(form).getByRole('button', { name: WORDS.recordTransfer });
    expect(submit).toBeDisabled();

    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), ' FT26285ABC12 ');
    await user.type(within(form).getByLabelText(new RegExp(`^${WORDS.noteLabel}`)), 'Statement line 14');
    await user.click(submit);

    // Asked first: recording makes the payout paid and nothing undoes it.
    expect(recordMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        fillPlaceholders(WORDS.confirmRecord, {
          amount: '1,250.00 AZN',
          reference: 'FT26285ABC12',
          date: calendarDate(bakuToday(), 'en'),
        }),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith(PAYOUT, {
      bankReference: 'FT26285ABC12',
      transferredOn: bakuToday(),
      note: 'Statement line 14',
    });
    expect(
      await screen.findByText(fillPlaceholders(WORDS.paidOn, { date: calendarDate(bakuToday(), 'en') })),
    ).toBeInTheDocument();
  });

  it('records the bank fee as typed from the statement, and refuses one that is not an amount', async () => {
    const user = await openFile(startedPayout());
    recordMock.mockResolvedValue(bankPayout({ state: 'PAID', bankTransferredOn: bakuToday() }));

    const form = screen.getByRole('form', { name: WORDS.recordHeading });
    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), 'FT26285ABC12');
    await user.type(within(form).getByLabelText(new RegExp(`^${WORDS.noteLabel}`)), 'Statement line 14');
    const fee = within(form).getByLabelText(new RegExp(`^${WORDS.bankFee}`));
    await user.type(fee, '1.234');

    expect(within(form).getByText(WORDS.bankFeeInvalid)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: WORDS.recordTransfer })).toBeDisabled();

    await user.clear(fee);
    await user.type(fee, '1,20');
    await user.click(within(form).getByRole('button', { name: WORDS.recordTransfer }));

    expect(screen.getByText(fillPlaceholders(WORDS.confirmBankFee, { amount: '1.20 AZN' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith(PAYOUT, {
      bankReference: 'FT26285ABC12',
      transferredOn: bakuToday(),
      note: 'Statement line 14',
      bankFee: '1.20',
    });
  });

  it.each([
    ['PAYOUT_BANK_TRANSFER_ALREADY_RECORDED', 409, COPY.refusal.PAYOUT_BANK_TRANSFER_ALREADY_RECORDED],
    ['PAYOUT_REFERENCE_TAKEN', 409, COPY.refusal.PAYOUT_REFERENCE_TAKEN],
    [
      'BANK_TRANSFER_DATE_OUT_OF_RANGE',
      400,
      fillPlaceholders(COPY.refusal.BANK_TRANSFER_DATE_OUT_OF_RANGE, {
        start: calendarDate(bakuToday(), 'en'),
        today: calendarDate(bakuToday(), 'en'),
      }),
    ],
  ])('explains a record refused with %s', async (code, status, words) => {
    const user = await openFile(startedPayout());
    recordMock.mockRejectedValue(refusal(status, code));

    const form = screen.getByRole('form', { name: WORDS.recordHeading });
    await user.type(within(form).getByLabelText(new RegExp(WORDS.bankReference)), 'FT1');
    await user.type(within(form).getByLabelText(new RegExp(`^${WORDS.noteLabel}`)), 'Checked');
    await user.click(within(form).getByRole('button', { name: WORDS.recordTransfer }));
    await user.click(screen.getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it('abandons only with a note saying how it is known', async () => {
    const user = await openFile(startedPayout());
    abandonMock.mockResolvedValue(bankPayout());

    await user.click(screen.getByRole('button', { name: WORDS.abandonTransfer }));
    const form = screen.getByRole('form', { name: WORDS.abandonTransfer });
    const confirm = within(form).getByRole('button', { name: WORDS.confirmAbandon });
    expect(confirm).toBeDisabled();

    await user.type(within(form).getByLabelText(new RegExp(WORDS.abandonNoteLabel)), 'Bank shows no debit ');
    await user.click(confirm);

    expect(abandonMock).toHaveBeenCalledWith(PAYOUT, 'Bank shows no debit');
    // Back to a payout that can be started again.
    expect(await screen.findByRole('button', { name: WORDS.startTransfer })).toBeInTheDocument();
    expect(screen.queryByText(WORDS.inProgressTag)).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * The money pages audit: send outcomes, confirms, gating, history
 * ---------------------------------------------------------------------- */

const CAMPAIGN_TITLE = 'Bakı küçə kitabxanası';
const CREATOR_NAME = 'Elvin Quliyev';

/** Sent through the provider, signed by two, ready to send. */
function providerPayout(overrides: Partial<Payout> = {}): Payout {
  return bankPayout({ destinationKind: 'PROVIDER_TOKEN', ...overrides });
}

async function openProviderFile(
  payout: Payout,
  capabilities: readonly StaffCapability[] = ROLE_CAPABILITIES.SUPER_ADMIN,
  file: PayoutFile = fileOf(payout),
) {
  const user = userEvent.setup();
  namesMock.mockResolvedValue({
    accounts: [{ id: CREATOR, name: CREATOR_NAME, slug: 'elvin' }],
    projects: [{ id: PROJECT, title: CAMPAIGN_TITLE }],
  });
  queueMock.mockResolvedValue({ payouts: [payout], page: 0, hasMore: false });
  fileMock.mockResolvedValue(file);
  membershipMock.mockResolvedValue(reader(capabilities));

  render(<PayoutQueue copy={COPY} />);
  await screen.findAllByText(CAMPAIGN_TITLE);
  await user.click(screen.getByRole('button', { expanded: false }));
  await screen.findByText(COPY.signatures);
  return user;
}

describe('a payout row', () => {
  it('names its campaign and creator, and its toggle has a short name of its own', async () => {
    await openProviderFile(providerPayout());

    expect(within(queueSection()).getAllByText(CAMPAIGN_TITLE).length).toBeGreaterThan(0);
    expect(within(queueSection()).getAllByText(CREATOR_NAME).length).toBeGreaterThan(0);
    const toggle = screen.getByRole('button', { expanded: true });
    expect(toggle).toHaveAccessibleName(
      `${COPY.close}: ${fillPlaceholders(COPY.rowSummary, {
        campaign: CAMPAIGN_TITLE,
        creator: CREATOR_NAME,
        amount: '1,250.00 AZN',
        state: COPY.state.APPROVED,
      })}`,
    );
  });

  it('adds the breakdown up: tax and debt withheld are shown, zero deductions are left out', async () => {
    queueMock.mockResolvedValue({
      payouts: [
        providerPayout({
          refunded: ZERO,
          taxWithheld: { amount: '20.00', currency: 'AZN' },
          debtWithheld: { amount: '30.00', currency: 'AZN' },
          net: { amount: '1200.00', currency: 'AZN' },
        }),
      ],
      page: 0,
      hasMore: false,
    });
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));
    render(<PayoutQueue copy={COPY} />);

    const statement = (await screen.findByText(COPY.collected)).closest('dl');
    if (statement === null) throw new Error('the breakdown is not a description list');
    expect(within(statement).getByText(COPY.taxWithheld)).toBeInTheDocument();
    expect(within(statement).getByText('− 20.00 AZN')).toBeInTheDocument();
    expect(within(statement).getByText(COPY.debtWithheld)).toBeInTheDocument();
    expect(within(statement).getByText('− 30.00 AZN')).toBeInTheDocument();
    expect(within(statement).queryByText(COPY.refunded)).not.toBeInTheDocument();
    expect(within(statement).getByText('1,200.00 AZN')).toBeInTheDocument();
  });
});

describe('sending', () => {
  it('asks first, naming the amount, the creator and the campaign', async () => {
    const user = await openProviderFile(providerPayout());

    await user.click(screen.getByRole('button', { name: COPY.send }));

    expect(
      screen.getByText(
        fillPlaceholders(COPY.confirmSend, { amount: '1,250.00 AZN', creator: CREATOR_NAME, campaign: CAMPAIGN_TITLE }),
      ),
    ).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: COPY.back }));
    expect(screen.getByRole('button', { name: COPY.send })).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('says a paid send was paid, closes the file, and reads the queue and the history again', async () => {
    const user = await openProviderFile(providerPayout());
    sendMock.mockResolvedValue(providerPayout({ state: 'PAID', sentAt: '2026-10-15T08:00:00Z' }));

    await sendAndConfirm(user);

    expect(await screen.findByText(COPY.outcome.paidTitle)).toBeInTheDocument();
    expect(
      screen.getByText(
        fillPlaceholders(COPY.outcome.paidBody, { amount: '1,250.00 AZN', creator: CREATOR_NAME, campaign: CAMPAIGN_TITLE }),
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(queueMock).toHaveBeenCalledTimes(2));
    expect(historyMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(COPY.signatures)).not.toBeInTheDocument();
  });

  it('says a refused send failed and why, instead of letting it vanish from the queue', async () => {
    const user = await openProviderFile(providerPayout());
    sendMock.mockResolvedValue(
      providerPayout({ state: 'FAILED', failureCode: 'card_declined', failureMessage: 'Receiver card is blocked' }),
    );

    await sendAndConfirm(user);

    expect(await screen.findByText(COPY.outcome.failedTitle)).toBeInTheDocument();
    expect(
      screen.getByText(
        fillPlaceholders(COPY.outcome.failedBody, {
          amount: '1,250.00 AZN',
          campaign: CAMPAIGN_TITLE,
          reason: 'Receiver card is blocked (card_declined)',
        }),
      ),
    ).toBeInTheDocument();
  });

  it('says an unanswered send is unconfirmed and keeps its file open', async () => {
    const user = await openProviderFile(providerPayout());
    const unanswered = providerPayout({ sendUnconfirmedAt: '2026-10-15T08:00:00Z' });
    sendMock.mockResolvedValue(unanswered);
    fileMock.mockResolvedValue(fileOf(unanswered));

    await sendAndConfirm(user);

    expect(await screen.findByText(COPY.outcome.unconfirmedTitle)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: COPY.unconfirmed.sent })).toBeInTheDocument();
  });

  it('puts a disabled Send beside the reason rather than a button that is a sentence', async () => {
    await openProviderFile(providerPayout(), ROLE_CAPABILITIES.SUPER_ADMIN, { ...fileOf(providerPayout()), stillNeeded: 1 });

    expect(screen.getByRole('button', { name: COPY.send })).toBeDisabled();
    expect(screen.getByText(fillPlaceholders(COPY.sendNeedsSignatures, { count: '1' }))).toBeInTheDocument();
  });
});

describe('cancelling', () => {
  it('asks first, then cancels and says so', async () => {
    const user = await openProviderFile(providerPayout());
    cancelMock.mockResolvedValue(providerPayout({ state: 'CANCELLED' }));

    await user.click(screen.getByRole('button', { name: COPY.cancelPayout }));
    expect(
      screen.getByText(
        fillPlaceholders(COPY.confirmCancel, { amount: '1,250.00 AZN', creator: CREATOR_NAME, campaign: CAMPAIGN_TITLE }),
      ),
    ).toBeInTheDocument();
    expect(cancelMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: COPY.confirmCancelAction }));

    expect(cancelMock).toHaveBeenCalledWith(PAYOUT);
    expect(await screen.findByText(COPY.cancelledNotice)).toBeInTheDocument();
  });
});

describe('who is offered what', () => {
  it('draws no signing, sending or cancelling for a reader without APPROVE_PAYOUT, and says why in words', async () => {
    await openProviderFile(providerPayout({ state: 'PENDING_APPROVAL' }), ROLE_CAPABILITIES.FINANCE, {
      ...fileOf(providerPayout({ state: 'PENDING_APPROVAL' })),
      approvals: [],
      stillNeeded: 2,
    });

    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.send })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.cancelPayout })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.needsApprovePayout)).toBeInTheDocument();
    expect(COPY.needsApprovePayout).not.toMatch(/APPROVE_PAYOUT/);
  });

  it('does not offer a signature on a payout held for its creator, and says why', async () => {
    const held = providerPayout({
      state: 'PENDING_APPROVAL',
      heldForVerification: true,
      creatorStanding: 'AWAITING_DOCUMENTS',
    });
    await openProviderFile(held, ROLE_CAPABILITIES.SUPER_ADMIN, { payout: held, approvals: [], stillNeeded: 2 });

    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.heldNoSign)).toBeInTheDocument();
  });

  it('does not offer a signature on a payout that already has every signature', async () => {
    await openProviderFile(providerPayout());

    expect(screen.queryByRole('button', { name: COPY.approve })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.alreadyApproved)).toBeInTheDocument();
  });

  it('offers a signature on a payout waiting for one, and signs with the note', async () => {
    const waiting = providerPayout({ state: 'PENDING_APPROVAL' });
    const user = await openProviderFile(waiting, ROLE_CAPABILITIES.SUPER_ADMIN, {
      payout: waiting,
      approvals: [],
      stillNeeded: 2,
    });
    approveMock.mockResolvedValue({ payout: waiting, approvals: [], stillNeeded: 1 });

    await user.type(screen.getByLabelText(new RegExp(`^${COPY.noteLabel}`)), 'Statement matches');
    await user.click(screen.getByRole('button', { name: COPY.approve }));

    expect(approveMock).toHaveBeenCalledWith(PAYOUT, 'Statement matches');
  });
});

describe('a send the provider never answered', () => {
  const unanswered = () => providerPayout({ sendUnconfirmedAt: '2026-10-15T08:00:00Z' });

  it('blocks cancelling and records it as sent from the statement, after asking', async () => {
    const user = await openProviderFile(unanswered());
    sentMock.mockResolvedValue(providerPayout({ state: 'PAID' }));

    expect(screen.getByRole('button', { name: COPY.cancelPayout })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: COPY.unconfirmed.sent }));
    const form = screen.getByRole('form', { name: COPY.unconfirmed.sent });
    await user.type(within(form).getByLabelText(new RegExp(COPY.unconfirmed.transactionLabel)), 'PRF-1');
    await user.type(within(form).getByLabelText(new RegExp(COPY.unconfirmed.noteLabel)), 'Line 4 of the statement');
    await user.click(within(form).getByRole('button', { name: COPY.unconfirmed.sent }));

    expect(sentMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(fillPlaceholders(COPY.unconfirmed.confirmSent, { amount: '1,250.00 AZN', reference: 'PRF-1' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.unconfirmed.confirmAction }));

    expect(sentMock).toHaveBeenCalledWith(PAYOUT, 'PRF-1', 'Line 4 of the statement');
    expect(await screen.findByText(COPY.unconfirmed.resolvedSent)).toBeInTheDocument();
  });

  it('records it as not sent after warning that a sent payout would be paid twice', async () => {
    const user = await openProviderFile(unanswered());
    notSentMock.mockResolvedValue(providerPayout({ state: 'FAILED', failureCode: 'confirmed_not_sent' }));

    await user.click(screen.getByRole('button', { name: COPY.unconfirmed.notSent }));
    const form = screen.getByRole('form', { name: COPY.unconfirmed.notSent });
    await user.type(within(form).getByLabelText(new RegExp(COPY.unconfirmed.noteLabel)), 'No debit on the statement');
    await user.click(within(form).getByRole('button', { name: COPY.unconfirmed.notSent }));
    expect(
      screen.getByText(fillPlaceholders(COPY.unconfirmed.confirmNotSent, { amount: '1,250.00 AZN' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.unconfirmed.confirmAction }));

    expect(notSentMock).toHaveBeenCalledWith(PAYOUT, 'No debit on the statement');
    expect(await screen.findByText(COPY.unconfirmed.resolvedNotSent)).toBeInTheDocument();
  });
});

describe('the history', () => {
  it('lists paid payouts first and failed ones under their chip, with the reason', async () => {
    const user = userEvent.setup();
    queueMock.mockResolvedValue({ payouts: [], page: 0, hasMore: false });
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));
    historyMock.mockImplementation(async (state) => ({
      payouts:
        state === 'FAILED'
          ? [providerPayout({ state: 'FAILED', failureCode: 'card_declined', sentAt: '2026-07-02T10:00:00Z' })]
          : [],
      page: 0,
      hasMore: false,
    }));

    render(<PayoutQueue copy={COPY} />);
    await screen.findByText(COPY.history.emptyTitle);
    expect(historyMock).toHaveBeenCalledWith('PAID', 0, expect.any(AbortSignal));

    await user.click(screen.getByRole('button', { name: COPY.state.FAILED }));

    expect(await screen.findByText(fillPlaceholders(COPY.history.failure, { reason: 'card_declined' }))).toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledWith('FAILED', 0, expect.any(AbortSignal));
  });
});

describe('working out a payout', () => {
  async function calculateFor(id: string) {
    const user = userEvent.setup();
    queueMock.mockResolvedValue({ payouts: [], page: 0, hasMore: false });
    membershipMock.mockResolvedValue(reader(ROLE_CAPABILITIES.SUPER_ADMIN));
    render(<PayoutQueue copy={COPY} />);
    await screen.findByText(COPY.emptyTitle);
    await user.type(screen.getByLabelText(new RegExp(`^${COPY.campaignLabel}`)), id);
    await user.click(screen.getByRole('button', { name: COPY.calculate }));
    return user;
  }

  it('refuses something that is not an identifier without asking the service', async () => {
    await calculateFor('gence-senetkarliq');

    expect(screen.getByText(COPY.campaignInvalid)).toBeInTheDocument();
    expect(calculateMock).not.toHaveBeenCalled();
  });

  it.each([
    'PAYOUT_ALREADY_IN_FLIGHT',
    'CAMPAIGN_ALREADY_PAID_OUT',
    'PAYOUT_SEND_UNCONFIRMED',
    'PROJECT_NOT_FOUND',
    'NOTHING_TO_PAY',
  ])('words %s in the reader language', async (code) => {
    calculateMock.mockRejectedValue(refusal(code === 'PROJECT_NOT_FOUND' ? 404 : 409, code));

    await calculateFor(PROJECT);

    expect(await screen.findByText(COPY.calculateRefusal[code] ?? '')).toBeInTheDocument();
  });

  it('words a request the service rejected before any code ran, never in its English', async () => {
    calculateMock.mockRejectedValue(
      new ApiError(400, { status: 400, title: 'Bad Request', detail: 'Invalid request content.' }),
    );

    await calculateFor(PROJECT);

    expect(await screen.findByText(COPY.refusal.INVALID_REQUEST)).toBeInTheDocument();
    expect(screen.queryByText('Invalid request content.')).not.toBeInTheDocument();
  });

  it('names the campaign it worked out, not its identifier', async () => {
    namesMock.mockResolvedValue({ accounts: [], projects: [{ id: PROJECT, title: CAMPAIGN_TITLE }] });
    calculateMock.mockResolvedValue(providerPayout({ state: 'CALCULATED', payableAt: '2026-10-28T18:00:00Z' }));

    await calculateFor(PROJECT);

    await screen.findByText(COPY.calculatedTitle);
    expect(await screen.findByText(CAMPAIGN_TITLE)).toBeInTheDocument();
  });
});
