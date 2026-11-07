'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { bucketLabel, countScale, type AudienceBucket } from '../../lib/admin/audience';
import { axisLabelIndices } from '../../lib/admin/chart-series';
import { formatCount } from '../../lib/admin/console-numbers';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AudienceChartCopy } from '../../lib/i18n/admin/platform-copy';

/**
 * Two counts over the same buckets, as pairs of columns on one scale — issue #635.
 *
 * <h2>Not `ConsoleColumnChart`, and drawn the way it is</h2>
 *
 * <p>That chart is money over calendar days: it re-buckets a day series into weeks or months,
 * prints a currency, and has one series. The audience arrives already bucketed — hours, days or
 * months, chosen by the service — and is two counts that are read together (visitors beside page
 * views, views beside clicks). So this is the same reading — a scale, gridlines, dates under the
 * axis in the reader's language, a tooltip on hover or focus, the arrow keys, and the figures as
 * a table — fitted to that shape rather than the other chart widened until it fits both.
 *
 * <h2>Two series, told apart by shape as well as tone</h2>
 *
 * <p>The first is a filled column and the second an outlined one, and the legend draws the same
 * two shapes beside their names. CLAUDE.md: colour must never carry meaning alone, and two
 * shades of one neutral would be exactly that. Neither is lime — a busy hour is not a call to act.
 *
 * <h2>Every bucket, including the empty ones</h2>
 *
 * <p>The service zero-fills, and a bucket at nought is a stub on the baseline rather than a gap:
 * a missing column reads as a period nobody measured. Nothing animates, so the console spends
 * none of the motion budget and there is no reduced-motion branch to forget.
 */
export interface AudienceChartPoint {
  readonly start: string;
  readonly first: number;
  readonly second: number;
}

export interface AudienceChartProps {
  readonly points: readonly AudienceChartPoint[];
  readonly bucket: AudienceBucket;
  /** The two series' names, in the order of {@link AudienceChartPoint.first} and `second`. */
  readonly names: { readonly first: string; readonly second: string };
  /** The window's first and last day (or month), already in the reader's language. */
  readonly range: { readonly first: string; readonly last: string };
  readonly locale: Locale;
  readonly copy: AudienceChartCopy;
  readonly height?: number;
}

/** Horizontal room one label under the axis needs. */
const AXIS_LABEL_ROOM = 56;
const DEFAULT_AXIS_LABELS = 6;
const MAX_AXIS_LABELS = 8;

