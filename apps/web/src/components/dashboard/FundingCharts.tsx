'use client';

import { useEffect, useState } from 'react';
import { InlineAlert, Skeleton, SkeletonGroup, StatBlock, StatRow } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { formatMoney } from '../../lib/money';
import { formatRelativeTime } from '../../lib/time';
import { getTrend, type Trend } from '../../lib/dashboard/analytics';
import { getBreakdown, type BackerBreakdown } from '../../lib/dashboard/backers';
import { ShareBars, type ShareBar } from './ShareBars';
import { TrendChart } from './TrendChart';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { FundingChartsCopy } from '../../lib/i18n/dashboard-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.7's CD-02, CD-07 and CD-08 — issue 96: the funding trend, the reward mix, and where
 * the backers are.
 *
 * <h2>Two reads, and they are deliberately not one</h2>
 *
 * The trend comes from `GET /analytics`, which is #95's daily rollup and is as fresh as the
 * last aggregation pass. The two splits come from `GET /backers/breakdown`, which is
 * computed from `pledges` at the moment of the request. Folding them into one endpoint
 * would put two different freshnesses in one body with nothing to tell them apart — the
 * same argument CD-01's live totals make for not joining the trend, one panel over.
 *
 * <p>They are fetched together and rendered together, and the one thing this screen must not
 * do is imply they were measured at the same instant. `computedAt` is printed under the
 * trend for that reason: a stalled aggregator and a quiet week draw the same flat line, and
 * that line beside a fresh reward mix is how somebody concludes the campaign stopped.
 *
 * <h2>A failure in one does not take the other down</h2>
 *
 * Each read has its own state. A breakdown that fails leaves the trend on screen with an
 * explanation in its place, because half a dashboard is more useful than an error page —
 * and because the two failures have different causes.
 */

type Status = 'loading' | 'ready' | 'failed';

/**
 * What a refusal means, in the words of the read that was refused.
 *
 * The two refusals used to share one sentence with the subject interpolated into it. They are
 * written out now, once per read: "does not include the funding trend" declines its object in
 * three of the four languages this platform ships, and a translator handed a hole in the
 * middle of a sentence cannot put a case ending on whatever lands in it.
 */
function messageFor(
  cause: unknown,
  copy: FundingChartsCopy,
  subject: { readonly notGranted: string; readonly unavailable: string },
): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.failures.signedOut;
    if (cause.status === 403) return subject.notGranted;
    if (cause.status === 404) return copy.failures.noCampaign;
  }
  return subject.unavailable;
}

export interface FundingChartsProps {
  readonly projectId: string;
  /** Injected by tests. Default to the real readers. */
  readonly loadTrend?: typeof getTrend;
  readonly loadBreakdown?: typeof getBreakdown;
  /** Injected by tests, so "computed 4 minutes ago" is assertable. */
  readonly nowImpl?: () => Date;
  /** Every word this panel, its trend chart and its bars draw — #79. */
  readonly copy: FundingChartsCopy;
}

