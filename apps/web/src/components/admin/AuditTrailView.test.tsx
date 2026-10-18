import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTrail, type AuditEntry, type AuditTrailPage } from '../../lib/admin/audit';
import { lookUpNames } from '../../lib/admin/directory';
import type { StaffCapability } from '../../lib/admin/staff';
import { AuditTrailView } from './AuditTrailView';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { auditTrailCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

const ADMIN = translatorFor('admin');
const COPY = auditTrailCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('../../lib/admin/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/audit')>()),
  readTrail: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const readTrailMock = vi.mocked(readTrail);
const lookUpNamesMock = vi.mocked(lookUpNames);

const MODERATOR = '0191f2ab-0000-7000-8000-00000000000a';
const FINANCE = '0191f2ab-0000-7000-8000-00000000000b';
const CAMPAIGN = '0191f2ab-0000-7000-8000-00000000000c';

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: crypto.randomUUID(),
    occurredAt: '2026-10-14T10:00:00.000Z',
    actorType: 'MODERATOR',
    actorId: MODERATOR,
    action: 'project.approved',
    entityType: 'project',
    entityId: CAMPAIGN,
    outcome: 'SUCCEEDED',
    ...overrides,
  };
}

function trailPage(entries: AuditEntry[], nextCursor: string | null = null): AuditTrailPage {
  return { entries, nextCursor };
}

function renderFor(capabilities: readonly StaffCapability[]) {
  return render(
    <ConsoleMembershipProvider
      given={{
        status: 'ready',
        membership: {
          accountId: FINANCE,
          staff: true,
          bootstrapped: false,
          roles: [],
          capabilities: [...capabilities],
        },
      }}
    >
      <AuditTrailView copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readTrailMock.mockResolvedValue(trailPage([entry()]));
  lookUpNamesMock.mockResolvedValue({
    accounts: [
      { id: MODERATOR, name: 'Leyla Məmmədova', slug: 'leyla' },
      { id: FINANCE, name: 'Rauf Həsənov', slug: 'rauf' },
    ],
    projects: [{ id: CAMPAIGN, title: 'Xari Bulbul Ceramics', slug: 'xari', creatorSlug: 'aysel', creatorId: MODERATOR }],
  } as never);
});