export function AudienceChart({ points, bucket, names, range, locale, copy, height = 180 }: AudienceChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [axisLabels, setAxisLabels] = useState(DEFAULT_AXIS_LABELS);
  const plot = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const tableId = useId();
  const empty = points.length === 0;

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
  }, [empty]);

  if (empty) return null;

  const peak = points.reduce((highest, point) => Math.max(highest, point.first, point.second), 0);
  const scale = countScale(peak);
  const count = (value: number) => formatCount(value, locale);
  const long = (point: AudienceChartPoint) => bucketLabel(point.start, bucket, locale, 'long');
  const summary = fillPlaceholders(copy.summary, {
    first: names.first,
    second: names.second,
    from: range.first,
    to: range.last,
  });

  const last = points.length - 1;
  const shown = active === null ? undefined : points[active];
  const shownText =
    shown === undefined
      ? ''
      : `${long(shown)}: ${names.first} ${count(shown.first)}, ${names.second} ${count(shown.second)}`;

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

  /** Where a label under column `index` is anchored, so the first and last never leave the plot. */
  const anchor = (index: number): { left: string; transform: string } => {
    if (points.length > 2 && index <= points.length * 0.12) return { left: `${(index / points.length) * 100}%`, transform: 'none' };
    if (points.length > 2 && index >= points.length * 0.88 - 1) {
      return { left: `${((index + 1) / points.length) * 100}%`, transform: 'translateX(-100%)' };
    }
    return { left: `${((index + 0.5) / points.length) * 100}%`, transform: 'translateX(-50%)' };
  };

  /** The tooltip beside its column, so the column being read stays in sight. */
  const beside = (index: number): { left: string; transform: string } =>
    (index + 0.5) / points.length < 0.5
      ? { left: `calc(${((index + 1) / points.length) * 100}% + 8px)`, transform: 'none' }
      : { left: `calc(${(index / points.length) * 100}% - 8px)`, transform: 'translateX(-100%)' };

  const share = (value: number) => `max(2px, ${(value / scale.max) * 100}%)`;

  return (
    <figure className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-fg-64">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="block size-2.5 rounded-[2px] bg-fg/56" />
            {names.first}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="block size-2.5 rounded-[2px] border border-fg/72" />
            {names.second}
          </li>
        </ul>
        <span className="text-fg-48">{copy.granularity[bucket]}</span>
      </div>

      <div className="mt-5 flex gap-2">
        {/* The scale, by sight only: the tooltip and the table carry every figure as text. */}
        <div aria-hidden="true" className="relative w-10 shrink-0 sm:w-12" style={{ height }}>
          {scale.ticks.map((value) => (
            <span
              key={value}
              className="absolute right-0 translate-y-1/2 text-[11px] leading-none tabular-nums text-fg-48"
              style={{ bottom: `${(value / scale.max) * 100}%` }}
            >
              {count(value)}
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
            className="relative rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)]"
            style={{ height }}
          >
            <span id={hintId} className="sr-only">
              {copy.keyboardHint}
            </span>

            {scale.ticks.map((value) => (
              <span
                key={value}
                aria-hidden="true"
                className={`absolute inset-x-0 h-px ${value === 0 ? 'bg-[var(--border-strong)]' : 'bg-[var(--divider)]'}`}
                style={{ bottom: `${(value / scale.max) * 100}%` }}
              />
            ))}

            <div aria-hidden="true" className={`absolute inset-0 flex items-end ${points.length > 24 ? 'gap-px' : 'gap-[3px]'}`}>
              {points.map((point, index) => {
                const isActive = index === active;
                return (
                  <div
                    key={point.start}
                    data-chart-column={point.start}
                    onMouseEnter={() => setActive(index)}
                    className={`flex h-full min-w-0 flex-1 items-end gap-px rounded-t-[4px] ${isActive ? 'bg-fg/6' : ''}`}
                  >
                    {point.first > 0 ? (
                      <span
                        className={`block min-w-0 flex-1 rounded-t-[3px] ${isActive ? 'bg-fg' : 'bg-fg/56'}`}
                        style={{ height: share(point.first) }}
                      />
                    ) : (
                      <span className="block h-[2px] min-w-0 flex-1 bg-fg/16" />
                    )}
                    {point.second > 0 ? (
                      <span
                        className={`block min-w-0 flex-1 rounded-t-[3px] border ${isActive ? 'border-fg' : 'border-fg/72'}`}
                        style={{ height: share(point.second) }}
                      />
                    ) : (
                      <span className="block h-[2px] min-w-0 flex-1 bg-fg/16" />
                    )}
                  </div>
                );
              })}
            </div>

            {shown !== undefined && active !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[240px] rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-4)] px-3 py-2 shadow-[var(--shadow-panel)]"
                style={beside(active)}
              >
                <p className="text-xs text-fg-64">{long(shown)}</p>
                <p className="mt-0.5 text-sm tabular-nums text-fg">
                  {names.first}: <span className="font-medium">{count(shown.first)}</span>
                </p>
                <p className="mt-0.5 text-sm tabular-nums text-fg">
                  {names.second}: <span className="font-medium">{count(shown.second)}</span>
                </p>
              </div>
            )}

            <span aria-live="polite" className="sr-only">
              {shownText}
            </span>
          </div>

          <div aria-hidden="true" className="relative mt-2 h-4">
            {axisLabelIndices(points.length, axisLabels).map((index) => {
              const point = points[index];
              if (point === undefined) return null;
              return (
                <span
                  key={point.start}
                  className="absolute top-0 whitespace-nowrap text-[11px] leading-none text-fg-48"
                  style={anchor(index)}
                >
                  {bucketLabel(point.start, bucket, locale, 'short', index === 0)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <details className="mt-3">
        <summary
          aria-controls={tableId}
          className="cursor-pointer rounded-[4px] text-sm text-fg-64 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {copy.tableToggle}
        </summary>
        <div
          id={tableId}
          role="region"
          aria-label={copy.tableToggle}
          tabIndex={0}
          className="mt-3 max-h-80 overflow-auto rounded-[var(--radius-md)] border border-fg/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <table className="w-full border-collapse text-xs sm:text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr className="border-b border-fg/8 text-left text-fg-64">
                <th scope="col" className="px-3 py-2 font-medium sm:px-4 sm:py-3">
                  {copy.periodColumn}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4 sm:py-3">
                  {names.first}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4 sm:py-3">
                  {names.second}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.start} className="border-b border-fg/6 last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-fg sm:px-4 sm:py-2.5">
                    {long(point)}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-fg sm:px-4 sm:py-2.5">{count(point.first)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg sm:px-4 sm:py-2.5">{count(point.second)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