export function FundingCharts({
  projectId,
  loadTrend,
  loadBreakdown,
  nowImpl,
  copy,
}: FundingChartsProps) {
  const locale = useRouteLocale();
  const [trendStatus, setTrendStatus] = useState<Status>('loading');
  const [trend, setTrend] = useState<Trend | null>(null);
  const [trendFailure, setTrendFailure] = useState('');

  const [splitStatus, setSplitStatus] = useState<Status>('loading');
  const [breakdown, setBreakdown] = useState<BackerBreakdown | null>(null);
  const [splitFailure, setSplitFailure] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    (loadTrend ?? getTrend)(projectId, controller.signal)
      .then((body) => {
        setTrend(body);
        setTrendStatus('ready');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setTrendFailure(
          messageFor(cause, copy, {
            notGranted: copy.trendNotGranted,
            unavailable: copy.trendUnavailable,
          }),
        );
        setTrendStatus('failed');
      });

    (loadBreakdown ?? getBreakdown)(projectId, controller.signal)
      .then((body) => {
        setBreakdown(body);
        setSplitStatus('ready');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setSplitFailure(
          messageFor(cause, copy, {
            notGranted: copy.splitNotGranted,
            unavailable: copy.splitUnavailable,
          }),
        );
        setSplitStatus('failed');
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <section aria-labelledby="charts-heading">
      <h1 id="charts-heading" className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
        {copy.heading}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

      <h2 className="mt-8 text-lg font-semibold text-white">{copy.trendHeading}</h2>
      {trendStatus === 'loading' ? (
        <SkeletonGroup label={copy.trendLoading}>
          <Skeleton className="h-[220px] w-full" />
        </SkeletonGroup>
      ) : null}
      {trendStatus === 'failed' ? <InlineAlert variant="danger">{trendFailure}</InlineAlert> : null}
      {trendStatus === 'ready' && trend !== null ? (
        trend.days.length === 0 ? (
          <p className="mt-4 max-w-[62ch] text-sm text-white/64">
            {fillPlaceholders(copy.trendEmpty, { from: trend.from, to: trend.to })}
          </p>
        ) : (
          <>
            <TrendChart
              days={trend.days}
              from={trend.from}
              to={trend.to}
              label={fillPlaceholders(copy.trendLabel, {
                from: trend.from,
                to: trend.to,
                zone: trend.zone,
              })}
              copy={copy.trend}
            />
            {/*
              The freshness, printed rather than assumed. This series is only ever as
              current as the last rollup, and a creator comparing it against the live
              totals on the overview needs to know why the two can differ.
            */}
            {trend.computedAt !== undefined ? (
              <p className="mt-2 text-sm text-white/64">
                {fillPlaceholders(copy.aggregated, {
                  when: formatRelativeTime(
                    trend.computedAt,
                    (nowImpl ?? (() => new Date()))(),
                    locale,
                  ),
                })}
              </p>
            ) : null}
          </>
        )
      ) : null}

      <h2 className="mt-10 text-lg font-semibold text-white">{copy.splitHeading}</h2>
      {splitStatus === 'loading' ? (
        <SkeletonGroup label={copy.splitLoading}>
          <Skeleton className="h-24 w-full" />
        </SkeletonGroup>
      ) : null}
      {splitStatus === 'failed' ? <InlineAlert variant="danger">{splitFailure}</InlineAlert> : null}
      {splitStatus === 'ready' && breakdown !== null ? (
        breakdown.backerCount === 0 ? (
          <p className="mt-4 max-w-[62ch] text-sm text-white/64">{copy.splitEmpty}</p>
        ) : (
          <>
            <StatRow className="mt-4">
              <StatBlock label={copy.backers} value={String(breakdown.backerCount)} />
              <StatBlock
                label={copy.pledged}
                value={breakdown.total ? formatMoney(breakdown.total) : copy.nothingYet}
              />
            </StatRow>

            <h3 className="mt-8 text-sm font-semibold text-white">{copy.rewardHeading}</h3>
            {breakdown.rewards.length === 0 ? (
              <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.rewardEmpty}</p>
            ) : (
              <>
                <ShareBars
                  label={copy.rewardLabel}
                  rows={breakdown.rewards.map((slice) => rewardRow(slice, copy.removedTier))}
                  backers={copy.shareBackers}
                  locale={locale}
                />
                {/*
                  Said rather than left to be noticed. These bars sum to at most the
                  campaign's total, and the difference is support that took no reward —
                  a creator who added them up and found a shortfall would be right.
                */}
                <p className="mt-3 max-w-[62ch] text-sm text-white/64">{copy.rewardNote}</p>
              </>
            )}

            <h3 className="mt-8 text-sm font-semibold text-white">{copy.destinationHeading}</h3>
            <ShareBars
              label={copy.destinationLabel}
              rows={breakdown.countries.map((slice) => countryRow(slice, copy.noDestination))}
              backers={copy.shareBackers}
              locale={locale}
            />
            <p className="mt-3 max-w-[62ch] text-sm text-white/64">{copy.destinationNote}</p>
          </>
        )
      ) : null}
    </section>
  );
}

/** A tier's row. A tier the campaign has since removed keeps its pledges and loses its name. */
function rewardRow(slice: BackerBreakdown['rewards'][number], removedTier: string): ShareBar {
  return {
    label: slice.title ?? removedTier,
    backerCount: slice.backerCount,
    amount: slice.amount,
  };
}

/**
 * A destination's row.
 *
 * The country code as it stands, rather than a translated country name: there is no country
 * vocabulary on the platform yet — `locations` covers the eighteen Azerbaijani cities a
 * campaign can be in, and nothing maps ISO codes to names in a locale. A code a creator can
 * look up beats a name this screen would have to invent.
 */
function countryRow(slice: BackerBreakdown['countries'][number], noDestination: string): ShareBar {
  return {
    label: slice.country ?? noDestination,
    backerCount: slice.backerCount,
    amount: slice.amount,
  };
}
