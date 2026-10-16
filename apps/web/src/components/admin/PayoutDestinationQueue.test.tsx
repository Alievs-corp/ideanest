import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { AdminPayoutDestination } from '../../lib/admin/api';
import {
  readPayoutDestinationQueue,
  rejectPayoutDestination,
  revealPayoutBankAccount,
  verifyPayoutDestination,
  type PayoutDestinationQueuePage,
} from '../../lib/admin/payout-destinations';
import { lookUpNames } from '../../lib/admin/directory';
import { ROLE_CAPABILITIES, type StaffMembership, type StaffRole } from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { payoutDestinationQueueCopyFrom } from '../../lib/i18n/admin/money-copy';
import { translatorFor } from '../../test-copy';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { PayoutDestinationQueue } from './PayoutDestinationQueue';

const COPY = payoutDestinationQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);
const WORDS = COPY.destination;

vi.mock('../../lib/admin/payout-destinations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/payout-destinations')>()),
  readPayoutDestinationQueue: vi.fn(),
  verifyPayoutDestination: vi.fn(),
  rejectPayoutDestination: vi.fn(),
  revealPayoutBankAccount: vi.fn(),
}));

// `lookUpNames` and not `readDirectory`, for `console-identity.test.tsx`'s reason.
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const readMock = vi.mocked(readPayoutDestinationQueue);
const verifyMock = vi.mocked(verifyPayoutDestination);
const rejectMock = vi.mocked(rejectPayoutDestination);
const revealMock = vi.mocked(revealPayoutBankAccount);
const namesMock = vi.mocked(lookUpNames);

const AYAN = '0193f2a1-0000-7000-8000-00000000a001';
const KAMRAN = '0193f2a1-0000-7000-8000-00000000a002';
const LALA = '0193f2a1-0000-7000-8000-00000000a003';

const WAITING: AdminPayoutDestination = {
  creatorId: AYAN,
  recorded: true,
  standing: 'AWAITING_VERIFICATION',
  kind: 'BANK_TRANSFER',
  provider: 'BANK_TRANSFER',
  holderName: 'AYAN MAMMADOVA',
  displayHint: 'AZ21…1944',
  updatedAt: '2026-10-01T09:00:00Z',
};

const MISMATCHED: AdminPayoutDestination = {
  creatorId: KAMRAN,
  recorded: true,
  standing: 'NAME_MISMATCH',
  kind: 'BANK_TRANSFER',
  provider: 'BANK_TRANSFER',
  holderName: 'SOMEBODY ELSE',
  displayHint: 'AZ77…0042',
  updatedAt: '2026-10-02T09:00:00Z',
};

const CARD: AdminPayoutDestination = {
  creatorId: LALA,
  recorded: true,
  standing: 'REJECTED',
  kind: 'PROVIDER_TOKEN',
  provider: 'PAYRIFF',
  holderName: 'LALA HASANOVA',
  displayHint: '•••• 4242',
  rejectionReason: 'UNREADABLE',
  updatedAt: '2026-10-03T09:00:00Z',
};

function pageOf(
  destinations: readonly AdminPayoutDestination[],
  { page = 0, hasMore = false }: { page?: number; hasMore?: boolean } = {},
): PayoutDestinationQueuePage {
  return { destinations, page, hasMore };
}

function reader(...roles: readonly StaffRole[]): StaffMembership {
  const capabilities = new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]));
  return {
    accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    staff: true,
    bootstrapped: false,
    roles: [...roles],
    capabilities: [...capabilities],
  };
}

