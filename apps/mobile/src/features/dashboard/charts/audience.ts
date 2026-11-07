import { useQuery } from '@tanstack/react-query';
import type { components } from '@ideanest/api-client';
import { api } from '../../../api/client';
import { queryKeys } from '../../../api/queries';
import type { AudienceSurface } from '../../audience/send';

/**
 * The campaign's audience, as the Charts tab draws it — `GET /v1/projects/{id}/audience` (#636).
 *
 * <p>Every field of the contract is optional, so the body is narrowed once here: a missing count is
 * zero, a missing list is empty, and a country the service could not place is `ZZ`. The series is
 * drawn as it came — the service zero-fills every bucket of the window, so a quiet hour is a zero
 * column, not a gap.
 */

type Wire = components['schemas']['ProjectAudienceResponse'];

export type AudiencePeriod = NonNullable<Wire['period']>;
export type AudienceBucket = NonNullable<Wire['bucket']>;

/** The four windows, in the order the filter offers them (`common.audience.period.*`). */
export const AUDIENCE_PERIODS: readonly AudiencePeriod[] = ['day', 'week', 'month', 'year'];

/** The country the service stores when it cannot place a reader. */
export const UNKNOWN_COUNTRY = 'ZZ';

export interface AudiencePoint {
  /** ISO instant the bucket starts at. */
  readonly start: string;
  readonly views: number;
  readonly clicks: number;
}

export interface Audience {
  readonly period: AudiencePeriod;
  readonly bucket: AudienceBucket;
  readonly timeZone: string;
  readonly allTimeViews: number;
  readonly views: number;
  readonly clicks: number;
  readonly series: readonly AudiencePoint[];
  readonly countries: readonly { readonly country: string; readonly views: number; readonly clicks: number }[];
  readonly surfaces: readonly { readonly surface: AudienceSurface; readonly clicks: number }[];
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const BUCKETS: Record<AudiencePeriod, AudienceBucket> = { day: 'HOUR', week: 'DAY', month: 'DAY', year: 'MONTH' };

export function readAudience(body: Wire, asked: AudiencePeriod): Audience {
  const period = body.period ?? asked;
  return {
    period,
    bucket: body.bucket ?? BUCKETS[period],
    timeZone: body.timeZone ?? 'Asia/Baku',
    allTimeViews: count(body.allTimeViews),
    views: count(body.totals?.views),
    clicks: count(body.totals?.clicks),
    series: (body.series ?? [])
      .filter((point) => typeof point.start === 'string' && point.start !== '')
      .map((point) => ({ start: point.start ?? '', views: count(point.views), clicks: count(point.clicks) })),
    countries: (body.countries ?? []).map((row) => ({
      country: typeof row.country === 'string' && /^[A-Z]{2}$/.test(row.country) ? row.country : UNKNOWN_COUNTRY,
      views: count(row.views),
      clicks: count(row.clicks),
    })),
    surfaces: (body.surfaces ?? []).map((row) => ({ surface: row.surface ?? 'OTHER', clicks: count(row.clicks) })),
  };
}

/** One period's audience. Its own cache entry per period, so switching back is instant. */
export function useAudience(projectId: string, period: AudiencePeriod) {
  return useQuery({
    queryKey: queryKeys.dashboardAudience(projectId, period),
    enabled: projectId !== '',
    queryFn: async ({ signal }): Promise<Audience> =>
      readAudience(
        await api().get('/v1/projects/{projectId}/audience', { path: { projectId }, query: { period }, signal }),
        period,
      ),
  });
}

/**
 * Bar widths for counts, relative to the largest — `shareWidths`' rule (two percent floor so a row
 * is never an empty track) for figures that are counts rather than money.
 */
export function countWidths(counts: readonly number[]): readonly number[] {
  const largest = counts.reduce((widest, value) => Math.max(widest, value), 0);
  if (largest <= 0) return counts.map(() => 0);
  return counts.map((value) => Math.max(2, Math.round((value / largest) * 100)));
}
