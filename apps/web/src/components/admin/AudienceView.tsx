'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import {
  AUDIENCE_PERIODS,
  campaignPath,
  clickRatio,
  countryLabel,
  readCampaignAudience,
  readPlatformAudience,
  shareOf,
  windowDates,
  type AudienceBucket,
  type AudiencePeriod,
  type AudienceTopCampaign,
} from '../../lib/admin/audience';
import { bakuDateTime } from '../../lib/admin/console-dates';
import { formatCount, formatShare } from '../../lib/admin/console-numbers';
import { localeHref } from '../../i18n/navigation';
import { regionNames } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AudienceCopy } from '../../lib/i18n/admin/platform-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { AudienceChart } from './AudienceChart';
import { FigureGrid, FigureTile, NoFigure } from './ConsoleFigures';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * Who came to the platform and what they looked at — issue #635, epic #632.
 *
 * <h2>One period at a time, and the service names its buckets</h2>
 *
 * <p>Daily, weekly, monthly, yearly: today by the hour, the last seven or thirty days by the
 * day, the last twelve months by the month — every bucket sent, zeros included. Daily is the
 * default because "how is today going" is the question somebody opens this screen with.
 *
 * <h2>Visitors are summed days, and the screen says so</h2>
 *
 * <p>The service counts a visitor once per Baku day without a cookie, so a week's visitors is
 * seven daily counts added up. Over a single day that is the same as distinct people, so the
 * note appears only for the longer periods, where it changes what the number means.
 *
 * <h2>A campaign opens in place, not in a dialog</h2>
 *
 * <p>The row expands under itself into the campaign's own series, countries, surfaces and
 * platforms, read from the per-campaign endpoint only when somebody asks. A `Modal` would have
 * cost the route about 120 KiB of motion code for one disclosure; a button with
 * `aria-expanded` and a row beneath it is the same interaction with nothing to load.
 *
 * <h2>CSS, not a charting library</h2>
 *
 * <p>For the reason `PlatformAnalyticsView` gives: a library in this graph lands in every console
 * route's shared chunk. The bars below are divs sized by percentage, and every one of them has
 * its figure beside it as text, because length must not carry meaning alone any more than colour.
 */
export interface AudienceViewProps {
  readonly copy: AudienceCopy;
}

/** How many countries are listed before the rest fold under "Show every country". */
const COUNTRIES_SHOWN = 10;

