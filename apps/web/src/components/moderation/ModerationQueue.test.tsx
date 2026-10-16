import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { QueuedReport, ReportQueuePage } from '../../lib/moderation/api';
import { getReport, listReports, resolveReport } from '../../lib/moderation/api';
import { lookUpNames } from '../../lib/admin/directory';
import { ModerationQueue } from './ModerationQueue';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { moderationQueueCopyFrom } from '../../lib/i18n/admin/content-copy';

/*
 * The copy is built from `messages/en.json` with the same builders the routes call, rather
 * than typed out here. `src/test-copy.ts` explains why at length: a suite that retyped the
 * sentences would still be green with the catalogue empty, which is precisely the defect
 * `catalogue.test.ts` exists to catch.
 */
const COPY = moderationQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/moderation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/moderation/api')>();
  return {
    ...actual,
    listReports: vi.fn(),
    getReport: vi.fn(),
    resolveReport: vi.fn(),
  };
});

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const listReportsMock = vi.mocked(listReports);
const lookUpNamesMock = vi.mocked(lookUpNames);
const getReportMock = vi.mocked(getReport);
const resolveReportMock = vi.mocked(resolveReport);

const PROJECT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const ACCOUNT_ID = 'u9u8u7u6-0000-4000-8000-000000000002';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const CAMPAIGN_REPORT: QueuedReport = {
  id: 'report-campaign',
  target: { type: 'PROJECT', id: PROJECT_ID },
  openReportsOnTarget: 3,
  reporterId: 'reporter-0001-aaaa',
  reason: 'FRAUD',
  detail: 'The prototype photographs are lifted from another campaign.',
  state: 'OPEN',
  createdAt: hoursAgo(72),
};

const ACCOUNT_REPORT: QueuedReport = {
  id: 'report-account',
  target: { type: 'USER', id: ACCOUNT_ID },
  openReportsOnTarget: 1,
  reporterId: 'reporter-0002-bbbb',
  reason: 'SPAM',
  state: 'OPEN',
  createdAt: hoursAgo(2),
};

function page(reports: QueuedReport[], nextCursor?: string): ReportQueuePage {
  return { state: reports[0]?.state ?? 'OPEN', reports, nextCursor: nextCursor ?? null };
}

beforeEach(() => {
  vi.clearAllMocks();
  listReportsMock.mockResolvedValue(page([CAMPAIGN_REPORT, ACCOUNT_REPORT]));
  lookUpNamesMock.mockResolvedValue({ accounts: [], projects: [] });
});

/**
 * Appearance is reviewed in Storybook. These cover BEHAVIOUR and
 * ACCESSIBILITY — the wiring that breaks silently and still ships. Every one of
 * the two decisions here is privileged and irreversible, so the tests that
 * matter most are the ones about a decision that did NOT go through.
 */
