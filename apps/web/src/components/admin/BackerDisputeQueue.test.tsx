import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  BACKER_DISPUTE_PAGE_SIZE,
  decideBackerDispute,
  readBackerDisputeQueue,
  type BackerDispute,
} from '../../lib/admin/backer-disputes';
import { lookUpNames } from '../../lib/admin/directory';
import { ROLE_CAPABILITIES, type StaffMembership, type StaffRole } from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { backerDisputeQueueCopyFrom } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { translatorFor } from '../../test-copy';
import { BackerDisputeQueue } from './BackerDisputeQueue';
import { ConsoleMembershipProvider } from './ConsoleMembership';

const COPY = backerDisputeQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/backer-disputes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/backer-disputes')>()),
  readBackerDisputeQueue: vi.fn(),
  decideBackerDispute: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const readMock = vi.mocked(readBackerDisputeQueue);
const decideMock = vi.mocked(decideBackerDispute);
const namesMock = vi.mocked(lookUpNames);

const BACKER = '0193f2a1-0000-7000-8000-00000000e001';
const CAMPAIGN = '0193f2a1-0000-7000-8000-00000000b001';

const DISPUTE: BackerDispute = {
  id: '0193f2a1-0000-7000-8000-00000000d001',
  pledgeId: '0193f2a1-0000-7000-8000-00000000a001',
  projectId: CAMPAIGN,
  payoutId: '0193f2a1-0000-7000-8000-00000000c001',
  reason: 'The reward was described differently when I backed it.',
  state: 'OPEN',
  openedAt: '2026-09-13T10:00:00Z',
  refundable: { amount: '45.00', currency: 'AZN' },
  backerId: BACKER,
};

const AMOUNT = formatMoney({ amount: '45.00', currency: 'AZN' });

function reader(roles: readonly StaffRole[]): StaffMembership {
  const capabilities = new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]));
  return { accountId: 'me', staff: true, bootstrapped: false, roles: [...roles], capabilities: [...capabilities] };
}