function renderQueue(membership: StaffMembership = reader('COMPLIANCE')) {
  return render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
      <PayoutDestinationQueue copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

/** The row a creator's destination is drawn in. */
async function rowOf(text: string): Promise<HTMLElement> {
  const row = (await screen.findByText(text)).closest('li');
  if (row === null) throw new Error(`${text} is not inside a row`);
  return row;
}

function word(table: Readonly<Record<string, string>>, key: string): string {
  const found = table[key];
  if (found === undefined) throw new Error(`the catalogue has no word for ${key}`);
  return found;
}

beforeEach(() => {
  vi.resetAllMocks();
  readMock.mockResolvedValue(pageOf([WAITING, MISMATCHED, CARD]));
  namesMock.mockResolvedValue({
    accounts: [{ id: AYAN, name: 'Ayan Məmmədova', slug: 'ayan-m' }],
    projects: [],
  });
});

describe('the payout destination queue — issue #396', () => {
  it('draws each destination with its kind, masked hint, holder and standing', async () => {
    renderQueue();

    const row = await rowOf('AZ21…1944');
    expect(within(row).getByText(word(WORDS.kind, 'BANK_TRANSFER'))).toBeInTheDocument();
    expect(within(row).getByText(/AYAN MAMMADOVA/)).toBeInTheDocument();
    expect(within(row).getByText(word(WORDS.standing, 'AWAITING_VERIFICATION'))).toBeInTheDocument();
    // The directory names the creator; the identifier stays beside the name.
    expect(await within(row).findByText('Ayan Məmmədova')).toBeInTheDocument();

    const card = await rowOf('•••• 4242');
    expect(within(card).getByText(word(WORDS.kind, 'PROVIDER_TOKEN'))).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(word(WORDS.rejectionReason, 'UNREADABLE')))).toBeInTheDocument();
  });

  it('asks the service for the first page of everything waiting', async () => {
    renderQueue();
    await screen.findByText('AZ21…1944');

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith(expect.objectContaining({ state: null, page: 0 }));
  });

  it('asks the service for one state rather than narrowing the page it holds — #419', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AZ21…1944');
    readMock.mockResolvedValue(pageOf([MISMATCHED]));

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'NAME_MISMATCH') }));

    expect(await screen.findByText('AZ77…0042')).toBeInTheDocument();
    expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'NAME_MISMATCH', page: 0 }));
    // What is drawn is what the service answered, not the first answer filtered.
    expect(screen.queryByText('AZ21…1944')).not.toBeInTheDocument();
    expect(screen.queryByText('•••• 4242')).not.toBeInTheDocument();
  });

  it('draws a waived destination under the state its row is in, still tagged as waived', async () => {
    const user = userEvent.setup();
    readMock.mockImplementation(async ({ state } = {}) =>
      state === 'REJECTED' ? pageOf([{ ...CARD, standing: 'WAIVED' }]) : pageOf([WAITING]),
    );
    renderQueue();
    await screen.findByText('AZ21…1944');

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'REJECTED') }));

    const card = await rowOf('•••• 4242');
    expect(within(card).getByText(word(WORDS.standing, 'WAIVED'))).toBeInTheDocument();
  });

  it('says so when a state has nothing in it', async () => {
    const user = userEvent.setup();
    readMock.mockImplementation(async ({ state } = {}) => (state == null ? pageOf([WAITING]) : pageOf([])));
    renderQueue();
    await screen.findByText('AZ21…1944');

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'REJECTED') }));

    expect(await screen.findByText(COPY.emptyFilterTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
  });

  it('says the queue is empty in words', async () => {
    readMock.mockResolvedValue(pageOf([]));
    renderQueue();

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.next })).not.toBeInTheDocument();
  });

  it('offers no pager when everything fits on one page', async () => {
    renderQueue();
    await screen.findByText('AZ21…1944');

    expect(screen.queryByRole('button', { name: COPY.next })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.previous })).not.toBeInTheDocument();
  });

  it('pages forward and back through the service while it says there is more', async () => {
    const user = userEvent.setup();
    readMock.mockImplementation(async ({ page = 0 } = {}) =>
      page === 0 ? pageOf([WAITING], { page: 0, hasMore: true }) : pageOf([CARD], { page: 1, hasMore: false }),
    );
    renderQueue();
    await screen.findByText('AZ21…1944');

    expect(screen.getByRole('button', { name: COPY.previous })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: COPY.next }));

    expect(await screen.findByText('•••• 4242')).toBeInTheDocument();
    expect(screen.queryByText('AZ21…1944')).not.toBeInTheDocument();
    expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ state: null, page: 1 }));
    expect(screen.getByRole('button', { name: COPY.next })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: COPY.previous }));

    expect(await screen.findByText('AZ21…1944')).toBeInTheDocument();
    expect(readMock).toHaveBeenLastCalledWith(expect.objectContaining({ state: null, page: 0 }));
  });

  it('goes back to the first page when the state changes', async () => {
    const user = userEvent.setup();
    readMock.mockImplementation(async ({ page = 0 } = {}) =>
      pageOf(page === 0 ? [WAITING] : [CARD], { page, hasMore: page === 0 }),
    );
    renderQueue();
    await screen.findByText('AZ21…1944');
    await user.click(screen.getByRole('button', { name: COPY.next }));
    await screen.findByText('•••• 4242');

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'AWAITING_VERIFICATION') }));

    await waitFor(() =>
      expect(readMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: 'AWAITING_VERIFICATION', page: 0 }),
      ),
    );
  });

  it('says so when a next page turns out empty, and offers the way back', async () => {
    const user = userEvent.setup();
    // Exactly a page's worth: the service offers a next page, and it holds nothing.
    readMock.mockImplementation(async ({ page = 0 } = {}) =>
      page === 0 ? pageOf([WAITING], { hasMore: true }) : pageOf([], { page: 1 }),
    );
    renderQueue();
    await screen.findByText('AZ21…1944');

    await user.click(screen.getByRole('button', { name: COPY.next }));

    expect(await screen.findByText(COPY.emptyPageTitle)).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.previous })).toBeEnabled();
  });

  it('verifies only on the second press, and redraws the row from the answer', async () => {
    const user = userEvent.setup();
    verifyMock.mockResolvedValue({ ...WAITING, standing: 'VERIFIED', verifiedAt: '2026-10-12T09:00:00Z' });
    renderQueue();
    const row = await rowOf('AZ21…1944');

    await user.click(within(row).getByRole('button', { name: WORDS.decision.verify }));
    expect(verifyMock).not.toHaveBeenCalled();
    expect(within(row).getByText(WORDS.decision.confirmVerify)).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: WORDS.decision.confirmVerifyAction }));

    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith(AYAN));
    expect(await within(row).findByText(word(WORDS.standing, 'VERIFIED'))).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.decision.verify })).not.toBeInTheDocument();
  });

  it('does not offer to verify a name mismatch, and says why', async () => {
    renderQueue();
    const row = await rowOf('AZ77…0042');

    expect(within(row).getByText(WORDS.decision.nameMismatch)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.decision.verify })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: WORDS.decision.reject })).toBeInTheDocument();
  });

  it('rejects only with a reason from the closed set', async () => {
    const user = userEvent.setup();
    rejectMock.mockResolvedValue({ ...MISMATCHED, standing: 'REJECTED', rejectionReason: 'MISMATCHED_NAME' });
    renderQueue();
    const row = await rowOf('AZ77…0042');

    await user.click(within(row).getByRole('button', { name: WORDS.decision.reject }));
    const send = within(row).getByRole('button', { name: WORDS.decision.confirmReject });
    expect(send).toBeDisabled();

    await user.selectOptions(
      within(row).getByLabelText(new RegExp(WORDS.decision.reasonLabel)),
      'MISMATCHED_NAME',
    );
    await user.click(send);

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith(KAMRAN, 'MISMATCHED_NAME'));
    expect(await within(row).findByText(word(WORDS.standing, 'REJECTED'))).toBeInTheDocument();
  });

  it('says a reviewer cannot decide their own destination', async () => {
    const user = userEvent.setup();
    verifyMock.mockRejectedValue(
      new ApiError(403, { status: 403, code: 'SELF_VERIFIED_DESTINATION', title: 'Your own destination' }),
    );
    renderQueue();
    const row = await rowOf('AZ21…1944');

    await user.click(within(row).getByRole('button', { name: WORDS.decision.verify }));
    await user.click(within(row).getByRole('button', { name: WORDS.decision.confirmVerifyAction }));

    expect(await within(row).findByText(WORDS.decision.self)).toBeInTheDocument();
    expect(within(row).getByText(word(WORDS.standing, 'AWAITING_VERIFICATION'))).toBeInTheDocument();
  });

  it('reveals a bank account on the row only when asked, and never a card', async () => {
    const user = userEvent.setup();
    revealMock.mockResolvedValue({
      creatorId: AYAN,
      iban: 'AZ21NABZ00000000137010001944',
      holderName: 'AYAN MAMMADOVA',
      displayHint: 'AZ21…1944',
    });
    renderQueue();
    const row = await rowOf('AZ21…1944');

    // The warning is there before the press, and nothing has been read yet.
    expect(within(row).getByText(WORDS.reveal.audited)).toBeInTheDocument();
    expect(revealMock).not.toHaveBeenCalled();

    await user.click(within(row).getByRole('button', { name: WORDS.reveal.action }));

    expect(await within(row).findByText('AZ21 NABZ 0000 0000 1370 1000 1944')).toBeInTheDocument();
    expect(revealMock).toHaveBeenCalledTimes(1);
    expect(revealMock).toHaveBeenCalledWith(AYAN, expect.anything());

    const card = await rowOf('•••• 4242');
    expect(within(card).queryByRole('button', { name: WORDS.reveal.action })).not.toBeInTheDocument();
  });

  it('offers no reveal to a reader without READ_BANK_DETAILS', async () => {
    renderQueue({ ...reader('COMPLIANCE'), capabilities: ['VERIFY_PAYOUT_DESTINATION'] });
    await screen.findByText('AZ21…1944');

    expect(screen.queryByRole('button', { name: WORDS.reveal.action })).not.toBeInTheDocument();
    expect(screen.queryByText(WORDS.reveal.audited)).not.toBeInTheDocument();
  });

  it('links to the account only for a reader who can open it', async () => {
    const { unmount } = renderQueue();
    await screen.findByText('AZ21…1944');
    expect(screen.queryByRole('link', { name: /Open account/ })).not.toBeInTheDocument();
    unmount();

    renderQueue(reader('SUPER_ADMIN'));
    const row = await rowOf('AZ21…1944');
    const link = await within(row).findByRole('link', {
      name: COPY.openAccountLabel.replace('{name}', 'Ayan Məmmədova'),
    });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/admin/users/${AYAN}`));
  });

  it('hands a refusal to the shared refusal screen', async () => {
    readMock.mockRejectedValue(
      new ApiError(403, {
        status: 403,
        code: 'INSUFFICIENT_STAFF_CAPABILITY',
        meta: { capability: 'VERIFY_PAYOUT_DESTINATION' },
      }),
    );
    renderQueue(reader('FINANCE'));

    await waitFor(() => expect(screen.queryByText('AZ21…1944')).not.toBeInTheDocument());
    expect(await screen.findByText(/VERIFY_PAYOUT_DESTINATION/)).toBeInTheDocument();
  });
});

describe('what a reviewer is offered on a destination', () => {
  it('does not offer to verify a waived destination whose own state is a name mismatch', async () => {
    readMock.mockResolvedValue(pageOf([{ ...MISMATCHED, standing: 'WAIVED', reviewState: 'NAME_MISMATCH' }]));
    renderQueue();
    const row = await rowOf('AZ77…0042');

    expect(within(row).getByText(word(WORDS.standing, 'WAIVED'))).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.decision.verify })).not.toBeInTheDocument();
    expect(within(row).getByText(WORDS.decision.nameMismatch)).toBeInTheDocument();
  });

  it('says what verifying a rejected destination does, before and when it is pressed', async () => {
    const user = userEvent.setup();
    readMock.mockResolvedValue(pageOf([{ ...CARD, reviewState: 'REJECTED' }]));
    renderQueue();
    const row = await rowOf('•••• 4242');

    expect(within(row).getByText(WORDS.decision.verifyRejected)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: WORDS.decision.reject })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: WORDS.decision.verify }));

    expect(within(row).getByText(WORDS.decision.confirmVerifyRejected)).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('calls the unfiltered chip what it is, and names no capability in its words', async () => {
    readMock.mockResolvedValue(pageOf([WAITING]));
    renderQueue();
    await screen.findByText('AZ21…1944');

    expect(screen.getByRole('button', { name: COPY.everything })).toHaveAttribute('aria-pressed', 'true');
    expect(WORDS.reveal.forbidden).not.toMatch(/READ_BANK_DETAILS/);
  });
});
