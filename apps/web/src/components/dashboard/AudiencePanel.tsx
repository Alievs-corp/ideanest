'use client';

import { useEffect, useState } from 'react';
import { InlineAlert, Pill, Skeleton, SkeletonGroup, StatBlock, StatRow } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  AUDIENCE_PERIODS,
  UNKNOWN_COUNTRY,
  bucketDay,
  bucketLabel,
  countWidths,
  getProjectAudience,
  type AudiencePeriod,
  type ProjectAudience,
} from '../../lib/dashboard/audience';
import { numberFormat, regionNames } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import type { AudienceCopy } from '../../lib/i18n/dashboard-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { AudienceChart } from './AudienceChart';

/**
 * #634: who opened this campaign, who clicked its card, and where they are — the audience
 * section under the funding charts.
 *
 * <h2>One read per period</h2>
 *
 * `GET /v1/projects/{id}/audience?period=` answers one window at a time, and the control above
 * the figures picks it: today by the hour, the last seven or thirty days by the day, the last
 * twelve months by the month. Switching aborts the read in flight, so a slow week cannot land on
 * top of the year that was asked for after it. While a read is pending the previous figures are
 * not drawn: last period's numbers beside this period's selected button would be a lie.
 *
 * <h2>Its own failures</h2>
 *
 * Like the two reads above it, this one fails on its own. A creator whose audience read is
 * refused still has their funding charts, and the refusal is worded for this read — the
 * collaborator grant it needs is `VIEW_FINANCES`, the same as the trend's.
 *
 * <h2>Counts, not money</h2>
 *
 * Every figure here is a whole number of people-days, so there is no `decimal.js` on this
 * screen and nothing to format as an amount.
 */

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly audience: ProjectAudience };

function messageFor(cause: unknown, copy: AudienceCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.failures.signedOut;
    if (cause.status === 403) return copy.notGranted;
    if (cause.status === 404) return copy.failures.noCampaign;
  }
  return copy.unavailable;
}

export interface AudiencePanelProps {
  readonly projectId: string;
  readonly copy: AudienceCopy;
  /** Injected by tests. Defaults to the real reader. */
  readonly loadAudience?: typeof getProjectAudience;
}

export function AudiencePanel({ projectId, copy, loadAudience }: AudiencePanelProps) {
  const locale = useRouteLocale();
  const [period, setPeriod] = useState<AudiencePeriod>('day');
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    (loadAudience ?? getProjectAudience)(projectId, period, controller.signal)
      .then((audience) => {
        if (!controller.signal.aborted) setState({ status: 'ready', audience });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'failed', message: messageFor(cause, copy) });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, period]);

  const whole = numberFormat(locale, { maximumFractionDigits: 0 }, 'whole');

  return (
    <section aria-labelledby="audience-heading" className="mt-12">
      <h2 id="audience-heading" className="text-lg font-semibold text-fg">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.intro}</p>

      <div role="group" aria-label={copy.periodLabel} className="mt-4 flex flex-wrap items-center gap-2">
        {AUDIENCE_PERIODS.map((option) => (
          <Pill
            key={option}
            variant={period === option ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={period === option}
            onClick={() => setPeriod(option)}
          >
            {copy.periods[option] ?? option}
          </Pill>
        ))}
      </div>

      {state.status === 'loading' ? (
        <SkeletonGroup label={copy.loading}>
          <Skeleton height="4rem" className="mt-4" />
          <Skeleton height="200px" className="mt-4" />
        </SkeletonGroup>
      ) : null}

      {state.status === 'failed' ? (
        <InlineAlert variant="danger" className="mt-4">
          {state.message}
        </InlineAlert>
      ) : null}

      {state.status === 'ready' ? (
        <AudienceFigures audience={state.audience} copy={copy} locale={locale} format={whole.format} />
      ) : null}
    </section>
  );
}

