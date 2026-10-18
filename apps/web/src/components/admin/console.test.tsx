import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { readTrail } from '../../lib/admin/audit';
import { listCollections, replaceCollection } from '../../lib/admin/curation';
import { readLedger } from '../../lib/admin/ledger';
import { readPaymentLog } from '../../lib/admin/payments';
import type { AdminCollection } from '../../lib/admin/curation';
import type { LedgerView } from '../../lib/admin/ledger';
import { AuditTrailView } from './AuditTrailView';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { BadgeManager } from './BadgeManager';
import { LedgerExplorer } from './LedgerExplorer';
import { PaymentLogView } from './PaymentLogView';
import { translatorFor } from '../../test-copy';
import {
  consoleChromeCopyFrom,
  noteDialogCopyFrom,
} from '../../lib/i18n/admin/common-copy';
import { curationChromeFrom } from '../../lib/i18n/admin/curation-copy';
import { badgeManagerCopyFrom } from '../../lib/i18n/admin/curation-copy';
import { auditTrailCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { ledgerExplorerCopyFrom, paymentLogCopyFrom } from '../../lib/i18n/admin/money-copy';

/*
 * The copy is built from `messages/en.json` with the same builders the routes call, rather
 * than typed out here. `src/test-copy.ts` explains why at length: a suite that retyped the
 * sentences would still be green with the catalogue empty, which is precisely the defect
 * `catalogue.test.ts` exists to catch.
 */
const ADMIN = translatorFor('admin');
const CHROME = consoleChromeCopyFrom(ADMIN, translatorFor('common'));
const AUDIT = auditTrailCopyFrom(ADMIN, CHROME);
const LEDGER = ledgerExplorerCopyFrom(ADMIN, CHROME);
const PAYMENTS = paymentLogCopyFrom(ADMIN, CHROME);
const BADGES = badgeManagerCopyFrom(ADMIN, curationChromeFrom(ADMIN, CHROME));
const NOTE = noteDialogCopyFrom(ADMIN, translatorFor('common'));

vi.mock('../../lib/admin/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/audit')>();
  return { ...actual, readTrail: vi.fn() };
});

vi.mock('../../lib/admin/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/ledger')>();
  return { ...actual, readLedger: vi.fn() };
});

vi.mock('../../lib/admin/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/payments')>();
  return { ...actual, readPaymentLog: vi.fn() };
});

vi.mock('../../lib/admin/curation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/curation')>();
  return { ...actual, listCollections: vi.fn(), replaceCollection: vi.fn() };
});

const readTrailMock = vi.mocked(readTrail);
const readLedgerMock = vi.mocked(readLedger);
const readPaymentLogMock = vi.mocked(readPaymentLog);
const listCollectionsMock = vi.mocked(listCollections);
const replaceCollectionMock = vi.mocked(replaceCollection);

const TRANSACTION_ID = '0191f2ab-1234-7000-8000-000000000001';
const PROJECT_ID = '0191f2ab-1234-7000-8000-000000000002';

function ledgerView(overrides: Partial<LedgerView> = {}): LedgerView {
  return {
    postings: [
      {
        transactionId: TRANSACTION_ID,
        projectId: PROJECT_ID,
        createdAt: '2026-08-24T10:00:00.000Z',
        lines: [
          { account: 'escrow', direction: 'DEBIT', amount: { amount: '100.00', currency: 'AZN' } },
          {
            account: 'platform_fee',
            direction: 'CREDIT',
            amount: { amount: '100.00', currency: 'AZN' },
          },
        ],
        balanced: true,
      },
    ],
    balances: [
      { account: 'escrow', net: { amount: '100.00', currency: 'AZN' } },
      { account: 'platform_fee', net: { amount: '-100.00', currency: 'AZN' } },
    ],
    nextCursor: null,
    ...overrides,
  };
}