describe('the audit trail', () => {
  it('hides the routine screen reads when it opens, and shows them at a switch', async () => {
    const user = userEvent.setup();
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.approved as string);

    expect(readTrailMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ hideReads: true }));
    const toggle = screen.getByRole('switch', { name: COPY.hideReads });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ hideReads: false })),
    );
  });

  it('draws the account search only for a reader who may search accounts, and a row control for everybody', async () => {
    renderFor(['VIEW_AUDIT', 'VIEW_FINANCE']);
    await screen.findByText(COPY.action.project?.approved as string);

    // `/v1/admin/users` is ADMINISTER_ACCOUNTS'; the search box could only ever have been refused.
    expect(screen.queryByLabelText(COPY.actorPicker.label)).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: fillPlaceholders(COPY.byThisPersonLabel, { name: 'Leyla Məmmədova' }) }),
    ).toBeInTheDocument();
  });

  it('draws the account search for a reader who administers accounts', async () => {
    renderFor(['VIEW_AUDIT', 'ADMINISTER_ACCOUNTS']);
    await screen.findByText(COPY.action.project?.approved as string);

    expect(screen.getByLabelText(COPY.actorPicker.label)).toBeInTheDocument();
  });

  it('narrows to a row’s actor and keeps that person when a kind is chosen — the two combine on the service', async () => {
    const user = userEvent.setup();
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.approved as string);

    await user.click(
      await screen.findByRole('button', { name: fillPlaceholders(COPY.byThisPersonLabel, { name: 'Leyla Məmmədova' }) }),
    );
    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ actorId: MODERATOR })),
    );
    expect(screen.getByText(COPY.actorApplied)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.entity.project as string }));
    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ actorId: MODERATOR, entityType: 'project' }),
      ),
    );

    await user.click(screen.getByRole('button', { name: COPY.everyone }));
    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ actorId: null })),
    );
  });

  it('offers every kind the service writes, and none it does not', async () => {
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.approved as string);

    const chips = screen.getByRole('group', { name: COPY.filterLabel });
    expect(within(chips).getByRole('button', { name: COPY.entity.payout as string })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: COPY.entity.refund as string })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: COPY.entity.legal_document as string })).toBeInTheDocument();
    expect(within(chips).queryByRole('button', { name: COPY.entity.collection as string })).not.toBeInTheDocument();
  });

  it('appends the next page, and drops a page that arrives after the question changed', async () => {
    const user = userEvent.setup();
    readTrailMock.mockResolvedValueOnce(trailPage([entry({ action: 'project.rejected' })], 'cursor-1'));
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.rejected as string);

    let late: (page: AuditTrailPage) => void = () => {};
    readTrailMock.mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
    await user.click(screen.getByRole('button', { name: COPY.loadMore }));
    expect(readTrailMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ after: 'cursor-1' }));

    // The question changes while that page is on its way.
    readTrailMock.mockResolvedValueOnce(trailPage([entry({ action: 'report.upheld', entityType: 'report' })]));
    await user.click(screen.getByRole('button', { name: COPY.entity.report as string }));
    await screen.findByText(COPY.action.report?.upheld as string);

    late(trailPage([entry({ action: 'project.suspended' })]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The old question's second page is not a page of the new list.
    expect(screen.queryByText(COPY.action.project?.suspended as string)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.action.project?.rejected as string)).not.toBeInTheDocument();
  });

  it('loads the next page onto the first when nothing changed', async () => {
    const user = userEvent.setup();
    readTrailMock.mockResolvedValueOnce(trailPage([entry({ action: 'project.rejected' })], 'cursor-1'));
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.rejected as string);

    readTrailMock.mockResolvedValueOnce(trailPage([entry({ action: 'project.suspended' })]));
    await user.click(screen.getByRole('button', { name: COPY.loadMore }));

    expect(await screen.findByText(COPY.action.project?.suspended as string)).toBeInTheDocument();
    expect(screen.getByText(COPY.action.project?.rejected as string)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.loadMore })).not.toBeInTheDocument();
  });

  it('names the thing in the singular and the actor in words, and a read once', async () => {
    readTrailMock.mockResolvedValue(
      trailPage([
        entry(),
        entry({ action: 'audit.trail_read', entityType: 'account', entityId: FINANCE, actorId: FINANCE }),
        entry({ action: 'something.new_here', entityType: 'widget', actorType: 'SYSTEM', actorId: null }),
      ]),
    );
    renderFor(['VIEW_AUDIT', 'MODERATE_CONTENT']);
    const approval = (await screen.findByText(COPY.action.project?.approved as string)).closest('li') as HTMLElement;

    expect(within(approval).getByText(COPY.entityOne.project as string)).toBeInTheDocument();
    expect(within(approval).queryByText(COPY.entity.project as string)).not.toBeInTheDocument();
    expect(within(approval).getByText(COPY.actorType.MODERATOR as string)).toBeInTheDocument();
    expect(within(approval).queryByText('moderator')).not.toBeInTheDocument();

    // A row about the account that wrote it names that person once, as the actor.
    const read = screen.getByText(COPY.action.audit?.trail_read as string).closest('li') as HTMLElement;
    expect(await within(read).findAllByText('Rauf Həsənov')).toHaveLength(1);
    expect(within(read).queryByText(COPY.entityOne.account as string)).not.toBeInTheDocument();

    // An action the catalogue has not been taught is drawn as its wire spelling, not dropped.
    const unknown = screen.getByText('something.new_here').closest('li') as HTMLElement;
    expect(within(unknown).getByText('widget')).toBeInTheDocument();
    expect(within(unknown).getByText(COPY.actorType.SYSTEM as string)).toBeInTheDocument();
  });

  it('folds the technical detail under its own summary rather than printing it as prose', async () => {
    const user = userEvent.setup();
    readTrailMock.mockResolvedValue(trailPage([entry({ detail: 'rows=25; entityType=project; actor=none' })]));
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.approved as string);

    const summary = screen.getByText(COPY.technicalNote);
    expect(summary.tagName).toBe('SUMMARY');
    await user.click(summary);
    expect(screen.getByText('rows=25; entityType=project; actor=none')).toBeVisible();
  });

  it('reads the trail once the date has been typed, not once per keystroke', async () => {
    const user = userEvent.setup();
    renderFor(['VIEW_AUDIT']);
    await screen.findByText(COPY.action.project?.approved as string);
    const before = readTrailMock.mock.calls.length;

    await user.type(screen.getByLabelText(COPY.fromLabel), '2026-09-02');

    await waitFor(() =>
      expect(readTrailMock.mock.calls.at(-1)?.[0]?.from).toBe(new Date(2026, 8, 2).toISOString()),
    );
    expect(readTrailMock.mock.calls.length - before).toBe(1);
  });

  it('has no accessibility violations with rows, a detail and a refusal on the page', async () => {
    readTrailMock.mockResolvedValue(
      trailPage([entry({ detail: 'note', requestId: 'req-1' }), entry({ outcome: 'REFUSED', action: 'payout.sent', entityType: 'payout' })], 'c'),
    );
    const { container } = renderFor(['VIEW_AUDIT', 'ADMINISTER_ACCOUNTS']);
    await screen.findByText(COPY.action.project?.approved as string);

    await expectNoViolations(container);
  });
});
