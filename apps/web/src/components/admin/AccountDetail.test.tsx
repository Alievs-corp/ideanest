import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  readAccountLegalSubject,
  readAccountPayoutDestination,
  readAccountSubscriptions,
  readUser,
  readUserPledges,
  type AdminAccountSubscriptions,
  type AdminPayoutDestination,
  type AdminUser,
  type AdminUserPledge,
} from '../../lib/admin/api';
import {
  rejectPayoutDestination,
  revealPayoutBankAccount,
  verifyPayoutDestination,
} from '../../lib/admin/payout-destinations';
import { ROLE_CAPABILITIES, type StaffMembership } from '../../lib/admin/staff';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { listCampaigns, type DirectoryCampaign } from '../../lib/admin/campaigns';
import { AccountDetail } from './AccountDetail';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { accountDetailCopyFrom } from '../../lib/i18n/admin/people-copy';

/*
 * Copy built from `messages/en.json` through the same builder the route calls, for the
 * reason `src/test-copy.ts` gives: a suite that retyped the sentences would stay green with
 * the catalogue empty.
 */
const COPY = accountDetailCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/api')>();
  return {
    ...actual,
    readUser: vi.fn(),
    readUserPledges: vi.fn(),
    readAccountSubscriptions: vi.fn(),
    readAccountLegalSubject: vi.fn(),
    readAccountPayoutDestination: vi.fn(),
  };
});

vi.mock('../../lib/admin/payout-destinations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/payout-destinations')>()),
  verifyPayoutDestination: vi.fn(),
  rejectPayoutDestination: vi.fn(),
  revealPayoutBankAccount: vi.fn(),
}));

vi.mock('../../lib/admin/campaigns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/campaigns')>();
  return { ...actual, listCampaigns: vi.fn() };
});

const readUserMock = vi.mocked(readUser);
const readUserPledgesMock = vi.mocked(readUserPledges);
const readAccountSubscriptionsMock = vi.mocked(readAccountSubscriptions);
const readAccountLegalSubjectMock = vi.mocked(readAccountLegalSubject);
const readAccountPayoutDestinationMock = vi.mocked(readAccountPayoutDestination);
const verifyPayoutDestinationMock = vi.mocked(verifyPayoutDestination);
const rejectPayoutDestinationMock = vi.mocked(rejectPayoutDestination);
const revealPayoutBankAccountMock = vi.mocked(revealPayoutBankAccount);
const listCampaignsMock = vi.mocked(listCampaigns);

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const ACCOUNT: AdminUser = {
  id: USER_ID,
  email: 'ayan@example.com',
  name: 'Ayan Məmmədova',
  slug: 'ayan-m',
  emailVerified: true,
  emailVerifiedAt: '2026-01-04T09:00:00.000Z',
  suspended: false,
  suspendedAt: null,
  suspendedBy: null,
  suspensionReason: null,
  deletionScheduledAt: null,
  createdAt: '2026-01-03T09:00:00.000Z',
};

const CAMPAIGN: DirectoryCampaign = {
  projectId: 'bbbbbbbb-0000-4000-8000-000000000001',
  title: 'Xari Bulbul Ceramics',
  slug: 'xari-bulbul-ceramics',
  state: 'DRAFT',
  createdAt: '2026-08-24T09:00:00.000Z',
  launchedAt: null,
  deadline: null,
  goal: { amount: '5000.00', currency: 'AZN' },
  pledged: { amount: '250.00', currency: 'AZN' },
  backersCount: 4,
  creatorId: USER_ID,
  creatorName: 'Ayan Məmmədova',
  creatorSlug: 'ayan-m',
};

const PLEDGE: AdminUserPledge = {
  pledgeId: 'cccccccc-0000-4000-8000-000000000001',
  state: 'COLLECTED',
  amounts: { total: { amount: '45.00', currency: 'AZN' } },
  confirmedAt: '2026-08-25T09:00:00.000Z',
  canceledAt: null,
  project: {
    id: 'dddddddd-0000-4000-8000-000000000001',
    title: 'Tumar Notebooks',
    slug: 'tumar-notebooks',
    creatorSlug: 'tumar',
    state: 'LIVE',
  },
};

