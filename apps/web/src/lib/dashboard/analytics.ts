import type { components } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { readTrend, type Trend } from '@ideanest/dashboard/analytics';

/**
 * §4.7's CD-02: the funding trend's fetch. What the trend is, how it is read and how it is drawn
 * are `@ideanest/dashboard/analytics`, shared with the app (#163).
 */

type ContractAnalytics = components['schemas']['ProjectAnalyticsResponse'];

/**
 * One campaign's daily trend.
 *
 * Asks for no range, which the service reads as the last thirty days — a campaign's median
 * life on this platform, and what the chart draws.
 *
 * @throws ApiError on any refusal
 */
export async function getTrend(projectId: string, signal?: AbortSignal): Promise<Trend> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/analytics`, {
    // Matching the service's own `no-store`: a campaign's daily takings belong to the
    // account that asked for them.
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return readTrend((await response.json()) as ContractAnalytics);
}
