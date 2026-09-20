import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import type { CampaignDashboard } from '../../lib/dashboard/api';
import { DashboardOverview } from './DashboardOverview';
import { dashboardOverviewCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';

/**
 * What the creator dashboard says, and what it must never say.
 *
 * Rendered rather than screenshotted, because every assertion here is about a statement
 * concerning money or urgency that a picture cannot check:
 *
 *   - the figures are the campaign's, formatted from the exact strings the API sent;
 *   - a campaign at 99.99% has not reached its goal, and the screen must not imply it has;
 *   - a campaign with no goal gets no progress bar, rather than one at zero;
 *   - a closed campaign shows what it raised at the deadline beside the live total —
 *     #63's rule, and the pair a creator would otherwise misread;
 *   - a refusal reads as something the creator can act on rather than as a status code.
 */

const PROJECT_ID = '0193f2a1-0000-7000-8000-000000000001';

/** Noon on the server. The reader's clock is offset from this per test. */
const SERVER_TIME = '2026-08-20T12:00:00.000Z';

function dashboard(overrides: Partial<CampaignDashboard> = {}): CampaignDashboard {
  return {
    projectId: PROJECT_ID,
    slug: 'coffee-table-book',
    title: 'A coffee table book',
    state: 'LIVE',
    currency: 'AZN',
    goal: { amount: '10000.00', currency: 'AZN' },
    raised: { amount: '2500.00', currency: 'AZN' },
    backersCount: 42,
    percentFunded: 25,
    goalReached: false,
    deadline: '2026-09-19T12:00:00.000Z',
    serverTime: SERVER_TIME,
    ...overrides,
  } as CampaignDashboard;
}

/*
 * The words, built from `messages/en.json` with the builder the route calls — #79.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = dashboardOverviewCopyFrom(translatorFor('dashboard'));

function readerAt(iso: string): () => number {
  const fixed = Date.parse(iso);
  return () => fixed;
}

function renderPanel(body: CampaignDashboard, readerNow = readerAt(SERVER_TIME)) {
  return render(
    <DashboardOverview
      projectId={PROJECT_ID}
      load={() => Promise.resolve(body)}
      nowImpl={readerNow}
      copy={COPY}
    />,
  );
}

afterEach(cleanup);

describe('the totals', () => {
  it('renders what the campaign has raised, from whom, and against what', async () => {
    renderPanel(dashboard());

    expect(await screen.findByRole('heading', { name: 'A coffee table book' })).toBeInTheDocument();
    expect(screen.getByText('2,500.00 AZN')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('10,000.00 AZN')).toBeInTheDocument();
    expect(screen.getByText('25% funded')).toBeInTheDocument();
  });

  /**
   * The one number on this screen a creator acts on.
   *
   * The service rounds down and does not cap; this asserts the screen repeats it rather
   * than reformatting it into something friendlier. "100% funded" on a campaign that has
   * not reached its goal is the failure this prevents.
   */
  it('does not round a campaign that is nearly there up to its goal', async () => {
    renderPanel(dashboard({ percentFunded: 99.99, goalReached: false }));

    expect(await screen.findByText('99.99% funded')).toBeInTheDocument();
    expect(screen.queryByText('Goal reached')).not.toBeInTheDocument();
  });

  it('says so in words when the goal is reached, not only in colour', async () => {
    renderPanel(dashboard({ percentFunded: 240, goalReached: true }));

    expect(await screen.findByText('240% funded')).toBeInTheDocument();
    // ui-kit §9.2: colour alone carries nothing. The badge is a word and an icon.
    expect(screen.getByText('Goal reached')).toBeInTheDocument();
  });

  /**
   * A bar at zero says "this campaign has raised none of what it asked for". A campaign
   * with no goal has not asked for anything, which is a different statement.
   */
  it('shows no progress bar at all when there is no goal', async () => {
    renderPanel(dashboard({ goal: undefined, percentFunded: undefined, state: 'DRAFT' }));

    expect(await screen.findByText(/no funding goal yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Not set yet')).toBeInTheDocument();
  });
});

describe('the clock', () => {
  it('counts down against the service clock even when the reader is fast', async () => {
    // The reader is forty minutes ahead. Thirty days remain by the service's clock; an
    // uncorrected countdown would say twenty-nine.
    renderPanel(dashboard(), readerAt('2026-08-20T12:40:00.000Z'));

    expect(await screen.findByText('30 days left')).toBeInTheDocument();
  });

  /**
   * Lime means "act now" and nothing else, so it appears inside forty-eight hours and
   * not before. A campaign a month out wearing an urgent colour is the platform crying
   * wolf on its own dashboard.
   */
  it('is urgent only inside the last forty-eight hours, and says so in words', async () => {
    renderPanel(
      dashboard({ deadline: '2026-08-21T12:00:00.000Z' }),
      readerAt(SERVER_TIME),
    );

    expect(await screen.findByText('1 day left')).toBeInTheDocument();
    expect(screen.getByText('Closing soon')).toBeInTheDocument();
  });

  it('is not urgent a month out', async () => {
    renderPanel(dashboard());

    expect(await screen.findByText('30 days left')).toBeInTheDocument();
    expect(screen.queryByText('Closing soon')).not.toBeInTheDocument();
  });

  it('says there is no countdown rather than showing an expired one before launch', async () => {
    renderPanel(dashboard({ deadline: undefined, state: 'DRAFT' }));

    expect(await screen.findByText(/no deadline yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
  });
});

describe('a closed campaign', () => {
  /**
   * #63's rule on this screen. The two figures legitimately differ once collections
   * begin failing, and a dashboard showing only the live one would contradict the word
   * printed beside it.
   */
  it('shows what it raised at the deadline beside what is left after collection', async () => {
    renderPanel(
      dashboard({
        state: 'SUCCESSFUL',
        raised: { amount: '11500.00', currency: 'AZN' },
        percentFunded: 115,
        goalReached: true,
        outcome: {
          goal: { amount: '10000.00', currency: 'AZN' },
          pledged: { amount: '12500.00', currency: 'AZN' },
          backersCount: 84,
          finalisedAt: '2026-08-19T12:00:00.000Z',
        },
      }),
    );

    const heading = await screen.findByText('At the deadline');
    // The paragraph interleaves text and interpolated values, so the assertion is on the
    // sentence it renders to rather than on a single text node.
    const note = heading.parentElement?.textContent ?? '';
    expect(note).toContain('12,500.00 AZN');
    expect(note).toContain('84 backers');
    expect(note).toContain('10,000.00 AZN');

    // And the live total beside it, which collections have since reduced.
    expect(screen.getByText('11,500.00 AZN')).toBeInTheDocument();
  });

  it('says nothing about an outcome while the campaign is running', async () => {
    renderPanel(dashboard());

    await screen.findByText('25% funded');
    expect(screen.queryByText('At the deadline')).not.toBeInTheDocument();
  });
});

describe('refusals', () => {
  function failing(status: number) {
    return render(
      <DashboardOverview
        projectId={PROJECT_ID}
        load={() => Promise.reject(new ApiError(status, { status, title: 'no' }))}
        nowImpl={readerAt(SERVER_TIME)}
        copy={COPY}
      />,
    );
  }

  /**
   * A collaborator without `VIEW_FINANCES` is told which grant is missing. "Forbidden"
   * would leave them asking the creator a question the screen could have answered.
   */
  it('explains a missing finance grant rather than reporting a status', async () => {
    failing(403);

    await waitFor(() => expect(screen.getByText(/does not include the finances/i)).toBeInTheDocument());
  });

  it('treats a 404 as "not yours or not there", which is what the service means by it', async () => {
    failing(404);

    await waitFor(() => expect(screen.getByText(/does not exist, or it is not one you work on/i)).toBeInTheDocument());
  });

  it('distinguishes the service being unavailable from the campaign being wrong', async () => {
    failing(503);

    await waitFor(() => expect(screen.getByText(/service rather than your campaign/i)).toBeInTheDocument());
  });
});
