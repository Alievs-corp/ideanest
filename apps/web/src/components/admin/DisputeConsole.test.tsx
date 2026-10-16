import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  listDisputes,
  readDispute,
  readDisputeQueue,
  resolveDispute,
  submitEvidence,
  type Dispute,
} from '../../lib/admin/disputes';
import { lookUpNames } from '../../lib/admin/directory';
import { ROLE_CAPABILITIES, type StaffMembership, type StaffRole } from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { disputeConsoleCopyFrom } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatMoney } from '../../lib/money';
import { translatorFor } from '../../test-copy';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { DisputeConsole } from './DisputeConsole';

const COPY = disputeConsoleCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/disputes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/disputes')>()),
  readDisputeQueue: vi.fn(),
  readDispute: vi.fn(),
  resolveDispute: vi.fn(),
  submitEvidence: vi.fn(),
  addEvidence: vi.fn(),
  listDisputes: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const queueMock = vi.mocked(readDisputeQueue);
const caseMock = vi.mocked(readDispute);
const resolveMock = vi.mocked(resolveDispute);
const submitMock = vi.mocked(submitEvidence);
const closedMock = vi.mocked(listDisputes);
const namesMock = vi.mocked(lookUpNames);

const BACKER = '0193f2a1-0000-7000-8000-00000000e001';
const CAMPAIGN = '0193f2a1-0000-7000-8000-00000000b001';

const CASE: Dispute = {
  id: 'e1e1e1e1-aaaa-4bbb-8ccc-ddddeeee0001',
  chargeTransactionId: 'c0ffee00-1111-4222-8333-444455556607',
  pledgeId: 'd4c3b2a1-0f9e-4d8c-b7a6-112233445507',
  projectId: CAMPAIGN,
  provider: 'PAYRIFF',
  providerDisputeId: 'PRF-CB-2026-00417',
  amount: { amount: '150.00', currency: 'AZN' },
  fee: { amount: '15.00', currency: 'AZN' },
  reasonCode: 'product_not_received',
  state: 'OPEN',
  evidenceDueAt: '2099-10-17T20:00:00Z',
  openedAt: '2026-10-09T06:12:40.000000Z',
  evidence: [],
  backerId: BACKER,
};

function reader(roles: readonly StaffRole[]): StaffMembership {
  const capabilities = new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]));
  return { accountId: 'me', staff: true, bootstrapped: false, roles: [...roles], capabilities: [...capabilities] };
}