function AudienceFigures({
  audience,
  copy,
  locale,
  format,
}: {
  readonly audience: ProjectAudience;
  readonly copy: AudienceCopy;
  readonly locale: Locale;
  readonly format: (value: number) => string;
}) {
  const { totals, series, bucket } = audience;
  const quiet = totals.views === 0 && totals.clicks === 0;

  return (
    <>
      <StatRow className="mt-4">
        <StatBlock label={copy.views} value={format(totals.views)} />
        <StatBlock label={copy.clicks} value={format(totals.clicks)} />
        <StatBlock label={copy.allTimeViews} value={format(audience.allTimeViews)} />
      </StatRow>

      {quiet ? (
        <p className="mt-4 max-w-[62ch] text-sm text-fg-64">{copy.empty}</p>
      ) : (
        <>
          <AudienceChart
            series={series}
            bucket={bucket}
            label={seriesLabel(audience, copy, locale)}
            locale={locale}
            copy={copy}
          />

          <h3 className="mt-8 text-sm font-semibold text-fg">{copy.countries}</h3>
          <CountBars
            label={copy.countriesLabel}
            rows={audience.countries.map((row) => ({
              key: row.country,
              label: countryLabel(row.country, copy.unknownCountry, locale),
              value: row.views,
              detail: `${pluralise(locale, copy.viewsCount, row.views)} · ${pluralise(locale, copy.clicksCount, row.clicks)}`,
            }))}
          />

          <h3 className="mt-8 text-sm font-semibold text-fg">{copy.surfacesHeading}</h3>
          {audience.surfaces.length === 0 ? (
            <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.surfacesEmpty}</p>
          ) : (
            <CountBars
              label={copy.surfacesLabel}
              rows={audience.surfaces.map((row) => ({
                key: row.surface,
                label: copy.surfaces[row.surface] ?? row.surface,
                value: row.clicks,
                detail: pluralise(locale, copy.clicksCount, row.clicks),
              }))}
            />
          )}
          <p className="mt-3 max-w-[62ch] text-sm text-fg-64">{copy.clickNote}</p>
        </>
      )}

      {/*
        Said rather than left to be found out. A week's views are seven days' people added up,
        and somebody adding the days of a month to compare it with a "visitors" figure elsewhere
        deserves to know why the two differ.
      */}
      <p className="mt-6 max-w-[62ch] text-sm text-fg-64">
        {copy.dailySumNote} {copy.zoneNote}
      </p>
    </>
  );
}

/** The chart's name, in the window's own unit: "today by the hour", or "from … to …". */
function seriesLabel(audience: ProjectAudience, copy: AudienceCopy, locale: Locale): string {
  const first = audience.series[0];
  const last = audience.series[audience.series.length - 1];
  if (first === undefined || last === undefined) return copy.heading;
  if (audience.bucket === 'HOUR') return fillPlaceholders(copy.seriesHour, { day: bucketDay(first.start, locale) });

  const template = audience.bucket === 'MONTH' ? copy.seriesMonth : copy.seriesDay;
  return fillPlaceholders(template, {
    from: bucketLabel(first.start, audience.bucket, locale),
    to: bucketLabel(last.start, audience.bucket, locale),
  });
}

/**
 * A country in the reader's language — `regionNames`, as the destinations above are named.
 * `ZZ` is the service's "could not place this visitor", which is a word and not a region.
 */
function countryLabel(code: string, unknown: string, locale: Locale): string {
  if (code === UNKNOWN_COUNTRY) return unknown;
  return regionNames(locale)?.of(code) ?? code;
}

interface CountBar {
  readonly key: string;
  readonly label: string;
  /** What the bar's length is drawn from. */
  readonly value: number;
  /** The row's figures as words — the accessible statement of the row. */
  readonly detail: string;
}

/**
 * `ShareBars` for counts: one row per country or listing, the label and the figures as text and
 * the bar `aria-hidden` beside them, relative to the largest row. Same colour, same reasons.
 */
function CountBars({ rows, label }: { readonly rows: readonly CountBar[]; readonly label: string }) {
  const widths = countWidths(rows.map((row) => row.value));

  return (
    <ul aria-label={label} className="mt-4 space-y-3">
      {rows.map((row, index) => (
        <li key={row.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-fg">{row.label}</span>
            <span className="tabular-nums text-fg-64">{row.detail}</span>
          </div>
          <div aria-hidden className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-fg" style={{ width: `${widths[index] ?? 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