function collection(overrides: Partial<AdminCollection> = {}): AdminCollection {
  return {
    id: 'c-1',
    slug: 'autumn-picks',
    kind: 'staff_selection',
    copy: { az: { title: 'Autumn picks' } },
    grantsBadge: false,
    sortOrder: 10,
    opensAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readTrailMock.mockResolvedValue({ entries: [], nextCursor: null });
  readLedgerMock.mockResolvedValue(ledgerView());
  readPaymentLogMock.mockResolvedValue({ transactions: [], nextCursor: null });
  listCollectionsMock.mockResolvedValue([collection()]);
});

/**
 * The console's read and curation screens — issues #300, #305 and #314.
 *
 * <p>Appearance is reviewed in Storybook. These cover the wiring that breaks silently: a
 * filter that narrows in the browser instead of at the service, a posting rendered with one
 * of its two sides, and a `PUT` that clears the six fields the form was not looking at. Every
 * one of those looks correct on screen and is wrong.
 */
describe('the ledger explorer', () => {
  it('shows both sides of a posting even when the filter matched one of them', async () => {
    const user = userEvent.setup();
    render(<LedgerExplorer copy={LEDGER} />);
    await screen.findByText('Escrow');

    await user.click(screen.getByRole('button', { name: 'Escrow' }));

    await waitFor(() => {
      expect(readLedgerMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ account: 'escrow' }),
      );
    });

    // The filter decides which postings appear and never which half of one is shown. A
    // ledger rendering one side of a double entry would be showing a balance that does not
    // balance, which is the one thing this table exists to make impossible.
    expect(await screen.findAllByText('Platform fee')).not.toHaveLength(0);
    expect(screen.getAllByText('debit').length).toBe(1);
    expect(screen.getAllByText('credit').length).toBe(1);
  });

  it('keeps every account in the balance panel while the postings narrow', async () => {
    const user = userEvent.setup();
    render(<LedgerExplorer copy={LEDGER} />);
    await screen.findByText('Balances across the platform');

    await user.click(screen.getByRole('button', { name: 'Escrow' }));
    await waitFor(() => expect(readLedgerMock).toHaveBeenCalledTimes(2));

    // Filtering to escrow does not make the other accounts stop existing, and a one-line
    // balance panel would read as though it were the whole ledger. Scoped to the panel,
    // because the posting below it carries the same figures.
    const panel = screen.getByText('Balances across the platform').parentElement!;
    expect(within(panel).getByText('100.00 AZN')).toBeInTheDocument();
    expect(within(panel).getByText('-100.00 AZN')).toBeInTheDocument();
  });

  it('raises an alarm about a posting that does not balance', async () => {
    const view = ledgerView();
    readLedgerMock.mockResolvedValue({
      ...view,
      postings: [{ ...view.postings[0]!, balanced: false }],
    });
    render(<LedgerExplorer copy={LEDGER} />);

    // V41 refuses to commit one, so reaching this means a row arrived past both the
    // application and the database. It is an incident and the reader needs to know first.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A posting does not balance');
  });

  it('tells a reader who is not staff why, rather than showing an empty ledger', async () => {
    readLedgerMock.mockRejectedValue(new ApiError(403, { code: 'NOT_A_MODERATOR' }, 'no'));
    render(<LedgerExplorer copy={LEDGER} />);

    expect(await screen.findByText('You do not work here')).toBeInTheDocument();
    // And not an empty state, which on a ledger reads as "no money has moved".
    expect(screen.queryByText('Nothing has been posted yet')).toBeNull();
  });

  it('names the capability a colleague is short of, rather than calling them a stranger', async () => {
    readLedgerMock.mockRejectedValue(
      new ApiError(
        403,
        { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'VIEW_FINANCE' } },
        'no',
      ),
    );
    render(<LedgerExplorer copy={LEDGER} />);

    /*
     * Issue #400. `StaffDirectory.requireCapability` separates the two 403s deliberately and
     * says why: "a stranger is told they do not work here; a colleague is told which
     * authority this screen wanted". The console rendered the stranger's sentence for both,
     * so a moderator opening a money screen was told they were not a moderator — on a
     * console that had just loaded the moderation queue for them.
     */
    expect(await screen.findByText('This screen is not yours')).toBeInTheDocument();
    expect(screen.getByText(/VIEW_FINANCE/)).toBeInTheDocument();
    expect(screen.queryByText('You do not work here')).toBeNull();
  });
});