beforeEach(() => {
  /*
   * `reset` and not `clear`: `clearAllMocks` leaves a queued `mockResolvedValueOnce`
   * behind, so a test that queues two pages and reads one hands the leftover to whichever
   * test runs next — which fails somewhere with no relation to the mock that caused it.
   */
  vi.resetAllMocks();
  readUserMock.mockResolvedValue(ACCOUNT);
  listCampaignsMock.mockResolvedValue({ campaigns: [CAMPAIGN], nextCursor: null });
  readUserPledgesMock.mockResolvedValue({ pledges: [PLEDGE], nextCursor: null });
  readAccountSubscriptionsMock.mockResolvedValue({ subscriptions: [], payments: [] });
  readAccountLegalSubjectMock.mockResolvedValue({ accountId: USER_ID, recorded: { recorded: false, complete: false } });
  readAccountPayoutDestinationMock.mockResolvedValue({ creatorId: USER_ID, recorded: false, standing: 'NONE' });
});

describe('the account detail screen — issue #404', () => {
  it('answers the three questions a suspension turns on', async () => {
    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    /*
     * The whole of #404's last acceptance line. `/admin/users` offered one control per row —
     * suspend — and its own copy said that suspending changes nothing about the campaigns
     * somebody created or the pledges they made, none of which was reachable from anywhere
     * in the console.
     */
    expect(await screen.findByText('Ayan Məmmədova')).toBeInTheDocument();
    expect(screen.getByText('ayan@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Xari Bulbul Ceramics')).toBeInTheDocument();
    expect(await screen.findByText('Tumar Notebooks')).toBeInTheDocument();
  });

  it('asks for this person’s campaigns and nobody else’s', async () => {
    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    await screen.findByText('Ayan Məmmədova');

    await waitFor(() =>
      expect(listCampaignsMock).toHaveBeenCalledWith(
        expect.objectContaining({ creatorId: USER_ID }),
      ),
    );
    expect(readUserPledgesMock).toHaveBeenCalledWith(USER_ID, null, expect.anything());
  });

  it('shows the suspension and the reason it was given, not only that there is one', async () => {
    readUserMock.mockResolvedValue({
      ...ACCOUNT,
      suspended: true,
      suspendedAt: '2026-08-30T09:00:00.000Z',
      suspensionReason: 'Repeated abuse of the report form.',
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    // What the person was told and what an appeal is answered from. A tag saying only
    // "Suspended" would be the fact without the thing anybody has to act on.
    expect(await screen.findByText(COPY.suspendedTag)).toBeInTheDocument();
    expect(
      screen.getByText(/Repeated abuse of the report form\./),
    ).toBeInTheDocument();
  });

  it('renders a pledge whose campaign is gone rather than dropping the row', async () => {
    readUserPledgesMock.mockResolvedValue({
      pledges: [{ ...PLEDGE, project: null }],
      nextCursor: null,
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    // It is still the person's money. Blanking it would leave an amount attached to nothing.
    expect(await screen.findByText(COPY.campaignGone)).toBeInTheDocument();
    expect(screen.getByText('45.00 AZN')).toBeInTheDocument();
  });

  it('says a pledge was never confirmed instead of drawing a blank date', async () => {
    readUserPledgesMock.mockResolvedValue({
      pledges: [{ ...PLEDGE, state: 'CANCELED_BY_BACKER', confirmedAt: null, canceledAt: '2026-08-25T09:05:00.000Z' }],
      nextCursor: null,
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    expect(await screen.findByText(COPY.neverConfirmed)).toBeInTheDocument();

    /*
     * Worded for a moderator rather than for the backer — `lib/pledges/backer.ts` says
     * "Cancelled by you" to the person who did it.
     *
     * Read through a local rather than inline, because `pledgeState` is an open record and
     * `noUncheckedIndexedAccess` types the lookup as possibly absent. The throw is the
     * assertion that the catalogue carries a word for this state at all.
     */
    const cancelled = COPY.pledgeState['CANCELED_BY_BACKER'];
    if (cancelled === undefined) throw new Error('the catalogue has no word for CANCELED_BY_BACKER');
    expect(screen.getByText(cancelled)).toBeInTheDocument();
  });

  it('keeps the page when one panel fails, because they are three reads and not one', async () => {
    readUserPledgesMock.mockRejectedValue(new Error('network'));

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    // A moderator whose pledge read timed out should still see what this person created.
    expect(await screen.findByText(COPY.pledgesFailed)).toBeInTheDocument();
    expect(screen.getByText('Ayan Məmmədova')).toBeInTheDocument();
    expect(await screen.findByText('Xari Bulbul Ceramics')).toBeInTheDocument();
  });

  it('renders the console refusal when the reader is not staff', async () => {
    readUserMock.mockRejectedValue(
      new ApiError(403, { code: 'NOT_A_MODERATOR', title: 'Not a moderator' }),
    );

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    // The account is the page: there is nothing to draw the two panels beside.
    await waitFor(() => expect(listCampaignsMock).not.toHaveBeenCalled());
    expect(screen.queryByText(COPY.campaignsHeading)).not.toBeInTheDocument();
  });

  it('pages the campaigns, so a prolific creator is not silently cut at one read', async () => {
    listCampaignsMock.mockResolvedValueOnce({ campaigns: [CAMPAIGN], nextCursor: 'cursor-1' });
    listCampaignsMock.mockResolvedValueOnce({
      campaigns: [{ ...CAMPAIGN, projectId: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'A second one' }],
      nextCursor: null,
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const campaigns = await screen.findByRole('region', { name: COPY.campaignsHeading });

    // `find` and not `get`: the section exists the moment the panel mounts, and its
    // `Load more` appears only once the first read has answered.
    await userEvent.click(await within(campaigns).findByRole('button', { name: COPY.loadMore }));

    expect(await screen.findByText('A second one')).toBeInTheDocument();
    expect(listCampaignsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ creatorId: USER_ID, after: 'cursor-1' }),
    );
  });

  it('says an account has created nothing rather than leaving the panel blank', async () => {
    listCampaignsMock.mockResolvedValue({ campaigns: [], nextCursor: null });
    readUserPledgesMock.mockResolvedValue({ pledges: [], nextCursor: null });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    expect(await screen.findByText(COPY.noCampaignsTitle)).toBeInTheDocument();
    expect(await screen.findByText(COPY.noPledgesTitle)).toBeInTheDocument();
  });

  it('offers no way to suspend from here, because the dialog and the reason live on the directory', async () => {
    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    await screen.findByText('Ayan Məmmədova');

    /*
     * A second ban control would be a second path into an audited, session-revoking write,
     * and it would be the one without the confirmation. The link back is the affordance.
     */
    expect(screen.getByRole('link', { name: COPY.backToDirectory })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });
});

describe('what the account held and paid — #23', () => {
  const HELD: AdminAccountSubscriptions = {
    subscriptions: [
      {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        accountId: USER_ID,
        state: 'ACTIVE',
        entitled: true,
        planCode: 'GROWTH',
        planName: 'Growth',
        price: '49.00',
        currency: 'AZN',
        billingPeriod: 'MONTHLY',
        startedAt: '2026-09-01T09:00:00.000Z',
        currentPeriodEnd: '2026-10-01T09:00:00.000Z',
        cancelAtPeriodEnd: false,
        activatedBy: null,
        note: null,
        createdAt: '2026-08-30T09:00:00.000Z',
      },
    ],
    payments: [
      {
        id: 'ffffffff-0000-4000-8000-000000000001',
        subscriptionId: 'eeeeeeee-0000-4000-8000-000000000001',
        accountId: USER_ID,
        accountEmail: null,
        accountName: null,
        planId: 'ffffffff-0000-4000-8000-0000000000aa',
        planCode: 'GROWTH',
        planName: 'Growth',
        billingPeriod: 'MONTHLY',
        amount: '49.00',
        currency: 'AZN',
        method: 'CASH',
        reference: 'receipt 12',
        note: null,
        receivedAt: '2026-09-01T09:00:00.000Z',
        recordedAt: '2026-09-01T09:00:00.000Z',
        recordedBy: null,
        reverses: null,
        reversal: false,
      },
    ],
  };

  it('shows the plan, its state, its price and the payment behind it', async () => {
    readAccountSubscriptionsMock.mockResolvedValue(HELD);

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await screen.findByRole('region', { name: COPY.subscriptionsHeading });

    await waitFor(() => expect(within(section).getByText(COPY.subscriptionState.ACTIVE as string)).toBeInTheDocument());
    expect(within(section).getAllByText('49.00 AZN')).toHaveLength(2);
    expect(within(section).getByText(COPY.paymentsHeading)).toBeInTheDocument();
    expect(within(section).getByText(new RegExp(COPY.paymentMethod.CASH as string))).toBeInTheDocument();
    expect(readAccountSubscriptionsMock).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it('reads an active subscription whose period has run out as expired', async () => {
    const lapsed = HELD.subscriptions[0]!;
    readAccountSubscriptionsMock.mockResolvedValue({
      subscriptions: [{ ...lapsed, entitled: false }],
      payments: [],
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await screen.findByRole('region', { name: COPY.subscriptionsHeading });

    // `state` alone would say this person can publish. They cannot.
    expect(await within(section).findByText(COPY.subscriptionState.EXPIRED as string)).toBeInTheDocument();
    expect(within(section).queryByText(COPY.subscriptionState.ACTIVE as string)).toBeNull();
  });

  it('says it could not be read, and leaves the rest of the page alone', async () => {
    readAccountSubscriptionsMock.mockRejectedValue(new Error('the subscription service is down'));

    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    expect(await screen.findByText(COPY.subscriptionsFailed)).toBeInTheDocument();
    expect(screen.getByText('Ayan Məmmədova')).toBeInTheDocument();
    expect(await screen.findByText('Tumar Notebooks')).toBeInTheDocument();
  });

  it('says in words that the account never chose a plan', async () => {
    render(<AccountDetail userId={USER_ID} copy={COPY} />);

    expect(await screen.findByText(COPY.noSubscriptionsTitle)).toBeInTheDocument();
  });
});

describe('the VÖEN and business card a creator attached', () => {
  /** The panel, so a "Not provided" elsewhere on the page cannot satisfy an assertion. */
  async function panel(): Promise<HTMLElement> {
    const heading = await screen.findByRole('heading', { name: COPY.payoutHeading });
    const section = heading.closest('section');
    if (section === null) throw new Error('the payout heading is not inside its section');
    await waitFor(() => expect(within(section).queryByText(COPY.loadingPayout)).not.toBeInTheDocument());
    return section;
  }

  function word(table: Readonly<Record<string, string>>, key: string): string {
    const found = table[key];
    if (found === undefined) throw new Error(`the catalogue has no word for ${key}`);
    return found;
  }

  it('shows the VÖEN and the card when both are on file', async () => {
    readAccountLegalSubjectMock.mockResolvedValue({
      accountId: USER_ID,
      recorded: {
        recorded: true,
        subjectKind: 'LEGAL_ENTITY',
        legalName: 'Xari Bulbul MMC',
        taxId: '1234567890',
        complete: true,
      },
    });
    readAccountPayoutDestinationMock.mockResolvedValue({
      creatorId: USER_ID,
      recorded: true,
      standing: 'VERIFIED',
      holderName: 'XARI BULBUL MMC',
      displayHint: '•••• 4242',
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await panel();

    expect(within(section).getByText('1234567890')).toBeInTheDocument();
    expect(within(section).getByText(/Xari Bulbul MMC/)).toBeInTheDocument();
    expect(within(section).getByText('•••• 4242')).toBeInTheDocument();
    expect(within(section).getByText(word(COPY.cardStanding, 'VERIFIED'))).toBeInTheDocument();
    expect(readAccountLegalSubjectMock).toHaveBeenCalledWith(USER_ID, expect.anything());
    expect(readAccountPayoutDestinationMock).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it('says in words that neither was given, rather than leaving the cells blank', async () => {
    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await panel();

    expect(within(section).getByText(COPY.taxIdMissing)).toBeInTheDocument();
    expect(within(section).getByText(word(COPY.cardStanding, 'NONE'))).toBeInTheDocument();
  });

  it('marks a company that has not finished its details as incomplete', async () => {
    readAccountLegalSubjectMock.mockResolvedValue({
      accountId: USER_ID,
      recorded: { recorded: true, subjectKind: 'LEGAL_ENTITY', legalName: 'Half Done MMC', complete: false },
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await panel();

    expect(within(section).getByText(COPY.subjectIncomplete)).toBeInTheDocument();
    expect(within(section).getByText(COPY.taxIdMissing)).toBeInTheDocument();
  });

  it('keeps the card when the VÖEN is refused, because they are two capabilities', async () => {
    readAccountLegalSubjectMock.mockRejectedValue(
      new ApiError(403, { code: 'MISSING_CAPABILITY', title: 'Missing capability' }),
    );
    readAccountPayoutDestinationMock.mockResolvedValue({
      creatorId: USER_ID,
      recorded: true,
      standing: 'AWAITING_VERIFICATION',
      displayHint: '•••• 1111',
    });

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await panel();

    expect(within(section).getByText(COPY.legalSubjectForbidden)).toBeInTheDocument();
    expect(within(section).getByText('•••• 1111')).toBeInTheDocument();
    expect(screen.getByText('Ayan Məmmədova')).toBeInTheDocument();
  });

  it('says the card could not be read when the service failed', async () => {
    readAccountPayoutDestinationMock.mockRejectedValue(new Error('network'));

    render(<AccountDetail userId={USER_ID} copy={COPY} />);
    const section = await panel();

    expect(within(section).getByText(COPY.cardFailed)).toBeInTheDocument();
    expect(within(section).getByText(COPY.taxIdMissing)).toBeInTheDocument();
  });
});

describe('the payout destination on the account — issue #396', () => {
  const WORDS = COPY.destination;

  const BANK_ACCOUNT: AdminPayoutDestination = {
    creatorId: USER_ID,
    recorded: true,
    standing: 'AWAITING_VERIFICATION',
    kind: 'BANK_TRANSFER',
    provider: 'BANK_TRANSFER',
    holderName: 'AYAN MAMMADOVA',
    displayHint: 'AZ21…1944',
  };

  const IBAN = 'AZ21NABZ00000000137010001944';

  /** COMPLIANCE's capabilities, and the account read that lets this screen open at all. */
  const REVIEWER: StaffMembership = {
    accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    staff: true,
    bootstrapped: false,
    roles: ['COMPLIANCE', 'MODERATOR'],
    capabilities: [...ROLE_CAPABILITIES.COMPLIANCE, ...ROLE_CAPABILITIES.MODERATOR],
  };

  function renderAs(membership: StaffMembership | null) {
    return render(
      <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
        <AccountDetail userId={USER_ID} copy={COPY} />
      </ConsoleMembershipProvider>,
    );
  }

  async function panel(): Promise<HTMLElement> {
    const heading = await screen.findByRole('heading', { name: COPY.payoutHeading });
    const section = heading.closest('section');
    if (section === null) throw new Error('the payout heading is not inside its section');
    await waitFor(() => expect(within(section).queryByText(COPY.loadingPayout)).not.toBeInTheDocument());
    return section;
  }

  function word(table: Readonly<Record<string, string>>, key: string): string {
    const found = table[key];
    if (found === undefined) throw new Error(`the catalogue has no word for ${key}`);
    return found;
  }

  beforeEach(() => {
    readAccountPayoutDestinationMock.mockResolvedValue(BANK_ACCOUNT);
    revealPayoutBankAccountMock.mockResolvedValue({
      creatorId: USER_ID,
      iban: IBAN,
      holderName: 'AYAN MAMMADOVA',
      displayHint: 'AZ21…1944',
    });
  });

  it('says it is a bank account and shows only the masked hint', async () => {
    renderAs(REVIEWER);
    const section = await panel();

    expect(within(section).getByText(word(WORDS.kind, 'BANK_TRANSFER'))).toBeInTheDocument();
    expect(within(section).getByText('AZ21…1944')).toBeInTheDocument();
    expect(within(section).queryByText(/NABZ/)).not.toBeInTheDocument();
  });

  it('reads the IBAN on the press and not before, and says first that it is audited', async () => {
    const user = userEvent.setup();
    renderAs(REVIEWER);
    const section = await panel();

    const reveal = within(section).getByRole('button', { name: WORDS.reveal.action });
    expect(within(section).getByText(WORDS.reveal.audited)).toBeInTheDocument();
    expect(reveal).toHaveAccessibleDescription(WORDS.reveal.audited);
    expect(revealPayoutBankAccountMock).not.toHaveBeenCalled();

    await user.click(reveal);

    expect(await within(section).findByText('AZ21 NABZ 0000 0000 1370 1000 1944')).toBeInTheDocument();
    expect(within(section).getByText(WORDS.reveal.holderLabel)).toBeInTheDocument();
    expect(revealPayoutBankAccountMock).toHaveBeenCalledTimes(1);
    expect(revealPayoutBankAccountMock).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it('keeps nothing once hidden: seeing it again is another audited read', async () => {
    const user = userEvent.setup();
    renderAs(REVIEWER);
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: WORDS.reveal.action }));
    await within(section).findByText('AZ21 NABZ 0000 0000 1370 1000 1944');

    await user.click(within(section).getByRole('button', { name: WORDS.reveal.hide }));
    expect(within(section).queryByText('AZ21 NABZ 0000 0000 1370 1000 1944')).not.toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: WORDS.reveal.action }));
    await within(section).findByText('AZ21 NABZ 0000 0000 1370 1000 1944');
    expect(revealPayoutBankAccountMock).toHaveBeenCalledTimes(2);
  });

  it('does not offer the reveal without READ_BANK_DETAILS', async () => {
    renderAs({ ...REVIEWER, capabilities: REVIEWER.capabilities.filter((c) => c !== 'READ_BANK_DETAILS') });
    const section = await panel();

    expect(within(section).queryByRole('button', { name: WORDS.reveal.action })).not.toBeInTheDocument();
    // The decision is still offered: verifying is a different capability from reading the number.
    expect(within(section).getByRole('button', { name: WORDS.decision.verify })).toBeInTheDocument();
  });

  it('does not offer the reveal for a provider card, whose number was never here', async () => {
    readAccountPayoutDestinationMock.mockResolvedValue({
      ...BANK_ACCOUNT,
      kind: 'PROVIDER_TOKEN',
      provider: 'PAYRIFF',
      displayHint: '•••• 4242',
    });
    renderAs(REVIEWER);
    const section = await panel();

    expect(within(section).getByText(word(WORDS.kind, 'PROVIDER_TOKEN'))).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: WORDS.reveal.action })).not.toBeInTheDocument();
  });

  it('says there is no bank account when the service finds none', async () => {
    const user = userEvent.setup();
    revealPayoutBankAccountMock.mockRejectedValue(
      new ApiError(404, { status: 404, code: 'PAYOUT_BANK_ACCOUNT_NOT_FOUND', title: 'No bank account' }),
    );
    renderAs(REVIEWER);
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: WORDS.reveal.action }));

    expect(await within(section).findByText(WORDS.reveal.notFound)).toBeInTheDocument();
  });

  it('verifies on the second press and redraws from the answer', async () => {
    const user = userEvent.setup();
    verifyPayoutDestinationMock.mockResolvedValue({ ...BANK_ACCOUNT, standing: 'VERIFIED' });
    renderAs(REVIEWER);
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: WORDS.decision.verify }));
    expect(verifyPayoutDestinationMock).not.toHaveBeenCalled();
    await user.click(within(section).getByRole('button', { name: WORDS.decision.confirmVerifyAction }));

    await waitFor(() => expect(verifyPayoutDestinationMock).toHaveBeenCalledWith(USER_ID));
    expect(await within(section).findByText(word(COPY.cardStanding, 'VERIFIED'))).toBeInTheDocument();
  });

  it('rejects with the reason the creator will be shown', async () => {
    const user = userEvent.setup();
    rejectPayoutDestinationMock.mockResolvedValue({
      ...BANK_ACCOUNT,
      standing: 'REJECTED',
      rejectionReason: 'SUSPECTED_FORGERY',
    });
    renderAs(REVIEWER);
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: WORDS.decision.reject }));
    await user.selectOptions(
      within(section).getByLabelText(new RegExp(WORDS.decision.reasonLabel)),
      'SUSPECTED_FORGERY',
    );
    await user.click(within(section).getByRole('button', { name: WORDS.decision.confirmReject }));

    await waitFor(() => expect(rejectPayoutDestinationMock).toHaveBeenCalledWith(USER_ID, 'SUSPECTED_FORGERY'));
    expect(await within(section).findByText(word(COPY.cardStanding, 'REJECTED'))).toBeInTheDocument();
    expect(
      within(section).getByText(new RegExp(word(WORDS.rejectionReason, 'SUSPECTED_FORGERY'))),
    ).toBeInTheDocument();
  });

  it('says why a name mismatch cannot be verified when the service refuses it', async () => {
    const user = userEvent.setup();
    verifyPayoutDestinationMock.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'DESTINATION_NAME_MISMATCH', title: 'Name mismatch' }),
    );
    renderAs(REVIEWER);
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: WORDS.decision.verify }));
    await user.click(within(section).getByRole('button', { name: WORDS.decision.confirmVerifyAction }));

    expect(await within(section).findByText(WORDS.decision.nameMismatch)).toBeInTheDocument();
    expect(within(section).getByText(word(COPY.cardStanding, 'AWAITING_VERIFICATION'))).toBeInTheDocument();
  });

  it('offers no decision when nothing is on file', async () => {
    readAccountPayoutDestinationMock.mockResolvedValue({ creatorId: USER_ID, recorded: false, standing: 'NONE' });
    renderAs(REVIEWER);
    const section = await panel();

    expect(within(section).queryByRole('button', { name: WORDS.decision.verify })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: WORDS.reveal.action })).not.toBeInTheDocument();
  });
});
