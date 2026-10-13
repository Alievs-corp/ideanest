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
import { readPayout, readPayoutQueue, sendPayout, type Payout, type PayoutFile } from '../../lib/admin/payouts';
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
});

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
    await user.click(await screen.findByRole('button', { name: COPY.send }));

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
    expect(screen.getByText(COPY.state.CANCELLED)).toBeInTheDocument();
    expect(queueMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: COPY.cancel })).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: COPY.send }));

    expect(await screen.findByText(COPY.refusal.FIGURES_MOVED)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: COPY.send })).not.toBeInTheDocument());
    expect(screen.getByText(COPY.state.CANCELLED)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: COPY.cancel })).toBeDisabled();
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
          date: bakuToday(),
        }),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: WORDS.confirmRecordAction }));

    expect(recordMock).toHaveBeenCalledWith(PAYOUT, {
      bankReference: 'FT26285ABC12',
      transferredOn: bakuToday(),
      note: 'Statement line 14',
    });
    expect(await screen.findByText(fillPlaceholders(WORDS.paidOn, { date: bakuToday() }))).toBeInTheDocument();
  });

  it.each([
    ['PAYOUT_BANK_TRANSFER_ALREADY_RECORDED', 409, COPY.refusal.PAYOUT_BANK_TRANSFER_ALREADY_RECORDED],
    ['PAYOUT_REFERENCE_TAKEN', 409, COPY.refusal.PAYOUT_REFERENCE_TAKEN],
    [
      'BANK_TRANSFER_DATE_OUT_OF_RANGE',
      400,
      fillPlaceholders(COPY.refusal.BANK_TRANSFER_DATE_OUT_OF_RANGE, { start: bakuToday(), today: bakuToday() }),
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