describe('the audit trail', () => {
  it('asks the service to narrow rather than filtering the page it holds', async () => {
    const user = userEvent.setup();
    render(<AuditTrailView copy={AUDIT} />);
    await screen.findByRole('button', { name: 'Everything' });

    await user.click(screen.getByRole('button', { name: 'Campaigns' }));

    // A chip that filtered twenty-five rows in the browser would say "3 results" about a
    // table with four thousand matching rows in it, which on an audit surface is a wrong
    // answer rather than a rough edge.
    await waitFor(() => {
      expect(readTrailMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ entityType: 'project' }),
      );
    });
  });

  it('says an empty trail is empty rather than broken', async () => {
    const user = userEvent.setup();
    render(<AuditTrailView copy={AUDIT} />);
    await screen.findByRole('button', { name: 'Everything' });

    // Reads are hidden when the screen opens, and an empty page under that is "nothing
    // matches"; with everything shown it is a statement about the platform.
    await user.click(screen.getByRole('switch', { name: AUDIT.hideReads }));

    expect(await screen.findByText('Nothing has been recorded yet')).toBeInTheDocument();
  });

  it('narrows to a day, in the reader\u2019s timezone rather than in UTC — #404', async () => {
    const user = userEvent.setup();
    render(<AuditTrailView copy={AUDIT} />);
    await screen.findByRole('button', { name: 'Everything' });

    await user.type(screen.getByLabelText(AUDIT.fromLabel), '2026-09-02');
    await user.type(screen.getByLabelText(AUDIT.toLabel), '2026-09-02');

    /*
     * "What did this person do last Tuesday" is the question an audit log exists to answer,
     * and until #404 the only way to ask it was to page until the dates stopped being
     * interesting. The upper bound is the NEXT midnight, which is what makes "the 2nd to the
     * 2nd" one whole day rather than one instant.
     */
    await waitFor(() => {
      const asked = readTrailMock.mock.calls.at(-1)?.[0];
      expect(asked?.from).toBe(new Date(2026, 8, 2).toISOString());
      expect(asked?.to).toBe(new Date(2026, 8, 3).toISOString());
    });
  });

  it('clears the range back to the whole trail', async () => {
    const user = userEvent.setup();
    render(<AuditTrailView copy={AUDIT} />);
    await screen.findByRole('button', { name: 'Everything' });

    await user.type(screen.getByLabelText(AUDIT.fromLabel), '2026-09-02');
    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]?.from).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: AUDIT.clearDates }));

    await waitFor(() => {
      const asked = readTrailMock.mock.calls.at(-1)?.[0];
      expect(asked?.from).toBeNull();
      expect(asked?.to).toBeNull();
    });
  });

  it('offers the range and the actor as controls, which it never did before #404', async () => {
    render(
      <ConsoleMembershipProvider
        given={{
          status: 'ready',
          membership: {
            accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
            staff: true,
            bootstrapped: false,
            roles: [],
            capabilities: ['VIEW_AUDIT', 'ADMINISTER_ACCOUNTS'],
          },
        }}
      >
        <AuditTrailView copy={AUDIT} />
      </ConsoleMembershipProvider>,
    );
    await screen.findByRole('button', { name: 'Everything' });

    /*
     * The service has accepted `actorId` since #314 and the screen offered no way to set
     * one, so the trail's central question was reachable only by editing the URL.
     */
    expect(screen.getByLabelText(AUDIT.actorPicker.label)).toBeInTheDocument();
    expect(screen.getByLabelText(AUDIT.fromLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(AUDIT.toLabel)).toBeInTheDocument();
  });

  it('says nothing matched rather than that nothing has ever happened', async () => {
    const user = userEvent.setup();
    render(<AuditTrailView copy={AUDIT} />);
    await screen.findByRole('button', { name: 'Everything' });

    await user.type(screen.getByLabelText(AUDIT.fromLabel), '2026-09-02');

    // An empty page under a filter is "nothing matches"; the unfiltered sentence would be a
    // statement about the platform, and a false one.
    expect(await screen.findByText(AUDIT.filteredTitle)).toBeInTheDocument();
    expect(screen.queryByText(AUDIT.emptyTitle)).not.toBeInTheDocument();
  });
});

