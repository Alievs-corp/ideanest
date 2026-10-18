import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * §4.11's AD-13: the platform's own figures — issue #313.
 *
 * <h2>Not the campaign dashboard</h2>
 *
 * `/v1/projects/{id}/analytics` is #95's and answers a creator asking about their own
 * campaign. This answers the platform's question with the same nouns.
 *
 * <h2>One population</h2>
 *
 * Volume, count, average, backers and the daily series all count the same pledges: collected in
 * the window and still collected — a refunded or charged-back pledge is in none of them, and a
 * settled partial refund comes off its pledge.
 *
 * <h2>What it does not answer, and says so</h2>
 *
 * AD-13 lists "volume, success rate, average pledge, cohorts, funnels". The first three are
 * here. Cohorts and funnels are not, and `notBuilt` carries the reason from the service so
 * the screen renders it rather than hard-coding a sentence that would go stale. Approximating
 * them would put two numbers on a dashboard that look like cohorts and funnels and are not.
 */

export interface PlatformTotals {
  /** Pledges collected in the window that still stand. */
  pledgeCount: number;
  volume: Money;
  /** Divided by the service, on BigDecimal — dividing money in a browser is how a total drifts. */
  averagePledge: Money;
  /** Distinct accounts. Not the same as `pledgeCount`, and conflating them overstates reach. */
  backerCount: number;
  /**
   * Campaigns running at the moment of reading — live, in their closing window, or extended. A
   * count of now, not of the window: the front page's "running".
   */
  liveProjects: number;
  /**
   * Pledges left out of `volume` because they were in another currency.
   *
   * Reported rather than dropped: §21.2 gives nothing to convert with, and a total with a
   * silent exclusion is worse than one with a stated gap.
   */
  otherCurrencyPledges: number;
  /** What creators paid for plans in the window, net of reversals — the platform's own income. */
  planRevenue: Money;
  planPayments: number;
}

/** One day of the window. The service sends every day, with zeros where nothing was collected. */
export interface PlatformDailyPoint {
  day: string;
  pledgeCount: number;
  volume: Money;
}

export interface PlatformOutcomes {
  succeeded: number;
  failed: number;
  /**
   * The fraction, or absent when no campaign was decided in the window. Decided means the
   * transition to successful or unsuccessful, which comes a closing window after the deadline.
   *
   * Null rather than zero: "no campaigns closed" and "none of them succeeded" are different
   * facts, and a zero on a dashboard reads as the second.
   */
  successRate?: number | null;
}

export interface PlatformAnalytics {
  from: string;
  to: string;
  /** When this was read. A stale tab is not a live figure. */
  computedAt: string;
  totals: PlatformTotals;
  daily: PlatformDailyPoint[];
  outcomes: PlatformOutcomes;
  /** What AD-13 asks for and this screen does not answer, in the service's words. */
  notBuilt: string[];
}

/** Volume, success rate and average pledge over a window. */
export async function readPlatformAnalytics(
  from: string | null,
  to: string | null,
  signal?: AbortSignal,
): Promise<PlatformAnalytics> {
  const parameters = new URLSearchParams();
  if (from != null) parameters.set('from', from);
  if (to != null) parameters.set('to', to);

  const query = parameters.toString();
  const response = await authorizedFetch(`/v1/admin/analytics${query === '' ? '' : `?${query}`}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PlatformAnalytics;
}
