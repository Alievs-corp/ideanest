'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatMoney } from '@ideanest/money/format';
import {
  axisLabelIndices,
  bucketSeries,
  highestBucket,
  niceScale,
  toMinorUnits,
  totalAmount,
  type ChartBucket,
  type ChartGranularity,
  type ChartPoint,
} from '../../lib/admin/chart-series';
import { dateTimeFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleChartCopy } from '../../lib/i18n/admin/common-copy';

/**
 * Money pledged over time, as columns on a scale — the console's one chart.
 *
 * <h2>Why it replaced the two that were here</h2>
 *
 * <p>The front page drew grey rectangles in a stretched `<svg>` and the platform figures drew
 * lime columns in a flex row. Neither had a scale, so a reader could see that one day was taller
 * than another and not how much anything was; neither named its days in the reader's language;
 * the lime one said "urgent" about a quantity that is not (docs/ui-kit.md: lime is a call to
 * act); and a year was 365 columns a pixel wide. This one is shared, so the two screens now
 * answer the same question the same way.
 *
 * <h2>What a reader gets</h2>
 *
 * <ul>
 *   <li>A y-axis of round figures with recessive gridlines, so a column can be read as an
 *   amount, and the currency stated once above it.</li>
 *   <li>Dates under the axis in the reader's language — the first, the last and evenly between,
 *   never one per column.</li>
 *   <li>A column per day up to two months, per week up to half a year, per month beyond. The
 *   caption says which.</li>
 *   <li>The highest column labelled with its amount; every other value on hover or focus, in a
 *   tooltip naming the period, the amount and the pledge count.</li>
 *   <li>The keyboard: the plot is one tab stop, and the arrow keys, Home and End move between
 *   columns. What the tooltip says is announced.</li>
 *   <li>The same figures as a real table behind a disclosure, which is the text alternative.</li>
 * </ul>
 *
 * <h2>One colour, and it is not lime</h2>
 *
 * <p>A single series needs no palette. Columns are white at reduced strength and the one being
 * read is full white — the same neutral the creator dashboard's bars use (`ShareBars`), because
 * lime would say "act now" and `--success` would say "the goal was reached", and a busy day is
 * neither. A day with nothing pledged is a short stub on the baseline, not a gap: a missing
 * column would read as a day that was not measured.
 *
 * <h2>Plain markup, no library</h2>
 *
 * <p>Divs positioned by percentage. A charting library would have moved both routes' performance
 * budgets, and a stretched `<svg>` distorts its own text. Nothing animates: the console spends
 * none of docs/motion-system.md's budget, so there is no reduced-motion branch to forget.
 */
export interface ConsoleColumnChartProps {
  readonly points: readonly ChartPoint[];
  /** First day of the range, `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** Last day of the range, inclusive. */
  readonly to: string;
  readonly currency: string;
  readonly locale: Locale;
  readonly copy: ConsoleChartCopy;
  /** Height of the plot in pixels. The axis labels sit outside it. */
  readonly height?: number;
}

/**
 * Horizontal room one date under the axis needs: "14 okt" or "Oct 2026" with clear space either
 * side. The plot is measured, so a phone gets three or four labels and a desktop six or seven.
 */
const AXIS_LABEL_ROOM = 56;
/** Before the plot has been measured, and in tests, which have no layout. */
const DEFAULT_AXIS_LABELS = 6;
const MAX_AXIS_LABELS = 7;