function show(membership: StaffMembership = reader(['FINANCE'])) {
  return render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
      <BackerDisputeQueue copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

beforeEach(() => {
  readMock.mockReset();
  decideMock.mockReset();
  namesMock.mockReset();
  namesMock.mockResolvedValue({
    accounts: [{ id: BACKER, name: 'Aysel Məmmədova', slug: 'aysel' }],
    projects: [{ id: CAMPAIGN, title: 'Şəki ipəyi', slug: 'seki-ipeyi' }],
  });
});

describe('the backer dispute queue', () => {
  it('shows the backer’s reason, and upholding asks before it refunds, naming the amount', async () => {
    readMock.mockResolvedValueOnce([DISPUTE]).mockResolvedValue([]);
    decideMock.mockResolvedValue({ ...DISPUTE, state: 'UPHELD' });
    const user = userEvent.setup();
    show();

    expect(await screen.findByText(DISPUTE.reason)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Note/), 'Checked against the campaign page.');

    await user.click(screen.getByRole('button', { name: COPY.uphold }));
    expect(decideMock).not.toHaveBeenCalled();
    expect(screen.getByText(fillPlaceholders(COPY.confirmUphold, { amount: AMOUNT }))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.confirmNow }));

    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith(DISPUTE.id, 'UPHOLD', 'Checked against the campaign page.'),
    );
    // Decided, so the queue is read again — and what happened is still said after it.
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(fillPlaceholders(COPY.upheldNotice, { amount: AMOUNT }))).toBeInTheDocument();
  });

  it('says on the row what upholding would refund, and names the backer and the campaign', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    show();

    expect(await screen.findByText(fillPlaceholders(COPY.refundableLine, { amount: AMOUNT }))).toBeInTheDocument();
    expect(await screen.findByText('Aysel Məmmədova')).toBeInTheDocument();
    expect(screen.getByText('Şəki ipəyi')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatDate(DISPUTE.openedAt, 'en')))).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-13/)).not.toBeInTheDocument();
  });

  it('rejects in one press, with no note sent as null, and says so above the list', async () => {
    readMock.mockResolvedValueOnce([DISPUTE]).mockResolvedValue([]);
    decideMock.mockResolvedValue({ ...DISPUTE, state: 'REJECTED' });
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: COPY.reject }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledWith(DISPUTE.id, 'REJECT', null));
    expect(await screen.findByText(COPY.rejectedNotice)).toBeInTheDocument();
  });

  it('says a dispute somebody else decided after the list is read again', async () => {
    readMock.mockResolvedValueOnce([DISPUTE]).mockResolvedValue([]);
    decideMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'DISPUTE_ALREADY_DECIDED' }));
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: COPY.reject }));

    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(COPY.alreadyDecided)).toBeInTheDocument();
  });

  it('says a refused refund left the dispute open', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    decideMock.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'DISPUTE_REFUND_FAILED', meta: { awaitingBankTransfer: false } }),
    );
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: COPY.uphold }));
    await user.click(screen.getByRole('button', { name: COPY.confirmNow }));

    expect(await screen.findByText(COPY.refundFailed)).toBeInTheDocument();
    expect(screen.getByText(DISPUTE.reason)).toBeInTheDocument();
  });

  it('sends a refund waiting for a bank transfer to the refunds screen instead of saying "try again"', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    decideMock.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'DISPUTE_REFUND_FAILED', meta: { awaitingBankTransfer: true } }),
    );
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: COPY.uphold }));
    await user.click(screen.getByRole('button', { name: COPY.confirmNow }));

    const link = await screen.findByRole('link', { name: COPY.refundsLink });
    expect(link.getAttribute('href')).toMatch(/\/admin\/refunds$/);
    expect(screen.queryByText(COPY.refundFailed)).not.toBeInTheDocument();
  });

  it.each(['DISPUTE_WINDOW_CLOSED', 'NOTHING_TO_DISPUTE', 'DISPUTE_NOT_FOUND', 'REFUND_CHARGE_DISPUTED'])(
    'words the refusal %s',
    async (code) => {
      readMock.mockResolvedValue([DISPUTE]);
      decideMock.mockRejectedValue(new ApiError(409, { status: 409, code, title: 'English title' }));
      const user = userEvent.setup();
      show();

      await user.click(await screen.findByRole('button', { name: COPY.reject }));

      expect(COPY.errors[code]).toBeTruthy();
      expect(await screen.findByText(COPY.errors[code] ?? '')).toBeInTheDocument();
      expect(screen.queryByText('English title')).not.toBeInTheDocument();
    },
  );

  it('does not offer upholding to a reader who cannot refund', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    show(reader(['MODERATOR']));

    expect(await screen.findByRole('button', { name: COPY.reject })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.uphold })).not.toBeInTheDocument();
    expect(screen.getByText(/ISSUE_REFUND/)).toBeInTheDocument();
  });

  it('pages only while a page comes back full', async () => {
    const full = Array.from({ length: BACKER_DISPUTE_PAGE_SIZE }, (_, n) => ({ ...DISPUTE, id: `d-${n}` }));
    readMock.mockResolvedValueOnce(full).mockResolvedValue([{ ...DISPUTE, id: 'last' }]);
    const user = userEvent.setup();
    show();

    const next = await screen.findByRole('button', { name: COPY.next });
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() => expect(readMock).toHaveBeenLastCalledWith(1, expect.anything()));
    await waitFor(() => expect(screen.getByRole('button', { name: COPY.next })).toBeDisabled());
  });

  it('offers no next page after a short one', async () => {
    readMock.mockResolvedValue([DISPUTE]);
    show();

    await screen.findByText(DISPUTE.reason);
    expect(screen.queryByRole('button', { name: COPY.next })).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    readMock.mockResolvedValue([]);
    show();

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
  });
});
