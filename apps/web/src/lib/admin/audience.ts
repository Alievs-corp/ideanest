import type { components } from '@ideanest/api-client/schema';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import { BAKU_ZONE } from './baku-calendar';

/**
 * Who came to the platform and what they looked at — issue #635, epic #632.
 *
 * <h2>People, per Baku day, and the screen has to say so</h2>
 *
 * The service counts a visitor once per Baku day under a salt it throws away the next day, so
 * a week's "visitors" is seven daily counts added up: somebody who came on Monday and on
 * Tuesday is two. That is the price of counting without a cookie, and `dailySumNote` is the
 * sentence the screen prints beside the figure so nobody reads it as distinct people.
 *
 * <h2>The service picks the buckets</h2>
 *
 * `period` decides the window and the window decides the bucket: 24 hours for a day, seven or
 * thirty days, twelve months. Every bucket arrives, zeros included, so the screen draws what it
 * was given rather than computing a calendar of its own — the one thing it still does in the
 * browser is name each bucket in Baku's clock, which is {@link bucketLabel}.
 */

export type AudiencePeriod = 'day' | 'week' | 'month' | 'year';
export type AudienceBucket = 'HOUR' | 'DAY' | 'MONTH';
export type AudiencePlatform = NonNullable<components['schemas']['AudiencePlatformVisitors']['platform']>;
export type AudienceSurface = NonNullable<components['schemas']['ProjectAudienceSurface']['surface']>;

/** In the order the control draws them, which is the order the service documents them. */
export const AUDIENCE_PERIODS: readonly AudiencePeriod[] = ['day', 'week', 'month', 'year'];

/** The country code the service stores when neither Cloudflare nor the GeoIP file knew. */
export const UNKNOWN_COUNTRY = 'ZZ';

export interface PlatformAudiencePoint {
  /** The bucket's first instant. */
  readonly start: string;
  readonly visitors: number;
  readonly pageViews: number;
  readonly campaignViews: number;
  readonly campaignClicks: number;
}

export interface AudienceTopCampaign {
  readonly projectId: string;
  readonly title: string;
  /** Omitted by the service when it has none, as every null is. */
  readonly slug?: string | null;
  readonly creatorSlug?: string | null;
  readonly views: number;
  readonly clicks: number;
}

export interface PlatformAudience {
  readonly period: AudiencePeriod;
  /** The first bucket's start. */
  readonly from: string;
  /** The last bucket's end, exclusive: `day` runs to tomorrow's midnight, future hours at nought. */
  readonly to: string;
  readonly timeZone: string;
  readonly bucket: AudienceBucket;
  readonly computedAt: string;
  readonly totals: {
    readonly visitors: number;
    readonly pageViews: number;
    readonly campaignViews: number;
    readonly campaignClicks: number;
  };
  readonly series: readonly PlatformAudiencePoint[];
  /** Site visitors by country, most first, `ZZ` included. */
  readonly countries: readonly { readonly country: string; readonly visitors: number }[];
  readonly platforms: readonly { readonly platform: AudiencePlatform; readonly visitors: number }[];
  /** The twenty campaigns viewed most in the window. */
  readonly topCampaigns: readonly AudienceTopCampaign[];
}

export interface CampaignAudience {
  readonly period: AudiencePeriod;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly bucket: AudienceBucket;
  readonly computedAt: string;
  /** `projects.view_count`: every daily viewer since the campaign went public. */
  readonly allTimeViews: number;
  readonly totals: { readonly views: number; readonly clicks: number };
  readonly series: readonly { readonly start: string; readonly views: number; readonly clicks: number }[];
  readonly countries: readonly { readonly country: string; readonly views: number; readonly clicks: number }[];
  readonly surfaces: readonly { readonly surface: AudienceSurface; readonly clicks: number }[];
  readonly platforms: readonly { readonly platform: AudiencePlatform; readonly views: number }[];
}

