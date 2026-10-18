/**
 * The arithmetic behind the console's column charts: which columns there are, what each one
 * holds, and where the gridlines go.
 *
 * <p>Kept apart from the component so it can be tested without a DOM, and so neither screen
 * that draws a chart — the front page and the platform figures — has its own idea of a week.
 *
 * <h2>Columns are periods of time, not entries in the response</h2>
 *
 * <p>The service may leave out a day on which nothing was pledged. Drawing the entries at equal
 * spacing would close that gap and redraw the platform's history, so every day of the requested
 * range gets a column and a missing one is a measured zero.
 *
 * <h2>A year is twelve columns, not three hundred and sixty-five</h2>
 *
 * <p>A column thinner than a couple of pixels is not something a reader can point at or a hover
 * can find, so a long range is summed into weeks and then into months. The first and the last
 * period are clipped to the range: a week that began before it covers only the days inside it,
 * and its label says so.
 *
 * <h2>Money is summed in whole qəpik, never in floating point</h2>
 *
 * <p>A bucket's total is shown to the reader, so it is added as integers of the smallest unit
 * from the decimal strings the service sent. Floating point is used for one thing only: the
 * height of a column and the position of a gridline, which are geometry and are never printed.
 */

/** One day as both screens receive it. `day` is `YYYY-MM-DD` in Baku. */
export interface ChartPoint {
  readonly day: string;
  readonly amount: string;
  readonly count: number;
}

export type ChartGranularity = 'day' | 'week' | 'month';

/** One column: the first and last day it covers, inclusive, and what was pledged in them. */
export interface ChartBucket {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly count: number;
}

export interface ChartSeries {
  readonly granularity: ChartGranularity;
  readonly buckets: readonly ChartBucket[];
}

