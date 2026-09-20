import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { Trend } from '../../lib/dashboard/analytics';
import type { BackerBreakdown } from '../../lib/dashboard/backers';
import { FundingCharts } from './FundingCharts';
import { fundingChartsCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';

/**
 * §4.7's CD-02, CD-07 and CD-08 as a screen.
 *
 * <p>The assertions are about the numbers and the words, never about the geometry. A test
 * that pinned a polyline's coordinates would fail on every layout change and would still
 * not tell anybody whether the chart was true — which is what the table underneath it is
 * for, and what these read.
 */

function trend(overrides: Partial<Trend> = {}): Trend {
  return {
    zone: 'Asia/Baku',
    from: '2026-07-20',
    to: '2026-08-18',
    currency: 'AZN',
    computedAt: '2026-08-18T09:00:00.000Z',
    days: [],
    ...overrides,
  };
}

function breakdown(overrides: Partial<BackerBreakdown> = {}): BackerBreakdown {
  return { backerCount: 0, rewards: [], countries: [], ...overrides };
}

const DAYS: Trend['days'] = [
  {
    day: '2026-08-01',
    pledgeCount: 2,
    amount: { amount: '100.00', currency: 'AZN' },
    cumulativePledgeCount: 2,
    cumulativeAmount: { amount: '100.00', currency: 'AZN' },
  },
  // A four-day gap: the rollup writes no row for a day with no pledges, and the chart has
  // to survive it.
  {
    day: '2026-08-05',
    pledgeCount: 1,
    amount: { amount: '50.00', currency: 'AZN' },
    cumulativePledgeCount: 3,
    cumulativeAmount: { amount: '150.00', currency: 'AZN' },
  },
];

/*
 * The words, built from `messages/en.json` with the builder the route calls — #79.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = fundingChartsCopyFrom(translatorFor('dashboard'));

function renderCharts(overrides: Partial<Parameters<typeof FundingCharts>[0]> = {}) {
  return render(
    <FundingCharts
      projectId="campaign-1"
      loadTrend={vi.fn().mockResolvedValue(trend())}
      loadBreakdown={vi.fn().mockResolvedValue(breakdown())}
      nowImpl={() => new Date('2026-08-18T09:04:00.000Z')}
      copy={COPY}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the trend', () => {
  it('shows the running total and every day behind it', async () => {
    renderCharts({ loadTrend: vi.fn().mockResolvedValue(trend({ days: DAYS })) });

    expect(await screen.findByText('150.00 AZN by 2026-08-05')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Show the daily figures'));
    const table = within(screen.getByRole('region', { name: 'Daily funding figures' })).getByRole(
      'table',
    );
    // Two rows and not five: the series is sparse, and the running total on each row is
    // what makes the gaps harmless.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    // The first day's takings and its running total are the same figure, so it appears
    // twice — which is the point of carrying both columns.
    expect(within(table).getAllByText('100.00 AZN')).toHaveLength(2);
    expect(within(table).getByText('50.00 AZN')).toBeInTheDocument();
  });

  it('says when the figures were aggregated, so a stalled job is not read as a quiet week', async () => {
    renderCharts({ loadTrend: vi.fn().mockResolvedValue(trend({ days: DAYS })) });

    expect(await screen.findByText(/Aggregated/)).toHaveTextContent(/4 minutes ago/);
  });

  it('says a quiet range is quiet rather than drawing an empty chart', async () => {
    renderCharts();

    expect(await screen.findByText(/Nothing has been pledged between/)).toBeInTheDocument();
  });
});

describe('the splits', () => {
  it('lists tiers and destinations with their counts and totals', async () => {
    const loadBreakdown = vi.fn().mockResolvedValue(
      breakdown({
        currency: 'AZN',
        backerCount: 3,
        total: { amount: '150.00', currency: 'AZN' },
        rewards: [
          {
            rewardTierId: 'tier-1',
            title: 'An early copy',
            price: { amount: '25.00', currency: 'AZN' },
            backerCount: 2,
            amount: { amount: '100.00', currency: 'AZN' },
          },
        ],
        countries: [
          { country: 'DE', backerCount: 1, amount: { amount: '80.00', currency: 'AZN' } },
          { backerCount: 2, amount: { amount: '70.00', currency: 'AZN' } },
        ],
      }),
    );
    renderCharts({ loadBreakdown });

    const rewards = await screen.findByRole('list', { name: 'Backers by reward tier' });
    expect(within(rewards).getByText('An early copy')).toBeInTheDocument();
    expect(within(rewards).getByText(/2 backers/)).toBeInTheDocument();

    const destinations = screen.getByRole('list', { name: 'Backers by destination' });
    expect(within(destinations).getByText('DE')).toBeInTheDocument();
    // The pledges that named nowhere are a group rather than a gap: a chart whose parts do
    // not add up to the total above it is one somebody has to reconcile by hand.
    expect(within(destinations).getByText('No destination')).toBeInTheDocument();
  });

  it('says why the tiers can add up to less than the campaign', async () => {
    const loadBreakdown = vi.fn().mockResolvedValue(
      breakdown({
        backerCount: 1,
        total: { amount: '40.00', currency: 'AZN' },
        rewards: [
          {
            rewardTierId: 'tier-1',
            title: 'An early copy',
            backerCount: 1,
            amount: { amount: '25.00', currency: 'AZN' },
          },
        ],
        countries: [{ backerCount: 1, amount: { amount: '40.00', currency: 'AZN' } }],
      }),
    );
    renderCharts({ loadBreakdown });

    expect(await screen.findByText(/add up to less than the total above/)).toBeInTheDocument();
  });

  it('keeps the trend on screen when only the breakdown fails', async () => {
    renderCharts({
      loadTrend: vi.fn().mockResolvedValue(trend({ days: DAYS })),
      loadBreakdown: vi.fn().mockRejectedValue(new ApiError(500, null)),
    });

    // Half a dashboard beats an error page, and the two reads fail for different reasons.
    expect(await screen.findByText('150.00 AZN by 2026-08-05')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/backer breakdown could not be loaded/);
  });
});