/** The platform's audience over one period. `VIEW_AUDIENCE`, and the read is audited. */
export async function readPlatformAudience(period: AudiencePeriod, signal?: AbortSignal): Promise<PlatformAudience> {
  const response = await authorizedFetch(`/v1/admin/audience?period=${encodeURIComponent(period)}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PlatformAudience;
}

/** One campaign's audience over one period, for the row a reader opened. Also audited. */
export async function readCampaignAudience(
  projectId: string,
  period: AudiencePeriod,
  signal?: AbortSignal,
): Promise<CampaignAudience> {
  const response = await authorizedFetch(
    `/v1/admin/audience/projects/${encodeURIComponent(projectId)}?period=${encodeURIComponent(period)}`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as CampaignAudience;
}

/**
 * The campaign's public page, or null when the service sent no address for it.
 *
 * <p>§10.2's `/projects/{creatorSlug}/{projectSlug}`, without the locale: the caller adds it.
 */
export function campaignPath(campaign: Pick<AudienceTopCampaign, 'creatorSlug' | 'slug'>): string | null {
  if (campaign.creatorSlug == null || campaign.creatorSlug === '' || campaign.slug == null || campaign.slug === '') {
    return null;
  }
  return `/projects/${encodeURIComponent(campaign.creatorSlug)}/${encodeURIComponent(campaign.slug)}`;
}

/**
 * Clicks for every view, or null when nothing was viewed.
 *
 * <p>Null rather than nought: "nobody saw it" and "everybody who saw it scrolled past" are
 * different facts. It can exceed one — a card click is counted where it happens and a view where
 * the page opens, and a reader who clicked through a card the page then failed to load for is a
 * click with no view.
 */
export function clickRatio(views: number, clicks: number): number | null {
  return views > 0 ? clicks / views : null;
}

/** A country code in the reader's language, `ZZ` as the catalogue's "Unknown". */
export function countryLabel(code: string, display: Intl.DisplayNames | null, unknown: string): string {
  if (code === UNKNOWN_COUNTRY || code === '') return unknown;
  if (display === null) return code;
  try {
    return display.of(code) ?? code;
  } catch {
    // `of` throws on anything that is not a well-formed region code; the code itself is readable.
    return code;
  }
}

/** A part of a whole, for a share bar. Nought when the whole is. */
export function shareOf(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

/**
 * A y-axis for counts: a whole-number step of 1, 2 or 5 times a power of ten, at most five gaps.
 *
 * <p>Not `chart-series`' `niceScale`, which is for money and may choose 2.5 — a scale reading
 * "2.5 visitors" is a scale for something else.
 */
export function countScale(peak: number): { readonly max: number; readonly ticks: readonly number[] } {
  if (!(peak > 0)) return { max: 1, ticks: [0, 1] };

  let step = 1;
  for (let magnitude = 1; ; magnitude *= 10) {
    const found = [1, 2, 5].map((nice) => nice * magnitude).find((candidate) => Math.ceil(peak / candidate) <= 5);
    if (found !== undefined) {
      step = found;
      break;
    }
  }

  const gaps = Math.max(1, Math.ceil(peak / step));
  const ticks = Array.from({ length: gaps + 1 }, (_, index) => index * step);
  return { max: gaps * step, ticks };
}

/**
 * What one bucket is called, in Baku's clock and the reader's language.
 *
 * <p>`short` is the axis: `14:00`, `7 Nov`, `Nov` (with the year where the axis starts and at
 * every January, so a year that starts and ends in November does not read as one November
 * twice). `long` is the tooltip and the table: `7 Nov 2026, 14:00`, `7 Nov 2026`, `November 2026`.
 */
export function bucketLabel(
  start: string,
  bucket: AudienceBucket,
  locale: Locale,
  form: 'short' | 'long',
  first = false,
): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return start;

  const zone = { timeZone: BAKU_ZONE } as const;
  if (bucket === 'HOUR') {
    const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    return form === 'short'
      ? dateTimeFormat(locale, { ...clock, ...zone }, 'audience-hour').format(at)
      : dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', ...zone }, 'audience-hour-long').format(at);
  }
  if (bucket === 'DAY') {
    return form === 'short'
      ? dateTimeFormat(locale, { day: 'numeric', month: 'short', ...zone }, 'audience-day').format(at)
      : dateTimeFormat(locale, { dateStyle: 'medium', ...zone }, 'audience-day-long').format(at);
  }
  if (form === 'long') {
    return dateTimeFormat(locale, { month: 'long', year: 'numeric', ...zone }, 'audience-month-long').format(at);
  }
  // The month as a number in a fixed language, because only the comparison is wanted here.
  const january = dateTimeFormat('en', { month: 'numeric', ...zone }, 'audience-month-number').format(at) === '1';
  return first || january
    ? dateTimeFormat(locale, { month: 'short', year: 'numeric', ...zone }, 'audience-month-year').format(at)
    : dateTimeFormat(locale, { month: 'short', ...zone }, 'audience-month').format(at);
}

/**
 * The window as a reader names it: one day, or the first and last day (or month) in it.
 *
 * <p>`to` is exclusive, so the last day is the one a millisecond before it.
 */
export function windowDates(
  from: string,
  to: string,
  bucket: AudienceBucket,
  locale: Locale,
): { readonly first: string; readonly last: string } {
  const start = new Date(from);
  const end = new Date(new Date(to).getTime() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { first: from, last: to };

  const format =
    bucket === 'MONTH'
      ? dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: BAKU_ZONE }, 'audience-month-long')
      : dateTimeFormat(locale, { dateStyle: 'medium', timeZone: BAKU_ZONE }, 'audience-day-long');
  return { first: format.format(start), last: format.format(end) };
}
