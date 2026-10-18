'use client';

import { useMemo, useState } from 'react';
import { InlineAlert, Pill, Skeleton, SkeletonGroup, StatBlock, StatRow } from '@ideanest/ui';
import { readPlatformAnalytics, type PlatformDailyPoint } from '../../lib/admin/platform-analytics';
import { formatMoney } from '../../lib/money';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { PlatformAnalyticsCopy } from '../../lib/i18n/admin/platform-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { ConsoleColumnChart } from './ConsoleColumnChart';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * The windows somebody actually reads a platform dashboard over.
 *
 * Numbers only since #324: the word beside each is `admin.screens.analytics.windows`, keyed by
 * the same number. "30 days" is a noun phrase that inflects, and three of them built as
 * `${n} days` were three sentences no translation could reach.
 */
const WINDOWS = [30, 90, 365] as const;

/**
 * §4.11's AD-13: volume, success rate, average pledge — issue #313.
 *
 * <h2>Three of the five, and the screen names the other two</h2>
 *
 * AD-13 lists "volume, success rate, average pledge, cohorts, funnels". The first three are
 * here. Cohorts and funnels are not, and the reasons come from the service in `notBuilt` rather
 * than being written into this file — a cohort needs a rollup keyed on a backer&apos;s first
 * pledge and a funnel needs the visit-to-pledge path, and neither exists.
 *
 * Approximating them from what is here would put two numbers on a dashboard that look like
 * cohorts and funnels and are not, which is the failure the console index avoids for its
 * blocked modules by naming what each is waiting on.
 *
 * <h2>One currency, and the exclusion is on the screen</h2>
 *
 * §21.2 refuses to convert between currencies for anything that moves money, and a figure a
 * director reads is not exempt. Pledges in another currency are counted and reported rather
 * than folded in — a total with a silent exclusion is worse than one with a stated gap.
 *
 * <h2>The chart is CSS, not a charting library</h2>
 *
 * Bars sized by percentage, and nothing imported. A charting library in a
 * `transpilePackages` graph lands in the shared chunk for every console route — `MinimalShell`
 * records what that cost the last time — and this is one screen with one series. It is also
 * why the route's performance budget did not move for #405: the change below is markup.
 *
 * <h2>Daily volume reads left to right, because that is what a trend is — issue #405</h2>
 *
 * <p>It used to be thirty rows, one per day, each with a horizontal bar beside the figure.
 * Every number was on the screen and the shape was not: a reader comparing the fourth of
 * August with the twelfth was comparing two bar lengths eight rows apart, which is the one
 * arrangement that hides a series. Time runs along the axis now and the columns share a
 * baseline, so "volume fell after the fifteenth" is something somebody sees rather than
 * something they work out.
 *
 * <p><strong>Every figure is still readable, and not only as a length.</strong> Each column
 * carries its day and its amount as text for a screen reader, the axis is labelled with the
 * first and last day, and the busiest day is stated — CLAUDE.md's rule that colour must never
 * carry meaning applies to length in exactly the same way. What was removed is the
 * repetition, not the data.
 */
export interface PlatformAnalyticsViewProps {
  readonly copy: PlatformAnalyticsCopy;
}

