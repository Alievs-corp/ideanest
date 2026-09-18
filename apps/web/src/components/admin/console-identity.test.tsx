import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listUsers } from '../../lib/admin/api';
import { lookUpNames } from '../../lib/admin/directory';
import { readHealth } from '../../lib/admin/health';
import { readPayout, readPayoutQueue } from '../../lib/admin/payouts';
import {
  grantRole,
  readMembership,
  readRoster,
  ROLE_CAPABILITIES,
  STAFF_CAPABILITIES,
} from '../../lib/admin/staff';
import type { PlatformHealth } from '../../lib/admin/health';
import type { PayoutFile, PayoutPage } from '../../lib/admin/payouts';
import { HealthDashboard } from './HealthDashboard';
import { PayoutQueue } from './PayoutQueue';
import { StaffRoles } from './StaffRoles';
import { ConsoleIndex } from './ConsoleIndex';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { CONSOLE_MODULES, visibleConsoleModules } from '../../lib/admin/navigation';
import type { StaffCapability } from '../../lib/admin/staff';
import { EntityName } from './ConsoleIdentity';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { consoleIndexCopyFrom } from '../../lib/i18n/admin-copy';
import { healthDashboardCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { payoutQueueCopyFrom } from '../../lib/i18n/admin/money-copy';
import { staffRolesCopyFrom } from '../../lib/i18n/admin/people-copy';

/*
 * The copy comes from `messages/en.json` through the same builders the routes call. A suite
 * that retyped the sentences would still be green with the catalogue empty, which is the
 * defect `catalogue.test.ts` exists to catch — `src/test-copy.ts` has the argument.
 */
const ADMIN = translatorFor('admin');
const CHROME = consoleChromeCopyFrom(ADMIN, translatorFor('common'));
const HEALTH = healthDashboardCopyFrom(ADMIN, CHROME);
const PAYOUTS = payoutQueueCopyFrom(ADMIN, CHROME);
const STAFF = staffRolesCopyFrom(ADMIN, CHROME);
const INDEX = consoleIndexCopyFrom(ADMIN);

/*
 * `lookUpNames` and not `readDirectory`: the batching function calls the reader through the
 * module's own binding, which a spread of the real module does not redirect. Mocking the
 * inner one would leave every screen here talking to a real fetch.
 */
vi.mock('../../lib/admin/directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/directory')>();
  return { ...actual, lookUpNames: vi.fn() };
});
vi.mock('../../lib/admin/staff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/staff')>();
  return { ...actual, readMembership: vi.fn(), readRoster: vi.fn(), grantRole: vi.fn() };
});
vi.mock('../../lib/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/api')>();
  return { ...actual, listUsers: vi.fn() };
});
vi.mock('../../lib/admin/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/payouts')>();
  return { ...actual, readPayoutQueue: vi.fn(), readPayout: vi.fn() };
});
vi.mock('../../lib/admin/health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/health')>();
  return { ...actual, readHealth: vi.fn() };
});

const lookUpNamesMock = vi.mocked(lookUpNames);
const readMembershipMock = vi.mocked(readMembership);
const readRosterMock = vi.mocked(readRoster);
const grantRoleMock = vi.mocked(grantRole);
const listUsersMock = vi.mocked(listUsers);
const readPayoutQueueMock = vi.mocked(readPayoutQueue);
const readPayoutMock = vi.mocked(readPayout);
const readHealthMock = vi.mocked(readHealth);

const ME = '0191f2ab-1234-7000-8000-0000000000aa';
const COLLEAGUE = '0191f2ab-1234-7000-8000-0000000000bb';
const CREATOR = '0191f2ab-1234-7000-8000-0000000000cc';
const PROJECT = '0191f2ab-1234-7000-8000-0000000000dd';
const PAYOUT = '0191f2ab-1234-7000-8000-0000000000ee';

const MONEY = { amount: '0.00', currency: 'AZN' } as const;

