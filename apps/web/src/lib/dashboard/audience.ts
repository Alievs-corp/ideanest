import type { components } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';

/**
 * The dashboard's audience read — `GET /v1/projects/{id}/audience?period=`, #634.
 *
 * <h2>What the numbers are</h2>
 *
 * People, per Asia/Baku day (#633). `views` is how many people opened the campaign page that
 * day, `clicks` how many followed its card from a listing; a person counts once per campaign per
 * day for each. A week's figure is seven days' people added up — somebody who came back on three
 * days is three — which the panel says under the chart in `common.audience.dailySumNote`.
 *
 * <h2>The window is whole buckets</h2>
 *
 * `day` is twenty-four hours from Baku midnight, the hours still to come included at zero;
 * `week` and `month` are seven and thirty days ending today; `year` is twelve calendar months
 * ending with this one. Every bucket is in `series`, zero-filled by the service, so the chart can
 * place them by position and a quiet hour is a visible gap rather than a missing column.
 */

type ContractAudience = components['schemas']['ProjectAudienceResponse'];

export type AudiencePeriod = NonNullable<ContractAudience['period']>;
export type AudienceBucket = NonNullable<ContractAudience['bucket']>;
export type AudienceSurfaceName = NonNullable<
  NonNullable<ContractAudience['surfaces']>[number]['surface']
>;

/** The filter's four positions, in the order the control draws them. */
export const AUDIENCE_PERIODS: readonly AudiencePeriod[] = ['day', 'week', 'month', 'year'];

/** The zone every bucket is cut in. The service's, and stated on screen. */
export const AUDIENCE_ZONE = 'Asia/Baku';

export interface AudiencePoint {
  /** The bucket's first instant, ISO-8601. */
  readonly start: string;
  readonly views: number;
  readonly clicks: number;
}

export interface AudienceCountry {
  /** ISO 3166-1 alpha-2, or `ZZ` for a visitor the service could not place. */
  readonly country: string;
  readonly views: number;
  readonly clicks: number;
}

export interface AudienceSurfaceClicks {
  readonly surface: AudienceSurfaceName;
  readonly clicks: number;
}

export interface ProjectAudience {
  readonly period: AudiencePeriod;
  readonly bucket: AudienceBucket;
  readonly allTimeViews: number;
  readonly totals: { readonly views: number; readonly clicks: number };
  readonly series: readonly AudiencePoint[];
  readonly countries: readonly AudienceCountry[];
  readonly surfaces: readonly AudienceSurfaceClicks[];
}

/** The country code the service writes for a visitor it could not place. */
export const UNKNOWN_COUNTRY = 'ZZ';

function whole(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The body, with every absent field read as nothing. The service serialises `non_null`, so an
 * empty list may be missing rather than `[]`; a missing count is zero, not `undefined` in a sum.
 */
export function readProjectAudience(body: ContractAudience, asked: AudiencePeriod): ProjectAudience {
  return {
    period: body.period ?? asked,
    bucket: body.bucket ?? (asked === 'day' ? 'HOUR' : asked === 'year' ? 'MONTH' : 'DAY'),
    allTimeViews: whole(body.allTimeViews),
    totals: { views: whole(body.totals?.views), clicks: whole(body.totals?.clicks) },
    series: (body.series ?? [])
      .filter((point): point is typeof point & { start: string } => typeof point.start === 'string')
      .map((point) => ({ start: point.start, views: whole(point.views), clicks: whole(point.clicks) })),
    countries: (body.countries ?? []).map((row) => ({
      country: row.country ?? UNKNOWN_COUNTRY,
      views: whole(row.views),
      clicks: whole(row.clicks),
    })),
    surfaces: (body.surfaces ?? [])
      .filter((row): row is typeof row & { surface: AudienceSurfaceName } => row.surface !== undefined)
      .map((row) => ({ surface: row.surface, clicks: whole(row.clicks) })),
  };
}

/**
 * One campaign's audience for a period.
 *
 * @throws ApiError on any refusal — 401 signed out, 403 a collaborator without
 *   `VIEW_FINANCES`, 404 a campaign that is not theirs
 */
export async function getProjectAudience(
  projectId: string,
  period: AudiencePeriod,
  signal?: AbortSignal,
): Promise<ProjectAudience> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/audience?period=${period}`,
    // The service's own `private, no-store`: one creator's audience, as it is now.
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return readProjectAudience((await response.json()) as ContractAudience, period);
}

const BUCKET_FORMAT: Readonly<Record<AudienceBucket, Intl.DateTimeFormatOptions>> = {
  HOUR: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: AUDIENCE_ZONE },
  DAY: { day: 'numeric', month: 'short', timeZone: AUDIENCE_ZONE },
  MONTH: { month: 'short', year: 'numeric', timeZone: AUDIENCE_ZONE },
};

/**
 * A bucket's name in the reader's language, read in Baku: `14:00`, `7 Nov`, `Nov 2026`.
 *
 * In Baku and not in the reader's zone, because the bucket was cut there: the service's Tuesday
 * starts at Baku midnight, and the same instant read in London is Monday evening.
 */
export function bucketLabel(start: string, bucket: AudienceBucket, locale: Locale): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return start;
  return dateTimeFormat(locale, BUCKET_FORMAT[bucket], `audience-${bucket}`).format(at);
}

/** The calendar day a bucket starts on, in Baku — what the hourly chart's caption names. */
export function bucketDay(start: string, locale: Locale): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return start;
  return dateTimeFormat(
    locale,
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: AUDIENCE_ZONE },
    'audience-day-caption',
  ).format(at);
}

/**
 * Each bar's width as a whole percentage of the largest, floored at two so a single visitor is a
 * mark rather than nothing — `shareWidths` in `@ideanest/dashboard/analytics`, for counts.
 */
export function countWidths(counts: readonly number[]): readonly number[] {
  const largest = counts.reduce((widest, value) => Math.max(widest, value), 0);
  if (largest <= 0) return counts.map(() => 0);
  return counts.map((value) => (value <= 0 ? 0 : Math.max(2, Math.round((value / largest) * 100))));
}