export function AudienceView({ copy }: AudienceViewProps) {
  const [period, setPeriod] = useState<AudiencePeriod>('day');
  const [opened, setOpened] = useState<string | null>(null);
  const locale = useRouteLocale();
  const display = useMemo(() => regionNames(locale), [locale]);

  const audience = useConsoleResource(
    (signal) => readPlatformAudience(period, signal),
    copy.subject,
    copy.refusals,
    [period],
  );

  if (audience.status === 'signed-out' || audience.status === 'forbidden') {
    return <ConsoleRefusal status={audience.status} capability={audience.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  // Only while the read is current: a pending or failed reload keeps the previous answer in
  // `data`, and drawing it under the new period's button would be the last period's figures.
  const data = audience.status === 'ready' ? audience.data : null;
  const range = data === null ? null : windowDates(data.from, data.to, data.bucket, locale);
  const nothing =
    data !== null &&
    data.totals.visitors === 0 &&
    data.totals.pageViews === 0 &&
    data.totals.campaignViews === 0 &&
    data.totals.campaignClicks === 0;

  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label={copy.periodLegend} className="flex flex-wrap items-center gap-2">
        {AUDIENCE_PERIODS.map((choice) => (
          <Pill
            key={choice}
            variant={period === choice ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={period === choice}
            onClick={() => setPeriod(choice)}
          >
            {copy.periods[choice]}
          </Pill>
        ))}
      </div>

      {audience.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList}>
          <Skeleton height="1rem" width="40%" />
          <Skeleton height="6rem" width="100%" className="mt-4" />
        </SkeletonGroup>
      )}

      {audience.status === 'failed' && (
        <div className="flex flex-col items-start gap-3">
          <InlineAlert variant="danger" title={copy.errorTitle} className="w-full">
            {audience.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" onClick={audience.reload}>
            {copy.tryAgain}
          </Pill>
        </div>
      )}

      {data !== null && range !== null && (
        <>
          <section aria-labelledby="audience-totals-heading">
            <h2 id="audience-totals-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
              {range.first === range.last ? range.first : fillPlaceholders(copy.range, { from: range.first, to: range.last })}
            </h2>

            <FigureGrid className="mt-4 lg:grid-cols-4">
              <FigureTile term={copy.visitors}>{formatCount(data.totals.visitors, locale)}</FigureTile>
              <FigureTile term={copy.pageViews}>{formatCount(data.totals.pageViews, locale)}</FigureTile>
              <FigureTile term={copy.campaignViews}>{formatCount(data.totals.campaignViews, locale)}</FigureTile>
              <FigureTile term={copy.campaignClicks}>{formatCount(data.totals.campaignClicks, locale)}</FigureTile>
            </FigureGrid>

            {period !== 'day' && <p className="mt-3 max-w-[68ch] text-xs text-fg-64">{copy.dailySumNote}</p>}
            {nothing && <p className="mt-3 text-sm text-fg-48">{copy.nothingRecorded}</p>}
          </section>

          <section aria-labelledby="audience-traffic-heading">
            <h2 id="audience-traffic-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
              {copy.trafficHeading}
            </h2>
            <AudienceChart
              points={data.series.map((point) => ({ start: point.start, first: point.visitors, second: point.pageViews }))}
              bucket={data.bucket}
              names={{ first: copy.visitors, second: copy.pageViews }}
              range={range}
              locale={locale}
              copy={copy.chart}
            />
          </section>

          <section aria-labelledby="audience-campaign-chart-heading">
            <h2 id="audience-campaign-chart-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
              {copy.campaignChartHeading}
            </h2>
            <AudienceChart
              points={data.series.map((point) => ({
                start: point.start,
                first: point.campaignViews,
                second: point.campaignClicks,
              }))}
              bucket={data.bucket}
              names={{ first: copy.campaignViews, second: copy.campaignClicks }}
              range={range}
              locale={locale}
              copy={copy.chart}
            />
          </section>

          <div className="grid gap-8 sm:grid-cols-2">
            <section aria-labelledby="audience-countries-heading">
              <h2 id="audience-countries-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
                {copy.countries}
              </h2>
              <ShareList
                rows={data.countries.map((row) => ({
                  key: row.country,
                  label: countryLabel(row.country, display, copy.unknownCountry),
                  value: row.visitors,
                }))}
                limit={COUNTRIES_SHOWN}
                more={copy.showAllCountries}
                empty={copy.nothingRecorded}
                locale={locale}
              />
            </section>

            <section aria-labelledby="audience-platforms-heading">
              <h2 id="audience-platforms-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
                {copy.platforms}
              </h2>
              <ShareList
                rows={data.platforms.map((row) => ({
                  key: row.platform,
                  label: copy.platform[row.platform] ?? row.platform,
                  value: row.visitors,
                }))}
                empty={copy.nothingRecorded}
                locale={locale}
              />
            </section>
          </div>

          <section aria-labelledby="audience-top-heading">
            <h2 id="audience-top-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
              {copy.topHeading}
            </h2>
            {data.topCampaigns.length === 0 ? (
              <p className="mt-2 text-sm text-fg-48">{copy.topEmpty}</p>
            ) : (
              <>
                <p className="mt-1 max-w-[68ch] text-sm text-fg-64">{copy.topNote}</p>
                <TopCampaigns
                  campaigns={data.topCampaigns}
                  period={period}
                  opened={opened}
                  onToggle={(projectId) => setOpened((current) => (current === projectId ? null : projectId))}
                  display={display}
                  locale={locale}
                  copy={copy}
                />
              </>
            )}
          </section>

          <p className="max-w-[68ch] text-xs text-fg-48">
            {fillPlaceholders(copy.computedAt, { time: bakuDateTime(data.computedAt, locale) })}
          </p>
        </>
      )}
    </div>
  );
}

interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** A second figure for the row, already worded: a country's clicks beside its views. */
  readonly detail?: string;
}