function payoutQueue(): PayoutPage {
  return {
    payouts: [
      {
        id: PAYOUT,
        projectId: PROJECT,
        creatorId: CREATOR,
        gross: { amount: '100.00', currency: 'AZN' },
        platformFee: MONEY,
        processingFee: MONEY,
        taxWithheld: MONEY,
        refunded: MONEY,
        net: { amount: '100.00', currency: 'AZN' },
        state: 'PENDING_APPROVAL',
        payableAt: '2026-08-01',
        payableNow: true,
        approvalsRequired: 2,
        // #431. Verified, because this suite is about how the console names accounts and a
        // payout held on identity would draw an alert it is not asserting on.
        creatorStanding: 'VERIFIED',
        heldForVerification: false,
        // #432, and verified for #431's reason: this suite is about how the console names
        // accounts, and a payout held on its destination would draw an alert it is not
        // asserting on. `heldDestinationFile` is where that case is exercised.
        destinationStanding: 'VERIFIED',
        heldForDestination: false,
        calculatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    page: 0,
    hasMore: false,
  };
}

function payoutFile(approvers: readonly string[]): PayoutFile {
  return {
    payout: payoutQueue().payouts[0]!,
    approvals: approvers.map((approverId) => ({
      approverId,
      approvedAt: '2026-08-02T00:00:00.000Z',
      note: null,
    })),
    stillNeeded: Math.max(0, 2 - approvers.length),
  };
}

/** Fully signed, and waiting on a destination nobody has confirmed — #432. */
function heldDestinationFile(): PayoutFile {
  const file = payoutFile([ME, COLLEAGUE]);
  return {
    ...file,
    payout: {
      ...file.payout,
      destinationStanding: 'AWAITING_VERIFICATION',
      heldForDestination: true,
    },
  };
}

function health(overdueBySeconds: number): PlatformHealth {
  return {
    at: new Date().toISOString(),
    status: 'HEALTHY',
    monitored: false,
    queues: [{ name: 'scheduled-jobs', waiting: 0, dead: 0, status: 'HEALTHY' }],
    jobs: [
      {
        name: 'outbox-relay',
        state: 'READY',
        overdueBySeconds,
        attempts: 0,
        status: overdueBySeconds >= 60 ? 'DEGRADED' : 'HEALTHY',
      },
    ],
    providers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lookUpNamesMock.mockResolvedValue({ accounts: [], projects: [] });
  readMembershipMock.mockResolvedValue({
    accountId: ME,
    staff: true,
    bootstrapped: false,
    roles: ['FINANCE'],
    capabilities: ['APPROVE_PAYOUT'],
  });
  readRosterMock.mockResolvedValue({ grants: [] });
  readPayoutQueueMock.mockResolvedValue(payoutQueue());
  readPayoutMock.mockResolvedValue(payoutFile([]));
  readHealthMock.mockResolvedValue(health(0));
});

/**
 * The console can say who and what it is showing — issue #402.
 *
 * <p>Appearance is reviewed in Storybook. What these cover is the wiring that fails
 * silently: a name that never arrives leaves a screen that still works and says nothing
 * about it, and a control offered to somebody who cannot use it looks exactly like one that
 * is broken.
 */
describe('names on a console screen', () => {
  it('renders the name the directory resolved, with the identifier still beside it', async () => {
    lookUpNamesMock.mockResolvedValue({
      accounts: [{ id: CREATOR, name: 'Günel Rzayeva', slug: 'gunel-rzayeva' }],
      projects: [],
    });

    render(<PayoutQueue copy={PAYOUTS} />);

    expect(await screen.findByText('Günel Rzayeva')).toBeInTheDocument();
    /*
     * Both, and not one. The name is what a human recognises; the fragment is what gets
     * quoted to an engineer and what the service names back in a refusal, so a row that
     * dropped it would have traded one missing fact for another.
     */
    expect(screen.getAllByText(CREATOR.slice(0, 8)).length).toBeGreaterThan(0);
  });

  it('links a campaign to the staff preview, which renders it in any state', () => {
    render(
      <EntityName
        id="a1b2c3d4-0000-4000-8000-000000000001"
        names={{
          accounts: new Map(),
          projects: new Map([
            [
              'a1b2c3d4-0000-4000-8000-000000000001',
              {
                id: 'a1b2c3d4-0000-4000-8000-000000000001',
                title: 'Xari Bulbul Ceramics',
                slug: 'xari-bulbul-ceramics',
                creatorSlug: 'aysel-studio',
              },
            ],
          ]),
        }}
        kind="project"
        copy={CHROME.identity}
      />,
    );

    /*
     * #399. This used to build `/projects/{creatorSlug}/{slug}` whenever the directory had
     * both halves, and it has both halves for every campaign regardless of state — so a
     * report about a suspended campaign, or an audit row about a rejected one, offered a
     * link that answers 404 at exactly the moment somebody is trying to find out what was
     * stopped.
     */
    expect(screen.getByRole('link', { name: 'Xari Bulbul Ceramics' })).toHaveAttribute(
      'href',
      '/en/admin/campaigns/a1b2c3d4-0000-4000-8000-000000000001',
    );
  });

  it('leaves the screen working when the lookup fails', async () => {
    lookUpNamesMock.mockRejectedValue(new Error('the directory is unreachable'));

    render(<PayoutQueue copy={PAYOUTS} />);

    /*
     * The names are a second read over a screen that has already rendered every fact it was
     * asked to show. A failure here costs the names; putting an error over a payout queue
     * that loaded correctly would cost the screen.
     */
    expect(await screen.findByText(CREATOR.slice(0, 8))).toBeInTheDocument();
    expect(screen.queryByText(CHROME.errorTitle)).not.toBeInTheDocument();
  });

  it('puts the whole identifier on the clipboard, and says so', async () => {
    const user = userEvent.setup();
    readRosterMock.mockResolvedValue({
      grants: [
        {
          accountId: COLLEAGUE,
          role: 'MODERATOR',
          grantedAt: '2026-08-01T00:00:00.000Z',
          grantedBy: ME,
        },
      ],
    });

    render(<StaffRoles copy={STAFF} />);

    const copyControl = await screen.findByRole('button', {
      name: STAFF.identity.copyLabel.replace('{id}', COLLEAGUE.slice(0, 8)),
    });
    await user.click(copyControl);

    // The whole thing, not the eight characters on the row. This is the control that makes
    // the five hand-typed identifier fields reachable at all.
    await expect(navigator.clipboard.readText()).resolves.toBe(COLLEAGUE);
    expect(await screen.findByText(STAFF.identity.copied)).toBeInTheDocument();
  });
});

/**
 * Granting a role can be finished inside the console — issue #402's acceptance.
 */
describe('the staff grant form', () => {
  it('will not grant until an account is chosen, and says why', async () => {
    render(<StaffRoles copy={STAFF} />);

    const grant = await screen.findByRole('button', { name: STAFF.grant });

    // #405's rule, applied here: no disabled control without a stated reason.
    expect(grant).toBeDisabled();
    expect(screen.getByText(STAFF.chooseAccountFirst)).toBeInTheDocument();
  });

  it('finds an account by name and grants the role to the one that was picked', async () => {
    const user = userEvent.setup();
    listUsersMock.mockResolvedValue({
      users: [
        {
          id: COLLEAGUE,
          email: 'kamran@example.az',
          name: 'Kamran Əliyev',
          slug: 'kamran-aliyev',
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          suspended: false,
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
          deletionScheduledAt: null,
        },
      ],
      nextCursor: null,
    });
    grantRoleMock.mockResolvedValue({
      accountId: COLLEAGUE,
      staff: true,
      bootstrapped: false,
      roles: ['MODERATOR'],
      capabilities: [],
    });

    render(<StaffRoles copy={STAFF} />);

    await user.type(await screen.findByLabelText(STAFF.picker.label), 'Kamran');
    await user.click(screen.getByRole('button', { name: STAFF.picker.search }));
    await user.click(await screen.findByRole('button', { name: /Kamran Əliyev/ }));
    await user.click(screen.getByRole('button', { name: STAFF.grant }));

    /*
     * The whole of #402's first section. The form used to take a UUID typed by hand, with
     * help text naming an account directory that displayed no identifier anywhere — so this
     * request could not be made from inside the console at all.
     */
    await waitFor(() => {
      expect(grantRoleMock).toHaveBeenCalledWith(COLLEAGUE, 'MODERATOR', null);
    });
  });
});

/**
 * Controls that describe what they will actually do — issue #405.
 */
describe('the payout file', () => {
  it('stops offering to approve once you have signed, and says why', async () => {
    const user = userEvent.setup();
    readPayoutMock.mockResolvedValue(payoutFile([ME]));

    render(<PayoutQueue copy={PAYOUTS} />);
    await user.click(await screen.findByRole('button', { expanded: false }));

    /*
     * `approve()` is idempotent server-side, so a second signature never wrote anything.
     * What was wrong was the screen: a control offering an action the reader cannot take is
     * indistinguishable from one whose click did not register.
     */
    expect(await screen.findByRole('button', { name: PAYOUTS.approve })).toBeDisabled();
    expect(screen.getByText(PAYOUTS.youHaveSigned)).toBeInTheDocument();
  });

  it('offers to withdraw a signature only to somebody who gave one', async () => {
    const user = userEvent.setup();
    readPayoutMock.mockResolvedValue(payoutFile([COLLEAGUE]));

    render(<PayoutQueue copy={PAYOUTS} />);
    await user.click(await screen.findByRole('button', { expanded: false }));
    await screen.findByRole('button', { name: PAYOUTS.approve });

    // At one signature of two with only a colleague's name on the file, this used to offer
    // to take back a signature the reader had never given.
    expect(screen.queryByRole('button', { name: PAYOUTS.withdrawMine })).not.toBeInTheDocument();
  });

  it('offers the send at a full set of signatures once the destination is confirmed', async () => {
    const user = userEvent.setup();
    readPayoutMock.mockResolvedValue(payoutFile([ME, COLLEAGUE]));

    render(<PayoutQueue copy={PAYOUTS} />);
    await user.click(await screen.findByRole('button', { expanded: false }));

    /*
     * #405: the label changed from "one more signature needed" to "Send" and the control
     * then simply did nothing, because there was a destination field beside it that nobody
     * had filled in. #432 removed the field — the destination is the creator's to supply and
     * a reviewer's to confirm — so at two signatures of two the control now does what it says.
     */
    expect(await screen.findByRole('button', { name: PAYOUTS.send })).toBeEnabled();
  });

  it('says why sending is disabled when the destination is not confirmed', async () => {
    const user = userEvent.setup();
    readPayoutMock.mockResolvedValue(heldDestinationFile());

    render(<PayoutQueue copy={PAYOUTS} />);
    await user.click(await screen.findByRole('button', { expanded: false }));

    // #405's rule, kept: every disabled control says what would enable it. The standing is
    // named rather than reduced to "not confirmed", because a creator who has filed nothing
    // and one whose account is in a reviewer's queue are different things to do next.
    expect(await screen.findByRole('button', { name: PAYOUTS.send })).toBeDisabled();
    expect(screen.getByText(PAYOUTS.destinationHeldTitle)).toBeInTheDocument();
  });
});

/**
 * A dashboard that distinguishes late from due — issue #405.
 */
describe('the health dashboard', () => {
  it('calls a job that has just fallen due on time, not late by zero minutes', async () => {
    readHealthMock.mockResolvedValue(health(2));

    render(<HealthDashboard copy={HEALTH} />);

    // "READY · 0 minutes late" was on ten of nineteen rows, beside an amber tag, and it is
    // a sentence that contradicts itself.
    expect(await screen.findByText(new RegExp(HEALTH.onTime))).toBeInTheDocument();
  });

  it('names its queues in the language the reader chose', async () => {
    render(<HealthDashboard copy={HEALTH} />);

    /*
     * The service answers an identifier now. It used to answer "Scheduled jobs", which this
     * screen rendered verbatim under an Azerbaijani heading and above a section headed with
     * the Azerbaijani for the same three words.
     *
     * Found by the wire value on the row's `title` rather than by its text: the label is
     * deliberately the same words as the section heading below it, which is the point — one
     * concept, one language.
     */
    const row = await screen.findByTitle('scheduled-jobs');
    expect(row).toHaveTextContent(HEALTH.queue['scheduled-jobs']!);
    expect(row).not.toHaveTextContent('scheduled-jobs');
  });
});

/**
 * A console index that describes the console — issue #405, and the reader's half of it, #295.
 */
describe('the console index', () => {
  /** The index renders inside `ConsoleGate`, so a membership is always in hand by then. */
  function renderIndex(capabilities: readonly StaffCapability[]): void {
    render(
      <ConsoleMembershipProvider
        given={{
          status: 'ready',
          membership: {
            accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
            staff: true,
            bootstrapped: false,
            roles: [],
            capabilities: [...capabilities],
          },
        }}
      >
        <ConsoleIndex copy={INDEX} />
      </ConsoleMembershipProvider>,
    );
  }

  it('says how many modules are finished and how many are partly built', () => {
    renderIndex(STAFF_CAPABILITIES);

    /*
     * It used to say sixteen of sixteen have a screen and that "the rest say what they are
     * waiting for". There was no rest — every module has an href — while nine are partly
     * built and each does carry a waiting-on note, which is the fact it was reaching for.
     */
    const standfirst = screen.getByText(/16 modules/);
    expect(standfirst.textContent).not.toContain('16 of them have a screen');
    expect(standfirst.textContent).toMatch(/finished: 7, partly built: 9/);
  });

  it('counts what the reader is looking at, not what §4.11 has', () => {
    // A standfirst saying "sixteen modules" over four rows would be describing a different
    // page from the one under it.
    renderIndex(ROLE_CAPABILITIES.CURATOR);

    const modules = visibleConsoleModules(ROLE_CAPABILITIES.CURATOR);
    expect(modules.length).toBeLessThan(CONSOLE_MODULES.length);
    expect(screen.getByText(new RegExp(`The ${modules.length} modules`, 'u'))).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(modules.length);
  });

  it('lists a module the reader can open and leaves out one they cannot', () => {
    renderIndex(ROLE_CAPABILITIES.CURATOR);

    // AD-03 is curation; AD-05 is the ledger and the payout queue.
    expect(screen.getByText('AD-03')).toBeInTheDocument();
    expect(screen.queryByText('AD-05')).not.toBeInTheDocument();
  });

  it('says how many modules are not theirs, and where to read what a role holds', () => {
    renderIndex(ROLE_CAPABILITIES.CURATOR);

    const hidden = CONSOLE_MODULES.length - visibleConsoleModules(ROLE_CAPABILITIES.CURATOR).length;
    // The answer to the objection the old always-everything rail was built on: somebody who
    // cannot see a screen still has somewhere to learn that it exists.
    expect(screen.getByText(new RegExp(`: ${hidden}\\.`, 'u'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: INDEX.rolesLink })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/staff'),
    );
  });

  it('says nothing about hidden modules to somebody who can open all of them', () => {
    renderIndex(STAFF_CAPABILITIES);

    expect(screen.queryByRole('link', { name: INDEX.rolesLink })).not.toBeInTheDocument();
  });

  it('points a row at a screen of the module the reader can actually open', () => {
    /*
     * AD-04 is two capabilities under one module: `/admin/users` wants ADMINISTER_ACCOUNTS and
     * `/admin/staff` wants ADMINISTER_STAFF. Somebody holding only the second gets the row, and
     * a link they can follow rather than the module's own href.
     */
    renderIndex(['ADMINISTER_STAFF']);

    const row = screen.getByText('AD-04').closest('li');
    expect(row).not.toBeNull();
    // Two links in a part-built row: the module's, and the issue its waiting-on note cites.
    expect(within(row as HTMLElement).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/staff'),
    );
  });
});