export function ConsoleColumnChart({
  points,
  from,
  to,
  currency,
  locale,
  copy,
  height = 200,
}: ConsoleColumnChartProps) {
  const series = useMemo(() => bucketSeries(points, from, to), [points, from, to]);
  const { buckets, granularity } = series;
  const highest = highestBucket(buckets);
  const scale = useMemo(
    () => niceScale(highest === undefined ? 0n : toMinorUnits(highest.amount)),
    [highest],
  );
  const [active, setActive] = useState<number | null>(null);
  const [axisLabels, setAxisLabels] = useState(DEFAULT_AXIS_LABELS);
  const plot = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const empty = buckets.length === 0;

  useEffect(() => {
    const element = plot.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setAxisLabels(Math.max(2, Math.min(MAX_AXIS_LABELS, Math.floor(width / AXIS_LABEL_ROOM))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // Re-attached when the plot first appears: it is not drawn for an empty range.
  }, [empty]);
  const tableId = useId();

  if (empty) return null;

  const money = (amount: string) => formatMoney({ amount, currency });
  const period = (bucket: ChartBucket) => periodLabel(bucket, granularity, locale, copy);
  // As many decimals as the step has, so 2.5 is never printed as 3 and 250 never as 250.00; and
  // grouped exactly as `formatMoney` groups, so the scale and the amounts beside it read alike.
  const decimals = Number.isInteger(scale.step) ? 0 : Number.isInteger(scale.step * 10) ? 1 : 2;
  const tick = (value: number) => {
    const [whole = '0', fraction] = value.toFixed(decimals).split('.');
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : `.${fraction}`}`;
  };
  // A month axis names the year where it starts and wherever January falls, so a year that
  // begins and ends in October does not read as one October twice.
  const axisLabel = (bucket: ChartBucket, index: number): string => {
    const at = new Date(`${bucket.from}T12:00:00Z`);
    if (granularity !== 'month') {
      return dateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }, 'chart-axis-day').format(at);
    }
    const withYear = index === 0 || bucket.from.slice(5, 7) === '01';
    return withYear
      ? dateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }, 'chart-axis-month-year').format(at)
      : dateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }, 'chart-axis-month').format(at);
  };

  const summary = fillPlaceholders(copy.summary, {
    from: calendar(from, locale),
    to: calendar(to, locale),
    total: money(totalAmount(buckets)),
    period: highest === undefined ? '' : period(highest),
    amount: highest === undefined ? '' : money(highest.amount),
  });

  const shown = active === null ? undefined : buckets[active];
  const shownText =
    shown === undefined
      ? ''
      : `${period(shown)}: ${money(shown.amount)}, ${fillPlaceholders(copy.count, { count: String(shown.count) })}`;

  const ratio = (bucket: ChartBucket) => Number(toMinorUnits(bucket.amount)) / 100 / scale.max;
  const last = buckets.length - 1;
  const highestIndex = highest === undefined ? -1 : buckets.indexOf(highest);
  const showPeakLabel = highest !== undefined && toMinorUnits(highest.amount) > 0n && active === null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? -1;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(last, current + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, current < 0 ? last : current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  /** Where a label over column `index` is anchored, so the first and last never leave the plot. */
  const anchor = (index: number): { left: string; transform: string } => {
    const centre = ((index + 0.5) / buckets.length) * 100;
    if (buckets.length > 2 && index <= buckets.length * 0.12) return { left: `${(index / buckets.length) * 100}%`, transform: 'none' };
    if (buckets.length > 2 && index >= buckets.length * 0.88 - 1) return { left: `${((index + 1) / buckets.length) * 100}%`, transform: 'translateX(-100%)' };
    return { left: `${centre}%`, transform: 'translateX(-50%)' };
  };

  /**
   * The tooltip sits beside its column rather than over it, so the column being read stays in
   * sight: to the right in the left half of the plot, to the left in the right half.
   */
  const beside = (index: number): { left: string; transform: string } => {
    if ((index + 0.5) / buckets.length < 0.5) {
      return { left: `calc(${((index + 1) / buckets.length) * 100}% + 8px)`, transform: 'none' };
    }
    return { left: `calc(${(index / buckets.length) * 100}% - 8px)`, transform: 'translateX(-100%)' };
  };

  return (
    <figure className="mt-4">
      <div className="flex items-baseline justify-between gap-4 text-xs text-white/48">
        <span>{currency}</span>
        <span>{copy.granularity[granularity]}</span>
      </div>

      <div className="mt-5 flex gap-2">
        {/* The scale. Read by sight only: the tooltip and the table carry every figure as text. */}
        <div aria-hidden="true" className="relative w-12 shrink-0 sm:w-14" style={{ height }}>
          {scale.ticks.map((value) => (
            <span
              key={value}
              className="absolute right-0 translate-y-1/2 text-[11px] leading-none tabular-nums text-white/48"
              style={{ bottom: `${(value / scale.max) * 100}%` }}
            >
              {tick(value)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            ref={plot}
            role="group"
            aria-label={summary}
            aria-describedby={hintId}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
            className="relative rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--lime-500)]"
            style={{ height }}
          >
            <span id={hintId} className="sr-only">
              {copy.keyboardHint}
            </span>

            {/* Gridlines. The baseline is stronger, because it is where every column stands. */}
            {scale.ticks.map((value) => (
              <span
                key={value}
                aria-hidden="true"
                className={`absolute inset-x-0 h-px ${value === 0 ? 'bg-[var(--border-strong)]' : 'bg-[var(--divider)]'}`}
                style={{ bottom: `${(value / scale.max) * 100}%` }}
              />
            ))}

            <div
              aria-hidden="true"
              className={`absolute inset-0 flex items-end ${buckets.length > 45 ? 'gap-px' : 'gap-[2px]'}`}
            >
              {buckets.map((bucket, index) => {
                const share = ratio(bucket);
                const isActive = index === active;
                return (
                  <div
                    key={bucket.from}
                    data-chart-column={bucket.from}
                    onMouseEnter={() => setActive(index)}
                    className={`relative flex h-full min-w-0 flex-1 items-end rounded-t-[4px] ${isActive ? 'bg-white/[0.06]' : ''}`}
                  >
                    {share > 0 ? (
                      <span
                        className={`block w-full rounded-t-[4px] ${isActive ? 'bg-white' : 'bg-white/56'}`}
                        style={{ height: `max(2px, ${share * 100}%)` }}
                      />
                    ) : (
                      <span className="block h-[2px] w-full bg-white/16" />
                    )}
                  </div>
                );
              })}
            </div>

            {showPeakLabel && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute whitespace-nowrap pb-1 text-[11px] font-medium leading-none tabular-nums text-white"
                style={{ ...anchor(highestIndex), bottom: `${ratio(highest) * 100}%` }}
              >
                {money(highest.amount)}
              </span>
            )}

            {shown !== undefined && active !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-4)] px-3 py-2 shadow-[var(--shadow-panel)]"
                style={beside(active)}
              >
                <p className="text-xs text-white/64">{period(shown)}</p>
                <p className="mt-0.5 text-sm font-medium tabular-nums text-white">{money(shown.amount)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-white/64">
                  {fillPlaceholders(copy.count, { count: String(shown.count) })}
                </p>
              </div>
            )}

            <span aria-live="polite" className="sr-only">
              {shownText}
            </span>
          </div>

          {/* Dates under the axis, by sight; the group's label already names the range. */}
          <div aria-hidden="true" className="relative mt-2 h-4">
            {axisLabelIndices(buckets.length, axisLabels).map((index) => {
              const bucket = buckets[index];
              if (bucket === undefined) return null;
              return (
                <span
                  key={bucket.from}
                  className="absolute top-0 whitespace-nowrap text-[11px] leading-none text-white/48"
                  style={anchor(index)}
                >
                  {axisLabel(bucket, index)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-white/64">
          {fillPlaceholders(copy.total, { amount: money(totalAmount(buckets)) })}
        </span>
        {highest !== undefined && toMinorUnits(highest.amount) > 0n && (
          <span className="text-white">
            {fillPlaceholders(copy.highest, { period: period(highest), amount: money(highest.amount) })}
          </span>
        )}
      </figcaption>

      <details className="mt-3">
        <summary
          aria-controls={tableId}
          className="cursor-pointer rounded-[4px] text-sm text-white/64 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.tableToggle}
        </summary>
        <div
          id={tableId}
          role="region"
          aria-label={copy.tableToggle}
          tabIndex={0}
          className="mt-3 max-h-80 overflow-auto rounded-[var(--radius-md)] border border-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          <table className="w-full border-collapse text-xs sm:text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr className="border-b border-white/8 text-left text-white/64">
                <th scope="col" className="px-3 py-2 sm:px-4 sm:py-3 font-medium">
                  {copy.periodColumn}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-4 sm:py-3 text-right font-medium">
                  {copy.countColumn}
                </th>
                <th scope="col" className="px-3 py-2 sm:px-4 sm:py-3 text-right font-medium">
                  {copy.amountColumn}
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.from} className="border-b border-white/6 last:border-0">
                  <th scope="row" className="px-3 py-2 sm:px-4 sm:py-2.5 text-left font-normal text-white">
                    {period(bucket)}
                  </th>
                  <td className="px-3 py-2 sm:px-4 sm:py-2.5 text-right tabular-nums text-white/64">{bucket.count}</td>
                  <td className="px-3 py-2 sm:px-4 sm:py-2.5 text-right tabular-nums text-white">{money(bucket.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A `YYYY-MM-DD` day in the reader's language. Read at noon UTC so no zone moves it. */
function calendar(day: string, locale: Locale): string {
  return dateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }, 'chart-day').format(new Date(`${day}T12:00:00Z`));
}

/**
 * What one column covers, in words: a day, a range of days, or a whole month by name.
 *
 * <p>A month the range only partly covers is a range, so "October 2026" is never printed over
 * the eleven days of it the reader asked for.
 */
function periodLabel(bucket: ChartBucket, granularity: ChartGranularity, locale: Locale, copy: ConsoleChartCopy): string {
  if (bucket.from === bucket.to) return calendar(bucket.from, locale);
  if (granularity === 'month' && isWholeMonth(bucket)) {
    return dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }, 'chart-month').format(
      new Date(`${bucket.from}T12:00:00Z`),
    );
  }
  return fillPlaceholders(copy.range, { from: calendar(bucket.from, locale), to: calendar(bucket.to, locale) });
}

function isWholeMonth(bucket: ChartBucket): boolean {
  if (!bucket.from.endsWith('-01')) return false;
  const next = new Date(`${bucket.to}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}