export function PlatformAnalyticsView({ copy }: PlatformAnalyticsViewProps) {
  const [days, setDays] = useState(30);

  const analytics = useConsoleResource(
    (signal) => {
      const to = new Date();
      const from = new Date(to.getTime() - (days - 1) * 86_400_000);
      return readPlatformAnalytics(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
        signal,
      );
    },
    copy.subject,
    copy.refusals,
    [days],
  );

  if (analytics.status === 'signed-out' || analytics.status === 'forbidden') {
    return <ConsoleRefusal status={analytics.status} capability={analytics.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((window) => (
          <Pill
            key={window}
            variant={days === window ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setDays(window)}
          >
            {copy.windows[String(window)] ?? String(window)}
          </Pill>
        ))}
      </div>

      {analytics.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList}>
          <Skeleton height="1rem" width="40%" />
          <Skeleton height="6rem" width="100%" className="mt-4" />
        </SkeletonGroup>
      )}

      {analytics.status === 'failed' && (
        <>
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {analytics.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" onClick={analytics.reload}>
            {copy.tryAgain}
          </Pill>
        </>
      )}

      {analytics.status === 'ready' && analytics.data !== null && (
        <>
          <section aria-labelledby="totals-heading">
            <h2 id="totals-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
              {fillPlaceholders(copy.range, {
                from: analytics.data.from,
                to: analytics.data.to,
              })}
            </h2>

            <StatRow className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
              <StatBlock label={copy.volume} value={formatMoney(analytics.data.totals.volume)} />
              <StatBlock label={copy.pledges} value={String(analytics.data.totals.pledgeCount)} />
              <StatBlock label={copy.backers} value={String(analytics.data.totals.backerCount)} />
              <StatBlock
                label={copy.averagePledge}
                value={formatMoney(analytics.data.totals.averagePledge)}
              />
              <StatBlock
                label={copy.liveProjects}
                value={String(analytics.data.totals.liveProjects)}
              />
              <StatBlock
                label={copy.planRevenue}
                value={formatMoney(analytics.data.totals.planRevenue)}
              />
              <StatBlock
                label={copy.planPayments}
                value={String(analytics.data.totals.planPayments)}
              />
            </StatRow>

            {analytics.data.totals.otherCurrencyPledges > 0 && (
              <InlineAlert variant="warning" title={copy.otherCurrencyTitle} className="mt-4">
                {fillPlaceholders(copy.otherCurrencyBody, {
                  count: String(analytics.data.totals.otherCurrencyPledges),
                })}
              </InlineAlert>
            )}
          </section>

          <section aria-labelledby="outcomes-heading">
            <h2 id="outcomes-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
              {copy.outcomesHeading}
            </h2>

            {analytics.data.outcomes.successRate == null ? (
              <p className="mt-2 text-sm text-white/48">{copy.noneClosed}</p>
            ) : (
              <StatRow className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
                <StatBlock label={copy.succeeded} value={String(analytics.data.outcomes.succeeded)} />
                <StatBlock label={copy.didNot} value={String(analytics.data.outcomes.failed)} />
                <StatBlock
                  label={copy.successRate}
                  value={`${Math.round(analytics.data.outcomes.successRate * 100)}%`}
                />
              </StatRow>
            )}
          </section>

          <section aria-labelledby="daily-heading">
            <h2 id="daily-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
              {copy.dailyHeading}
            </h2>

            {analytics.data.daily.length === 0 ? (
              <p className="mt-2 text-sm text-white/48">{copy.nothingPledged}</p>
            ) : (
              <DailyVolume
                points={analytics.data.daily}
                from={analytics.data.from}
                to={analytics.data.to}
                currency={analytics.data.totals.volume.currency}
                copy={copy}
              />
            )}
          </section>

          {analytics.data.notBuilt.length > 0 && (
            <section aria-labelledby="not-built-heading">
              <h2 id="not-built-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
                {copy.notBuiltHeading}
              </h2>
              <ul className="mt-2 flex list-none flex-col gap-2">
                {analytics.data.notBuilt.map((reason) => (
                  <li key={reason} className="text-sm text-white/64">
                    {/* #403: the service sends a code and the sentence is the catalogue's.
                        A code with no sentence is drawn as itself rather than dropped. */}
                    {copy.notBuilt[reason] ?? reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The daily series on the console's shared chart — a scale, dates in the reader's language,
 * a tooltip per column, and weeks or months when the window is too long for days.
 */
function DailyVolume({
  points,
  from,
  to,
  currency,
  copy,
}: {
  readonly points: readonly PlatformDailyPoint[];
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly copy: PlatformAnalyticsCopy;
}) {
  const locale = useRouteLocale();
  const series = useMemo(
    () => points.map((point) => ({ day: point.day, amount: point.volume.amount, count: point.pledgeCount })),
    [points],
  );

  return (
    <ConsoleColumnChart points={series} from={from} to={to} currency={currency} locale={locale} copy={copy.chart} />
  );
}