/**
 * A ranked list with a bar under each row, the count and the share beside it as text.
 *
 * <p>The bar is a reading aid and nothing more, so it is hidden from assistive technology; the
 * figures are the content. Past `limit`, the rest fold under a disclosure rather than being
 * dropped — the long tail of countries is a real answer, it is just not the first one.
 */
function ShareList({
  rows,
  limit,
  more,
  empty,
  locale,
}: {
  readonly rows: readonly ShareRow[];
  readonly limit?: number;
  readonly more?: string;
  readonly empty: string;
  readonly locale: Locale;
}) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-fg-48">{empty}</p>;

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const rest = limit === undefined ? [] : rows.slice(limit);

  const item = (row: ShareRow) => {
    const fraction = shareOf(row.value, total);
    return (
      <li key={row.key} className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-fg">{row.label}</span>
          <span className="shrink-0 tabular-nums text-fg-64">
            <span className="text-fg">{formatCount(row.value, locale)}</span> · {formatShare(fraction, locale)}
            {row.detail !== undefined && <span className="block text-right text-xs text-fg-48">{row.detail}</span>}
          </span>
        </div>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-fg/8">
          <div className="h-full rounded-full bg-fg/56" style={{ width: `${fraction * 100}%` }} />
        </div>
      </li>
    );
  };

  return (
    <>
      <ul className="mt-4 flex list-none flex-col gap-3">{shown.map(item)}</ul>
      {rest.length > 0 && more !== undefined && (
        <details className="mt-3">
          <summary className="cursor-pointer rounded-[4px] text-sm text-fg-64 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
            {more}
          </summary>
          <ul className="mt-3 flex list-none flex-col gap-3">{rest.map(item)}</ul>
        </details>
      )}
    </>
  );
}

/**
 * The twenty campaigns viewed most, each a row that opens into its own figures.
 *
 * <p>The title links to the public page in a new tab, because the reader came here to compare
 * and the comparison should still be here when they come back. A campaign the service sent no
 * address for is its title in plain text, never a link that would answer 404.
 */