function show(membership: StaffMembership = reader(['FINANCE'])) {
  return render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
      <DisputeConsole copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function openCase(user: User): Promise<void> {
  await user.click(await screen.findByRole('button', { expanded: false, name: /150/ }));
}

/** The open queue, apart from the closed cases' chips that carry the same three words. */
function queue() {
  return within(screen.getByRole('region', { name: new RegExp(`^${COPY.heading}`) }));
}

beforeEach(() => {
  for (const mock of [queueMock, caseMock, resolveMock, submitMock, closedMock, namesMock]) mock.mockReset();
  queueMock.mockResolvedValue({ disputes: [CASE], page: 0, hasMore: false });
  caseMock.mockResolvedValue(CASE);
  closedMock.mockResolvedValue({ disputes: [], page: 0, hasMore: false });
  namesMock.mockResolvedValue({
    accounts: [{ id: BACKER, name: 'Rəşad Məmmədov', slug: 'resad' }],
    projects: [{ id: CAMPAIGN, title: 'Bakı velosiped emalatxanası', slug: 'baki-velosiped' }],
  });
});

describe('the chargeback queue', () => {
  it('asks before recording a loss, naming the amount, the fee and the creator’s possible debt', async () => {
    const user = userEvent.setup();
    resolveMock.mockResolvedValue({ ...CASE, state: 'LOST' });
    show();
    await openCase(user);

    await user.click(await queue().findByRole('button', { name: COPY.state.LOST }));

    expect(resolveMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: COPY.confirmHeading });
    expect(confirm).toHaveTextContent(
      fillPlaceholders(COPY.confirmLoss, {
        outcome: COPY.state.LOST,
        amount: formatMoney(CASE.amount),
        fee: formatMoney(CASE.fee),
      }),
    );
    expect(confirm).toHaveTextContent(
      fillPlaceholders(COPY.confirmDebt, { total: formatMoney({ amount: '165.00', currency: 'AZN' }) }),
    );
    expect(confirm).toHaveTextContent(COPY.confirmFinal);

    queueMock.mockResolvedValue({ disputes: [], page: 0, hasMore: false });
    await user.click(within(confirm).getByRole('button', { name: COPY.confirmAction }));

    expect(resolveMock).toHaveBeenCalledWith(CASE.id, 'LOST');
    // Said above the list, which the case has now left.
    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(fillPlaceholders(COPY.resolvedNotice, { outcome: COPY.state.LOST }))).toBeInTheDocument();
    // And the closed list is read again.
    await waitFor(() => expect(closedMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('says a win moves nothing, and a cancelled confirmation records nothing', async () => {
    const user = userEvent.setup();
    show();
    await openCase(user);

    await user.click(await queue().findByRole('button', { name: COPY.state.WON }));
    expect(screen.getByRole('group', { name: COPY.confirmHeading })).toHaveTextContent(
      fillPlaceholders(COPY.confirmWon, { outcome: COPY.state.WON }),
    );
    await user.click(screen.getByRole('button', { name: COPY.cancel }));

    expect(screen.queryByRole('group', { name: COPY.confirmHeading })).not.toBeInTheDocument();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('offers no evidence form, answer or outcome to a reader without MANAGE_DISPUTES', async () => {
    const user = userEvent.setup();
    show({ ...reader([]), capabilities: ['VIEW_FINANCE'] });
    await openCase(user);

    expect(await screen.findByText(COPY.evidenceHeading)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.markAnswered })).not.toBeInTheDocument();
    expect(queue().queryByRole('button', { name: COPY.state.LOST })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.add })).not.toBeInTheDocument();
  });

  it('turns "mark answered" off while there is nothing new to send, and says why', async () => {
    const user = userEvent.setup();
    caseMock.mockResolvedValue({
      ...CASE,
      evidence: [
        {
          id: 'p1',
          kind: 'RECEIPT',
          description: 'Receipt',
          submittedAt: '2026-10-05T09:00:00Z',
          createdAt: '2026-10-03T14:10:00Z',
          createdBy: 'me',
        },
      ],
    });
    show();
    await openCase(user);

    expect(await screen.findByRole('button', { name: COPY.markAnswered })).toBeDisabled();
    expect(screen.getByText(COPY.nothingUnsent)).toBeInTheDocument();
  });

  it('answers a case with unsent evidence and says so above the list', async () => {
    const user = userEvent.setup();
    caseMock.mockResolvedValue({
      ...CASE,
      evidence: [
        { id: 'p1', kind: 'RECEIPT', description: 'Receipt', createdAt: '2026-10-03T14:10:00Z', createdBy: 'me' },
      ],
    });
    submitMock.mockResolvedValue({ ...CASE, state: 'UNDER_REVIEW' });
    show();
    await openCase(user);

    await user.click(await screen.findByRole('button', { name: COPY.markAnswered }));

    expect(submitMock).toHaveBeenCalledWith(CASE.id);
    expect(await screen.findByText(COPY.answeredNotice)).toBeInTheDocument();
  });

  it.each([
    [
      new ApiError(409, { code: 'DISPUTE_ALREADY_RESOLVED', title: 'Already resolved', meta: { state: 'LOST' } }),
      fillPlaceholders(COPY.errors['DISPUTE_ALREADY_RESOLVED'] ?? '', { state: COPY.state.LOST }),
    ],
    [new ApiError(400, { code: 'NOT_A_DISPUTE_OUTCOME', title: 'Not an outcome' }), COPY.errors['NOT_A_DISPUTE_OUTCOME']],
    [new ApiError(404, { code: 'DISPUTE_NOT_FOUND', title: 'No such dispute' }), COPY.errors['DISPUTE_NOT_FOUND']],
  ])('words a refused outcome in the reader’s language (%#)', async (refusal, sentence) => {
    const user = userEvent.setup();
    resolveMock.mockRejectedValue(refusal);
    show();
    await openCase(user);

    await user.click(await queue().findByRole('button', { name: COPY.state.CONCEDED }));
    await user.click(screen.getByRole('button', { name: COPY.confirmAction }));

    expect(sentence).toBeTruthy();
    expect(await screen.findByText(sentence ?? '')).toBeInTheDocument();
    expect(screen.queryByText(/Already resolved|Not an outcome|No such dispute/)).not.toBeInTheDocument();
  });

  it('names the provider in its own spelling, the backer and the campaign, and quotes an unknown reason code', async () => {
    queueMock.mockResolvedValue({ disputes: [{ ...CASE, reasonCode: 'visa_13.1', provider: 'EPOINT' }], page: 0, hasMore: false });
    show();

    expect(await screen.findByText('Rəşad Məmmədov')).toBeInTheDocument();
    expect(screen.getByText('Bakı velosiped emalatxanası')).toBeInTheDocument();
    expect(screen.getByText(/Epoint/)).toBeInTheDocument();
    expect(screen.queryByText(/EPOINT/)).not.toBeInTheDocument();
    expect(screen.getByText('visa_13.1')).toHaveClass('font-mono');
  });

  it('says the count is a page when there are more', async () => {
    queueMock.mockResolvedValue({ disputes: [CASE], page: 0, hasMore: true });
    show();

    expect(await screen.findByText(fillPlaceholders(COPY.count.partial, { count: '1' }))).toBeInTheDocument();
  });

  it('names the outcomes in the outcome note as the buttons do', () => {
    expect(COPY.outcomeNote).toContain(COPY.state.LOST);
    expect(COPY.outcomeNote).toContain(COPY.state.WON);
    expect(COPY.outcomeNote).not.toMatch(/\bLOST\b|\bCONCEDED\b|\bWON\b/);
  });
});

describe('closed cases', () => {
  it('reads them by outcome, with the chosen chip pressed', async () => {
    const user = userEvent.setup();
    closedMock.mockImplementation(async (state) => ({
      disputes: state === 'WON' ? [{ ...CASE, id: 'won-1', state: 'WON', resolvedAt: '2026-10-12T10:00:00Z' }] : [],
      page: 0,
      hasMore: false,
    }));
    show();

    const section = await screen.findByRole('region', { name: new RegExp(`^${COPY.resolvedHeading}`) });
    expect(closedMock).toHaveBeenCalledWith('LOST', 0, expect.anything());
    expect(within(section).getByRole('button', { name: COPY.state.LOST })).toHaveAttribute('aria-pressed', 'true');
    expect(
      await within(section).findByText(fillPlaceholders(COPY.resolvedEmpty, { state: COPY.state.LOST })),
    ).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: COPY.state.WON }));

    expect(closedMock).toHaveBeenLastCalledWith('WON', 0, expect.anything());
    expect(within(section).getByRole('button', { name: COPY.state.WON })).toHaveAttribute('aria-pressed', 'true');
    expect(await within(section).findByText(/150/)).toBeInTheDocument();
  });
});
