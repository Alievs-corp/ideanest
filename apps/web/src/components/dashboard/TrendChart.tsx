'use client';

import { formatMoney } from '../../lib/money';
import { TREND_CHART, polylinePoints, trendPoints, type TrendDay } from '@ideanest/dashboard/analytics';
import type { TrendChartCopy } from '../../lib/i18n/dashboard-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.7's CD-02: what the campaign has raised, over the days it has been running.
 *
 * <h2>The line is the running total, not the day's takings</h2>
 *
 * Both are in the data and only one of them answers the question a creator opens this panel
 * with, which is "are we going to make it". A per-day bar chart of a campaign's takings is
 * mostly noise — funding is famously front-and-back loaded — and the shape that matters is
 * the one climbing towards the goal. The daily figures are in the table below the chart,
 * where somebody asking a different question can read them.
 *
 * <h2>The series is sparse, and the x-axis is time rather than position</h2>
 *
 * A day on which nothing was pledged has no entry (the rollup does not write zero rows, and
 * V27 says why). Plotting points at equal spacing would compress a quiet fortnight into the
 * same width as a busy one and quietly redraw the campaign's history. Each point is placed
 * by <em>which day it is</em> inside the requested range, so a gap is a gap.
 *
 * <h2>A picture and a table, not a picture with a table hidden behind it</h2>
 *
 * The `<svg>` is `aria-hidden` and the same numbers are a real `<table>` underneath, folded
 * into a `<details>`. Nothing is encoded in colour, so the chart survives forced colours and
 * a printout; the table is what a screen reader reads, and it is the same data rather than a
 * summary of it.
 *
 * <h2>No draw-in</h2>
 *
 * docs/motion-system.md §5 sanctions a chart draw-in on the dashboard, and this spends none
 * of it. A stroke that animates in delays the one thing the panel exists to show, and the
 * budget is a ceiling rather than a target. Nothing here animates, so nothing here needs a
 * `prefers-reduced-motion` branch.
 */

/** The drawing box, shared with the app so both draw the same points (#163). */
const { width: WIDTH, height: HEIGHT, padding: PADDING } = TREND_CHART;

export interface TrendChartProps {
  readonly days: readonly TrendDay[];
  /** The first day of the requested range, `YYYY-MM-DD`. Where the x-axis starts. */
  readonly from: string;
  /** The last day, inclusive. Where it ends. */
  readonly to: string;
  /** Names the figure. Resolved by the panel above, which knows the range and the zone. */
  readonly label: string;
  /** The figure's caption and the table folded behind it — #79. */
  readonly copy: TrendChartCopy;
}

export function TrendChart({ days, from, to, label, copy }: TrendChartProps) {
  const points = trendPoints(days, from, to);
  const peak = days[days.length - 1];
  // A single point, held separately: `noUncheckedIndexedAccess` is on, and the narrowing
  // has to survive being read inside JSX.
  const only = points.length === 1 ? points[0] : undefined;

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="presentation"
        aria-hidden
        preserveAspectRatio="none"
        className="h-[220px] w-full"
      >
        {/* The baseline. Recessive, because it is a reference and not a reading. */}
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
        {points.length > 1 ? (
          <polyline
            points={polylinePoints(points)}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {only !== undefined ? (
          // One day is a point rather than a line. A single-point polyline draws nothing,
          // which would show a campaign that took its first pledge as one that took none.
          <circle cx={only.x} cy={only.y} r={4} fill="var(--text-primary)" />
        ) : null}
      </svg>

      <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-white/64">
        <span>{label}</span>
        {peak !== undefined ? (
          <span className="text-white">
            {fillPlaceholders(copy.peak, {
              amount: formatMoney(peak.cumulativeAmount),
              day: peak.day,
            })}
          </span>
        ) : null}
      </figcaption>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-white/64 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]">
          {copy.showDaily}
        </summary>
        <div
          role="region"
          aria-label={copy.dailyLabel}
          tabIndex={0}
          className="mt-3 overflow-x-auto rounded-[14px] border border-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
        >
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-white/8 text-left text-white/64">
                <th scope="col" className="px-4 py-3 font-medium">
                  {copy.day}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {copy.backers}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {copy.pledged}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {copy.runningTotal}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day} className="border-b border-white/6 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal text-white">
                    {day.day}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums text-white/64">{day.pledgeCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/64">
                    {formatMoney(day.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    {formatMoney(day.cumulativeAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
