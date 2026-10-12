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
  readMock.mockResolvedValue([WAITING, MISMATCHED, CARD]);
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

  it('narrows to one state without asking the service again', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AZ21…1944');

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'NAME_MISMATCH') }));

    expect(screen.getByText('AZ77…0042')).toBeInTheDocument();
    expect(screen.queryByText('AZ21…1944')).not.toBeInTheDocument();
    expect(screen.queryByText('•••• 4242')).not.toBeInTheDocument();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('says so when a state has nothing in it, and when nothing is waiting at all', async () => {
    const user = userEvent.setup();
    readMock.mockResolvedValue([WAITING]);
    renderQueue();
    await screen.findByText('AZ21…1944');

    await user.click(screen.getByRole('button', { name: word(WORDS.standing, 'REJECTED') }));
    expect(screen.getByText(COPY.emptyFilterTitle)).toBeInTheDocument();
  });

  it('says the queue is empty in words', async () => {
    readMock.mockResolvedValue([]);
    renderQueue();

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
  });

  it('says when it is holding a full page, because there are more behind it', async () => {
    readMock.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        ...WAITING,
        creatorId: `0193f2a1-0000-7000-8000-${String(index).padStart(12, '0')}`,
      })),
    );
    renderQueue();

    expect(await screen.findByText(/50/)).toHaveTextContent(COPY.capped.replace('{count}', '50'));
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