describe('the payment log', () => {
  it('asks the service for one outcome rather than narrowing the page it holds', async () => {
    const user = userEvent.setup();
    render(<PaymentLogView copy={PAYMENTS} />);
    await screen.findByRole('button', { name: PAYMENTS.everyOutcome });

    await user.click(screen.getByRole('button', { name: PAYMENTS.status.FAILED }));

    /*
     * #404: the log's own description promises it includes rejected calls, failed provider
     * calls are the main reason anybody opens the screen, and they were the one view it
     * could not select. V63's index is what made the filter affordable.
     */
    await waitFor(() =>
      expect(readPaymentLogMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'FAILED' }),
      ),
    );
  });

  it('goes back to every outcome, and does not leave the chip selected', async () => {
    const user = userEvent.setup();
    render(<PaymentLogView copy={PAYMENTS} />);
    await screen.findByRole('button', { name: PAYMENTS.everyOutcome });

    await user.click(screen.getByRole('button', { name: PAYMENTS.status.FAILED }));
    await waitFor(() =>
      expect(readPaymentLogMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'FAILED' }),
      ),
    );

    await user.click(screen.getByRole('button', { name: PAYMENTS.everyOutcome }));

    await waitFor(() =>
      expect(readPaymentLogMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: null }),
      ),
    );
  });

  it('says no calls matched rather than that nothing has been charged', async () => {
    const user = userEvent.setup();
    render(<PaymentLogView copy={PAYMENTS} />);
    await screen.findByRole('button', { name: PAYMENTS.everyOutcome });

    await user.click(screen.getByRole('button', { name: PAYMENTS.status.PENDING }));

    expect(await screen.findByText(PAYMENTS.filteredTitle)).toBeInTheDocument();
    expect(screen.queryByText(PAYMENTS.emptyTitle)).not.toBeInTheDocument();
  });
});

describe('the badge manager', () => {
  it('sends the whole collection back, not only the field it changed', async () => {
    const user = userEvent.setup();
    replaceCollectionMock.mockResolvedValue(collection({ grantsBadge: true }));
    render(<BadgeManager copy={BADGES} note={NOTE} />);
    await screen.findByRole('button', { name: 'Grant the badge' });

    await user.click(screen.getByRole('button', { name: 'Grant the badge' }));
    // The dialog confirms a change that affects every campaign in the list.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Grant the badge' }));

    await waitFor(() => expect(replaceCollectionMock).toHaveBeenCalled());

    // `PUT` replaces the whole description. A body built from the one field the screen meant
    // to change would silently clear the window, the placement and the copy.
    expect(replaceCollectionMock).toHaveBeenCalledWith('autumn-picks', {
      kind: 'staff_selection',
      copy: { az: { title: 'Autumn picks' } },
      cover: null,
      opensAt: '2026-08-01T00:00:00.000Z',
      closesAt: null,
      grantsBadge: true,
      sortOrder: 10,
    });
  });

  it('says an unpublished collection badges nothing yet', async () => {
    listCollectionsMock.mockResolvedValue([collection({ grantsBadge: true })]);
    render(<BadgeManager copy={BADGES} note={NOTE} />);

    // A curator who turned the grant on and saw no badges would otherwise reasonably think
    // it had failed.
    expect(await screen.findByText('Unpublished — badges nothing yet')).toBeInTheDocument();
  });
});