function TopCampaigns({
  campaigns,
  period,
  opened,
  onToggle,
  display,
  locale,
  copy,
}: {
  readonly campaigns: readonly AudienceTopCampaign[];
  readonly period: AudiencePeriod;
  readonly opened: string | null;
  readonly onToggle: (projectId: string) => void;
  readonly display: Intl.DisplayNames | null;
  readonly locale: Locale;
  readonly copy: AudienceCopy;
}) {
  return (
    // Scrolls sideways on a phone. Not a region of its own: the section is already one, under the
    // same name, and every row holds a control the keyboard reaches the scrolled part through.
    <div className="mt-4 overflow-x-auto rounded-[var(--radius-md)] border border-fg/8">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{copy.topHeading}</caption>
        <thead>
          <tr className="border-b border-fg/8 text-left text-xs text-fg-64">
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.campaignColumn}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {copy.views}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {copy.clicks}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {copy.ratioColumn}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              <span className="sr-only">{copy.breakdown}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const open = opened === campaign.projectId;
            const panelId = `audience-campaign-${campaign.projectId}`;
            const path = campaignPath(campaign);
            const ratio = clickRatio(campaign.views, campaign.clicks);
            return (
              <Fragment key={campaign.projectId}>
                <tr className={open ? 'bg-fg/6' : 'border-b border-fg/6 last:border-0'}>
                  <th scope="row" className="px-4 py-3 text-left font-normal text-fg">
                    {path === null ? (
                      campaign.title
                    ) : (
                      <a
                        className="rounded-[4px] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        href={localeHref(path, locale)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {campaign.title}
                      </a>
                    )}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">{formatCount(campaign.views, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">{formatCount(campaign.clicks, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-64">
                    {ratio === null ? <NoFigure>{copy.noViews}</NoFigure> : formatShare(ratio, locale)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Pill
                      variant="ghost"
                      size="sm"
                      aria-expanded={open}
                      aria-controls={open ? panelId : undefined}
                      aria-label={fillPlaceholders(copy.breakdownLabel, { title: campaign.title })}
                      onClick={() => onToggle(campaign.projectId)}
                    >
                      {copy.breakdown}
                      <ChevronDown aria-hidden="true" className={open ? 'ml-1 size-4 rotate-180' : 'ml-1 size-4'} />
                    </Pill>
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-fg/6 bg-fg/6 last:border-0">
                    <td id={panelId} colSpan={5} className="px-4 pb-6 pt-2">
                      <CampaignBreakdown
                        projectId={campaign.projectId}
                        title={campaign.title}
                        period={period}
                        display={display}
                        locale={locale}
                        copy={copy}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One campaign over the screen's period, read when its row is opened and again when the period changes. */
function CampaignBreakdown({
  projectId,
  title,
  period,
  display,
  locale,
  copy,
}: {
  readonly projectId: string;
  readonly title: string;
  readonly period: AudiencePeriod;
  readonly display: Intl.DisplayNames | null;
  readonly locale: Locale;
  readonly copy: AudienceCopy;
}) {
  const breakdown = useConsoleResource(
    (signal) => readCampaignAudience(projectId, period, signal),
    copy.breakdownSubject,
    copy.refusals,
    [projectId, period],
  );

  if (breakdown.status === 'signed-out' || breakdown.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={breakdown.status}
        capability={breakdown.capability}
        subject={copy.breakdownSubject}
        copy={copy.refusals}
      />
    );
  }

  if (breakdown.status === 'loading') {
    return (
      <SkeletonGroup label={copy.breakdownLoading}>
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="5rem" width="100%" className="mt-4" />
      </SkeletonGroup>
    );
  }

  if (breakdown.status === 'failed' || breakdown.data === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <InlineAlert variant="danger" title={copy.errorTitle} className="w-full">
          {breakdown.error}
        </InlineAlert>
        <Pill variant="ghost" size="sm" onClick={breakdown.reload}>
          {copy.tryAgain}
        </Pill>
      </div>
    );
  }

  const data = breakdown.data;
  const bucket: AudienceBucket = data.bucket;
  const subheading = 'text-sm font-medium text-fg';

  return (
    <div className="flex flex-col gap-6 text-left" aria-label={title} role="group">
      <FigureGrid>
        <FigureTile term={copy.views}>{formatCount(data.totals.views, locale)}</FigureTile>
        <FigureTile term={copy.clicks}>{formatCount(data.totals.clicks, locale)}</FigureTile>
        <FigureTile term={copy.allTimeViews}>{formatCount(data.allTimeViews, locale)}</FigureTile>
      </FigureGrid>

      <AudienceChart
        points={data.series.map((point) => ({ start: point.start, first: point.views, second: point.clicks }))}
        bucket={bucket}
        names={{ first: copy.views, second: copy.clicks }}
        range={windowDates(data.from, data.to, bucket, locale)}
        locale={locale}
        copy={copy.chart}
        height={140}
      />

      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <h3 className={subheading}>{copy.countries}</h3>
          <ShareList
            rows={data.countries.map((row) => ({
              key: row.country,
              label: countryLabel(row.country, display, copy.unknownCountry),
              value: row.views,
              detail: `${copy.clicks}: ${formatCount(row.clicks, locale)}`,
            }))}
            limit={COUNTRIES_SHOWN}
            more={copy.showAllCountries}
            empty={copy.nothingRecorded}
            locale={locale}
          />
        </div>
        <div>
          <h3 className={subheading}>{copy.surfacesHeading}</h3>
          <ShareList
            rows={data.surfaces.map((row) => ({
              key: row.surface,
              label: copy.surface[row.surface] ?? row.surface,
              value: row.clicks,
            }))}
            empty={copy.nothingRecorded}
            locale={locale}
          />
        </div>
        <div>
          <h3 className={subheading}>{copy.platforms}</h3>
          <ShareList
            rows={data.platforms.map((row) => ({
              key: row.platform,
              label: copy.platform[row.platform] ?? row.platform,
              value: row.views,
            }))}
            empty={copy.nothingRecorded}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}
