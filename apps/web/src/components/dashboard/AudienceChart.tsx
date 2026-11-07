'use client';

import { bucketLabel, type AudienceBucket, type AudiencePoint } from '../../lib/dashboard/audience';
import type { AudienceCopy } from '../../lib/i18n/dashboard-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * Views and clicks per bucket, side by side — #634's chart, drawn the way `TrendChart` is.
 *
 * <h2>Two columns per bucket, and the difference is not only a shade</h2>
 *
 * Views are the full-strength column on the left of each pair, clicks the lighter one on the
 * right. Position and lightness both separate them, the legend names them in words, and the
 * table under the chart is the same figures as text — so nothing here depends on telling two
 * colours apart (docs/ui-kit.md §9.2). Neither is lime (a busy hour is not urgent) nor
 * `--success` (it is not a goal reached); `ShareBars` makes the same choice.
 *
 * <h2>By position, because every bucket is there</h2>
 *
 * The service zero-fills the window, so bucket `i` of `n` is at `i / n` and a quiet hour is a
 * gap of the right width. The hours of today still to come are in the series at zero and are
 * drawn as nothing, which is what they are.
 *
 * <h2>A picture and a table</h2>
 *
 * The `<svg>` is `aria-hidden`; the table folded under it is what a screen reader reads, and it
 * is the same numbers rather than a summary of them. Nothing animates — the dashboard's draw-in
 * allowance (docs/motion-system.md §5) is declined for the reason `TrendChart` gives — so there
 * is no reduced-motion branch to forget.
 */

const WIDTH = 720;
const HEIGHT = 200;
/** The pair's share of its slot; the rest is the gap between buckets. */
const PAIR = 0.72;

export interface AudienceChartProps {
  readonly series: readonly AudiencePoint[];
  readonly bucket: AudienceBucket;
  /** Names the figure — resolved by the panel, which knows the window. */
  readonly label: string;
  readonly locale: Locale;
  readonly copy: AudienceCopy;
}

export function AudienceChart({ series, bucket, label, locale, copy }: AudienceChartProps) {
  const peak = series.reduce((highest, point) => Math.max(highest, point.views, point.clicks), 0);
  const slot = series.length === 0 ? 0 : WIDTH / series.length;
  const bar = (slot * PAIR) / 2;
  const heightOf = (value: number): number => (peak <= 0 ? 0 : (value / peak) * (HEIGHT - 4));

  const busiest = series.reduce<AudiencePoint | undefined>(
    (best, point) => (point.views > 0 && (best === undefined || point.views > best.views) ? point : best),
    undefined,
  );

  // First, middle and last under the axis: enough to place a bucket, never one per column.
  const ticks = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter(
    (index) => index >= 0,
  );
  const column = bucket === 'HOUR' ? copy.hour : bucket === 'DAY' ? copy.day : copy.month;

  return (
    <figure className="mt-4">
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-64">
        <li className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm bg-fg" />
          {copy.views}
        </li>
        <li className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm bg-fg/40" />
          {copy.clicks}
        </li>
      </ul>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="presentation"
        aria-hidden
        preserveAspectRatio="none"
        className="h-[200px] w-full"
      >
        <line x1={0} y1={HEIGHT} x2={WIDTH} y2={HEIGHT} stroke="var(--border-strong)" strokeWidth={1} />
        {series.map((point, index) => {
          const left = index * slot + (slot * (1 - PAIR)) / 2;
          const views = heightOf(point.views);
          const clicks = heightOf(point.clicks);
          return (
            <g key={point.start}>
              {views > 0 ? (
                <rect x={left} y={HEIGHT - views} width={bar} height={views} fill="var(--text-primary)" />
              ) : null}
              {clicks > 0 ? (
                <rect
                  x={left + bar}
                  y={HEIGHT - clicks}
                  width={bar}
                  height={clicks}
                  fill="var(--text-primary)"
                  fillOpacity={0.4}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      <div aria-hidden className="mt-1.5 flex justify-between text-xs tabular-nums text-fg-64">
        {ticks.map((index) => {
          const point = series[index];
          return point === undefined ? null : <span key={point.start}>{bucketLabel(point.start, bucket, locale)}</span>;
        })}
      </div>

      <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-fg-64">
        <span>{label}</span>
        {busiest !== undefined ? (
          <span className="text-fg">
            {fillPlaceholders(copy.peak, {
              when: bucketLabel(busiest.start, bucket, locale),
              count: String(busiest.views),
            })}
          </span>
        ) : null}
      </figcaption>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-fg-64 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
          {copy.showTable}
        </summary>
        <div
          role="region"
          aria-label={copy.tableLabel}
          tabIndex={0}
          className="mt-3 max-h-[420px] overflow-auto rounded-[14px] border border-fg/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <table className="w-full min-w-[320px] border-collapse text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-fg/8 text-left text-fg-64">
                <th scope="col" className="px-4 py-3 font-medium">
                  {column}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {copy.views}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {copy.clicks}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.start} className="border-b border-fg/6 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal text-fg">
                    {bucketLabel(point.start, bucket, locale)}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">{point.views}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-64">{point.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