/** Up to this many days are drawn one column a day: a month and a little more. */
export const DAILY_LIMIT = 62;
/** Up to this many are drawn by week; anything longer is drawn by month. */
export const WEEKLY_LIMIT = 182;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayToTime(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function timeToDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included. Empty when either is not a day or they are reversed. */
export function daysBetween(from: string, to: string): string[] {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return [];
  const start = dayToTime(from);
  const end = dayToTime(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const days: string[] = [];
  for (let at = start; at <= end; at += DAY_MS) days.push(timeToDay(at));
  return days;
}

export function granularityFor(dayCount: number): ChartGranularity {
  if (dayCount <= DAILY_LIMIT) return 'day';
  if (dayCount <= WEEKLY_LIMIT) return 'week';
  return 'month';
}

/**
 * A decimal string as whole units of its smallest part — `"12.5"` is `1250n`.
 *
 * <p>Two places after the point, which is what the money columns hold. Anything that is not a
 * plain decimal is zero rather than an exception: a chart is not the place a malformed figure
 * is reported, and the table under it prints the string the service sent.
 */
export function toMinorUnits(amount: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) return 0n;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return sign === '-' ? -units : units;
}

/** The inverse of {@link toMinorUnits}: `1250n` is `"12.50"`. */
export function fromMinorUnits(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Monday of the ISO week a day falls in. */
function weekStart(day: string): string {
  const time = dayToTime(day);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return timeToDay(time - weekday * DAY_MS);
}

function bucketKey(day: string, granularity: ChartGranularity): string {
  if (granularity === 'day') return day;
  if (granularity === 'week') return weekStart(day);
  return day.slice(0, 7);
}

/**
 * The columns for a range: every day in it, summed into periods when the range is long.
 *
 * <p>Entries outside the range are ignored, and two entries for the same day are added together
 * rather than one replacing the other.
 */
export function bucketSeries(points: readonly ChartPoint[], from: string, to: string): ChartSeries {
  const days = daysBetween(from, to);
  const granularity = granularityFor(days.length);

  const byDay = new Map<string, { units: bigint; count: number }>();
  for (const point of points) {
    const held = byDay.get(point.day) ?? { units: 0n, count: 0 };
    byDay.set(point.day, { units: held.units + toMinorUnits(point.amount), count: held.count + point.count });
  }

  const buckets: { from: string; to: string; units: bigint; count: number }[] = [];
  let current: (typeof buckets)[number] | undefined;
  let currentKey: string | undefined;

  for (const day of days) {
    const key = bucketKey(day, granularity);
    if (current === undefined || key !== currentKey) {
      current = { from: day, to: day, units: 0n, count: 0 };
      currentKey = key;
      buckets.push(current);
    }
    const held = byDay.get(day);
    current.to = day;
    if (held !== undefined) {
      current.units += held.units;
      current.count += held.count;
    }
  }

  return {
    granularity,
    buckets: buckets.map((bucket) => ({
      from: bucket.from,
      to: bucket.to,
      amount: fromMinorUnits(bucket.units),
      count: bucket.count,
    })),
  };
}

/** The column with the most money in it, the earliest of equals. Undefined for no columns. */
export function highestBucket(buckets: readonly ChartBucket[]): ChartBucket | undefined {
  let best: ChartBucket | undefined;
  let bestUnits = -1n;
  for (const bucket of buckets) {
    const units = toMinorUnits(bucket.amount);
    if (units > bestUnits) {
      best = bucket;
      bestUnits = units;
    }
  }
  return best;
}

/** The sum of every column, as a decimal string. */
export function totalAmount(buckets: readonly ChartBucket[]): string {
  return fromMinorUnits(buckets.reduce((sum, bucket) => sum + toMinorUnits(bucket.amount), 0n));
}

export interface ChartScale {
  /** The value at the top of the plot. At least the highest column, and a round number. */
  readonly max: number;
  /** Gridline values from zero to {@link max}, in currency units. */
  readonly ticks: readonly number[];
  /** The distance between two gridlines, which decides how many decimals their labels need. */
  readonly step: number;
}

const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

/**
 * Round gridlines over the highest column: 0, 250, 500, 750, 1,000 rather than 0, 233.7, 467.4.
 *
 * <p>Three to five gaps between them, whichever puts the top closest to the peak. A series of zeros still gets an axis — a single step
 * of one unit — so "nothing was pledged" is drawn as a row of columns on a baseline with a scale,
 * not as an empty box.
 */
export function niceScale(peakUnits: bigint, intervals = 4): ChartScale {
  const peak = Number(peakUnits) / 100;
  if (!(peak > 0)) return { max: 1, ticks: [0, 1], step: 1 };

  // Every round step that fits the peak in `intervals - 1` to `intervals + 1` gaps; the one whose top sits
  // closest above the peak wins, and of two equal tops the one with fewer gridlines.
  const magnitude = 10 ** Math.floor(Math.log10(peak / (intervals + 1)));
  let step = magnitude * 10;
  let count = Math.max(1, Math.ceil(peak / step - 1e-9));
  let top = Number.POSITIVE_INFINITY;
  for (const base of [magnitude, magnitude * 10]) {
    for (const nice of NICE_STEPS) {
      const candidate = nice * base;
      const gaps = Math.max(1, Math.ceil(peak / candidate - 1e-9));
      if (gaps > intervals + 1 || gaps < intervals - 1) continue;
      const reached = gaps * candidate;
      if (reached < top - 1e-9 || (Math.abs(reached - top) < 1e-9 && candidate > step)) {
        step = candidate;
        count = gaps;
        top = reached;
      }
    }
  }

  const ticks: number[] = [];
  // Built from the index rather than by repeated addition, so 0.1 + 0.2 never reaches a label.
  for (let index = 0; index <= count; index += 1) ticks.push(Number((index * step).toPrecision(12)));
  return { max: ticks[ticks.length - 1] ?? step, ticks, step };
}

/**
 * Which columns carry a date under the axis: every `step`-th from the first, and the last.
 *
 * <p>No more than `room` of them, because a label every column is unreadable at thirty and
 * overlapping at ninety. The step is a whole number of columns so the labels are evenly spaced —
 * a month axis reads "Oct, Dec, Feb" and never "Oct, Dec, Mar". The last column is labelled too
 * unless it would sit closer than half a step to the one before, in which case it takes that
 * one's place, so the range's end is always named.
 */
export function axisLabelIndices(count: number, room: number): number[] {
  if (count <= 0) return [];
  if (count <= room) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / Math.max(1, room - 1));
  const indices: number[] = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  const last = count - 1;
  const previous = indices[indices.length - 1] ?? 0;
  if (previous !== last) {
    if (last - previous < step / 2 && indices.length > 1) indices[indices.length - 1] = last;
    else indices.push(last);
  }
  return indices;
}