describe('ModerationQueue', () => {
  describe('loading, empty and failure', () => {
    it('announces that it is loading rather than showing a blank queue', () => {
      listReportsMock.mockReturnValue(new Promise<ReportQueuePage>(() => {}));
      render(<ModerationQueue copy={COPY} />);

      const label = screen.getByText('Loading the moderation queue');
      expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    });

    it('asks the service for the open reports first, because that is the queue', async () => {
      render(<ModerationQueue copy={COPY} />);
      await screen.findByRole('heading', { name: /Open reports/ });

      expect(listReportsMock).toHaveBeenCalledWith(expect.objectContaining({ state: 'OPEN' }));
    });

    it('says the queue is clear rather than showing nothing at all', async () => {
      listReportsMock.mockResolvedValue(page([]));
      render(<ModerationQueue copy={COPY} />);

      expect(await screen.findByText('The queue is clear')).toBeInTheDocument();
    });

    it('shows why a load failed and offers to try again', async () => {
      const user = userEvent.setup();
      listReportsMock.mockRejectedValueOnce(new TypeError('offline'));
      render(<ModerationQueue copy={COPY} />);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The service could not be reached');

      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Spam')).toBeInTheDocument();
    });

    it('tells a signed-out browser to sign in instead of showing an empty queue', async () => {
      listReportsMock.mockRejectedValue(new ApiError(401, null, 'You are not signed in.'));
      render(<ModerationQueue copy={COPY} />);

      expect(await screen.findByText('You are signed out')).toBeInTheDocument();
    });

    it('tells a signed-in non-moderator that the queue is not theirs', async () => {
      listReportsMock.mockRejectedValue(
        new ApiError(403, { code: 'NOT_A_MODERATOR', detail: 'Staff only.' }),
      );
      render(<ModerationQueue copy={COPY} />);

      expect(await screen.findByText('You do not work here')).toBeInTheDocument();
    });
  });

  describe('the cards', () => {
    it('names every action by what it does AND what it acts on', async () => {
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      expect(
        screen.getByRole('button', { name: 'Uphold the report about campaign a1b2c3d4' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Dismiss the report about campaign a1b2c3d4' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Uphold the report about account u9u8u7u6' }),
      ).toBeInTheDocument();
    });

    it('offers no campaign outcomes, which only the review queue can reach', async () => {
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      // Approve, request changes and reject move a campaign out of review. A reported campaign
      // is almost always live, where all three are refused, so a card offering them offered
      // three buttons that could only fail.
      expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Request changes/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Reject/ })).toBeNull();
    });

    it('marks a report that has waited too long in words, not only in colour', async () => {
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      // 72 hours old, past the 48-hour threshold; the 2-hour-old one is not.
      expect(screen.getAllByText('Overdue')).toHaveLength(1);
    });

    it('shows the decision, who took it and when, for a report that is already resolved', async () => {
      listReportsMock.mockResolvedValue(
        page([
          {
            ...CAMPAIGN_REPORT,
            state: 'UPHELD',
            resolution: {
              moderatorId: 'mod-1234-cccc',
              at: '2026-08-14T09:30:00.000Z',
              note: 'Confirmed against the original listing.',
            },
          },
        ]),
      );
      render(<ModerationQueue copy={COPY} />);

      await screen.findByRole('heading', { name: 'Decision' });
      expect(screen.getByText(/Upheld by moderator/)).toHaveTextContent('mod-1234');
      expect(screen.getByText('Confirmed against the original listing.')).toBeInTheDocument();
      // A decided report has no buttons that would decide it again.
      expect(screen.queryByRole('button', { name: /^Uphold/ })).toBeNull();
    });

    it('names the moderator who decided, as the detail screen does', async () => {
      lookUpNamesMock.mockResolvedValue({
        accounts: [{ id: 'mod-1234-cccc', name: 'Leyla Moderator', slug: 'leyla' }],
        projects: [],
      });
      listReportsMock.mockResolvedValue(
        page([
          {
            ...ACCOUNT_REPORT,
            state: 'DISMISSED',
            resolution: { moderatorId: 'mod-1234-cccc', at: '2026-08-14T09:30:00.000Z' },
          },
        ]),
      );
      render(<ModerationQueue copy={COPY} />);

      expect(await screen.findByText('Leyla Moderator')).toBeInTheDocument();
      expect(lookUpNamesMock).toHaveBeenCalledWith(
        expect.arrayContaining(['mod-1234-cccc']),
        [],
        expect.anything(),
      );
    });
  });

  describe('filters', () => {
    it('asks the service again when the state changes, because only that is a server filter', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      listReportsMock.mockResolvedValue(page([]));
      await user.click(screen.getByRole('button', { name: 'Upheld' }));

      await waitFor(() => {
        expect(listReportsMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ state: 'UPHELD' }),
        );
      });
      expect(screen.getByRole('button', { name: 'Upheld' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('asks the service to narrow by target rather than filtering the page it holds', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      await user.click(screen.getByRole('button', { name: 'Accounts' }));

      // #298. Filtering in the browser would leave the cursor pointing past the reports it
      // dropped, with nothing able to ask for them back: a page of twenty-five containing
      // two profile reports is not a page of two.
      await waitFor(() => {
        expect(listReportsMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ state: 'OPEN', target: 'USER' }),
        );
      });
      expect(await screen.findByText('Spam')).toBeInTheDocument();
      expect(screen.queryByText('Fraud')).toBeNull();
    });

    it('does not call a server-narrowed queue a filtered one', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      await user.click(screen.getByRole('button', { name: 'Accounts' }));
      expect(await screen.findByText('Spam')).toBeInTheDocument();

      // No "showing 1 of 2" line: the service was asked for accounts and returned accounts,
      // and every page of them is reachable.
      expect(screen.queryByText(/Showing/)).toBeNull();
    });

    it('explains an empty result that a filter caused rather than claiming the queue is clear', async () => {
      const user = userEvent.setup();
      // One report, two hours old, complained about by one person: it survives the server
      // filters and neither triage narrowing.
      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Spam');

      await user.click(screen.getByRole('button', { name: 'Open over 48 hours' }));

      expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument();
      // And not "The queue is clear", which would be a different and untrue sentence.
      expect(screen.queryByText('The queue is clear')).toBeNull();
    });
  });

  describe('pinned to one kind of target', () => {
    it('asks the service for that kind and offers no way to widen', async () => {
      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      render(<ModerationQueue pinnedTarget="USER" copy={COPY} />);
      await screen.findByText('Spam');

      expect(listReportsMock).toHaveBeenCalledWith(expect.objectContaining({ target: 'USER' }));
      // A chip row whose first entry widens back to everything is a control that turns the
      // profile screen into the whole queue, under a heading that still says profiles.
      expect(screen.queryByRole('button', { name: 'Everything' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Campaigns' })).toBeNull();
    });

    it('keeps the state tabs, which narrow a different question', async () => {
      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      render(<ModerationQueue pinnedTarget="USER" copy={COPY} />);
      await screen.findByText('Spam');

      expect(screen.getByRole('button', { name: 'Upheld' })).toBeInTheDocument();
    });
  });

  describe('the decision detail link', () => {
    it('is absent unless the screen says where it goes', async () => {
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      expect(screen.queryByRole('link', { name: /Full history/ })).toBeNull();
    });

    it('names the report it opens, because twenty of "Open" is unusable by ear', async () => {
      render(<ModerationQueue detailHrefBase="/admin/moderation" copy={COPY} />);
      await screen.findByText('Fraud');

      const link = screen.getByRole('link', {
        name: /Open the full history of the report about campaign/,
      });
      expect(link).toHaveAttribute('href', '/en/admin/moderation/report-campaign');
    });
  });

  describe('paging', () => {
    it('appends the next page instead of replacing what is on screen', async () => {
      const user = userEvent.setup();
      listReportsMock.mockResolvedValueOnce(page([CAMPAIGN_REPORT], 'cursor-2'));
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      listReportsMock.mockResolvedValueOnce(page([ACCOUNT_REPORT]));
      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(await screen.findByText('Spam')).toBeInTheDocument();
      expect(screen.getByText('Fraud')).toBeInTheDocument();
      expect(listReportsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ after: 'cursor-2' }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      });
    });
  });

  describe('deciding a report', () => {
    it('confirms before it commits, and sends the note the moderator wrote', async () => {
      const user = userEvent.setup();
      resolveReportMock.mockResolvedValue({
        ...CAMPAIGN_REPORT,
        state: 'UPHELD',
        resolution: { moderatorId: 'me', at: new Date().toISOString(), note: 'Verified.' },
      });
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      await user.click(
        screen.getByRole('button', { name: 'Uphold the report about campaign a1b2c3d4' }),
      );

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
      expect(resolveReportMock).not.toHaveBeenCalled();

      await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Verified.');
      await user.click(within(dialog).getByRole('button', { name: 'Uphold report' }));

      await waitFor(() => {
        expect(resolveReportMock).toHaveBeenCalledWith('report-campaign', 'uphold', 'Verified.');
      });
    });

    it('takes the decided report out of the open queue and says so politely', async () => {
      const user = userEvent.setup();
      resolveReportMock.mockResolvedValue({
        ...CAMPAIGN_REPORT,
        state: 'DISMISSED',
        resolution: { moderatorId: 'me', at: new Date().toISOString() },
      });
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      await user.click(
        screen.getByRole('button', { name: 'Dismiss the report about campaign a1b2c3d4' }),
      );
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dismiss report' }),
      );

      await waitFor(() => expect(screen.queryByText('Fraud')).toBeNull());
      expect(screen.getByRole('status')).toHaveTextContent(
        'Dismissed the report about campaign a1b2c3d4.',
      );
      // An optional note left blank is absent, not an empty string.
      expect(resolveReportMock).toHaveBeenCalledWith('report-campaign', 'dismiss', null);
    });

    it('keeps the row and shows the reason when the service refuses', async () => {
      const user = userEvent.setup();
      resolveReportMock.mockRejectedValue(
        new ApiError(500, { title: 'Something broke', detail: 'The decision was not saved.' }),
      );
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      await user.click(
        screen.getByRole('button', { name: 'Uphold the report about campaign a1b2c3d4' }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Uphold report' }));

      expect(await within(dialog).findByText('The decision was not saved.')).toBeInTheDocument();
      // Nothing was removed, and nothing claims to have succeeded.
      expect(screen.getByText('Fraud')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('corrects itself visibly when another moderator decided first', async () => {
      const user = userEvent.setup();
      resolveReportMock.mockRejectedValue(
        new ApiError(409, {
          code: 'REPORT_ALREADY_RESOLVED',
          detail: 'That report has already been upheld.',
          meta: { state: 'UPHELD', allowed: [] },
        }),
      );
      getReportMock.mockResolvedValue({
        ...CAMPAIGN_REPORT,
        state: 'UPHELD',
        resolution: { moderatorId: 'someone-else', at: new Date().toISOString() },
      });
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      await user.click(
        screen.getByRole('button', { name: 'Uphold the report about campaign a1b2c3d4' }),
      );
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uphold report' }),
      );

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(getReportMock).toHaveBeenCalledWith('report-campaign');
      // It left the OPEN queue, and the queue said why rather than going quiet.
      expect(screen.queryByText('Fraud')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent('Somebody else decided this report');
    });
  });

  describe('triage on a decided tab', () => {
    it('drops the overdue chip, because only an open report can be overdue', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');
      expect(screen.getByRole('button', { name: 'Open over 48 hours' })).toBeInTheDocument();

      listReportsMock.mockResolvedValue(page([]));
      await user.click(screen.getByRole('button', { name: 'Upheld' }));

      await screen.findByText('No upheld reports');
      expect(screen.queryByRole('button', { name: 'Open over 48 hours' })).toBeNull();
      expect(screen.getByRole('button', { name: 'More than one report' })).toBeInTheDocument();
    });

    it('does not carry the overdue filter onto a tab where it would empty the list', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');
      await user.click(screen.getByRole('button', { name: 'Open over 48 hours' }));

      listReportsMock.mockResolvedValue(
        page([{ ...ACCOUNT_REPORT, state: 'UPHELD', createdAt: hoursAgo(96) }]),
      );
      await user.click(screen.getByRole('button', { name: 'Upheld' }));

      expect(await screen.findByText('Spam')).toBeInTheDocument();
      expect(screen.queryByText('Nothing matches these filters')).toBeNull();

      listReportsMock.mockResolvedValue(page([CAMPAIGN_REPORT, ACCOUNT_REPORT]));
      await user.click(screen.getByRole('button', { name: 'Open' }));
      await screen.findByText('Fraud');
      expect(screen.getByRole('button', { name: 'Open over 48 hours' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  describe('keyboard and focus', () => {
    it('reaches an action by Tab alone and fires it with Enter', async () => {
      const user = userEvent.setup();
      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Spam');

      const uphold = screen.getByRole('button', {
        name: 'Uphold the report about account u9u8u7u6',
      });

      uphold.focus();
      expect(uphold).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('moves focus somewhere that still exists when the card it came from is gone', async () => {
      const user = userEvent.setup();
      resolveReportMock.mockResolvedValue({
        ...ACCOUNT_REPORT,
        state: 'UPHELD',
        resolution: { moderatorId: 'me', at: new Date().toISOString() },
      });
      listReportsMock.mockResolvedValue(page([ACCOUNT_REPORT]));
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Spam');

      await user.click(
        screen.getByRole('button', { name: 'Uphold the report about account u9u8u7u6' }),
      );
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uphold report' }),
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Open reports/ })).toHaveFocus();
      });
    });

    it('lets Escape out of a decision without taking it', async () => {
      const user = userEvent.setup();
      render(<ModerationQueue copy={COPY} />);
      await screen.findByText('Fraud');

      await user.click(
        screen.getByRole('button', { name: 'Uphold the report about campaign a1b2c3d4' }),
      );
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(resolveReportMock).not.toHaveBeenCalled();
    });
  });
});
