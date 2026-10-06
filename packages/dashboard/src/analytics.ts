import Decimal from 'decimal.js';
import type { components } from '@ideanest/api-client';
import type { Money } from '@ideanest/money';

/**
 * §4.7's CD-02: what a campaign took, day by day, and the geometry both clients draw it with
 * (#163). The web's `TrendChart` and the app's chart plot the same points from the same data
 * because they call the same function.
 *
 * Read from `GET /v1/projects/{id}/analytics`, which is #95's pre-aggregated rollup rather than a
 * scan of pledges. Two consequences every screen has to respect:
 *
 * - **The series is sparse.** A day on which the campaign took nothing has no entry at all.
 *   Every day carries its own running total for exactly that reason, so a line is read off
 *   `cumulativeAmount` and never accumulated across the array.
 * - **It is as fresh as the last rollup**, which is why `computedAt` comes back and why the panel
 *   prints it. A stalled aggregator and a quiet week produce the same flat line, and that field is
 *   the only thing that tells them apart.
 */

type ContractAnalytics = components['schemas']['ProjectAnalyticsResponse'];

/** One campaign-day. */
export interface TrendDay {
  /** `YYYY-MM-DD` in the platform's calendar, which `zone` names. */
  readonly day: string;
  readonly pledgeCount: number;
  readonly amount: Money;
  readonly cumulativePledgeCount: number;
  readonly cumulativeAmount: Money;
}

/** A campaign's daily trend over a range of calendar days. */
export interface Trend {
  /** The IANA zone the days were bucketed in. Printed, so a reader never has to guess. */
  readonly zone: string;
  readonly from: string;
  readonly to: string;
  /** Absent when the range holds nothing — not the campaign's currency, which would imply zero. */
  readonly currency?: string;
  /** ISO-8601 instant of the newest rollup in the range. Absent when there are no days. */
  readonly computedAt?: string;
  /** Ascending, and sparse: a day with no pledges has no entry. */
  readonly days: readonly TrendDay[];
}

/** The wire shape, narrowed once. Asking for no range is the service's last thirty days. */
export function readTrend(body: ContractAnalytics): Trend {
  return {
    zone: body.timeZone ?? 'UTC',
    from: body.from ?? '',
    to: body.to ?? '',
    ...(body.currency === undefined ? {} : { currency: body.currency }),
    ...(body.computedAt === undefined ? {} : { computedAt: body.computedAt }),
    days: (body.days ?? []).map((day) => ({
      day: day.day ?? '',
      pledgeCount: day.pledgeCount ?? 0,
      amount: day.amount as Money,
      cumulativePledgeCount: day.cumulativePledgeCount ?? 0,
      cumulativeAmount: day.cumulativeAmount as Money,
    })),
  };
}

/**
 * The drawing box. Fixed, and scaled by the viewBox: the chart is fluid, its geometry is not.
 * Both clients draw into `0 0 width height`.
 */
export const TREND_CHART = { width: 720, height: 220, padding: 8 } as const;

/** One point of the line, in viewBox units. */
export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The line's points.
 *
 * <p>x is the day's position inside the requested range, so a quiet fortnight keeps its width
 * and a gap is a gap; y is its running total against the range's own peak, so the line always
 * reaches the top of the box. Scaling to the goal was the alternative and is worse here: a
 * campaign at four percent would be a flat line along the bottom for its whole first month, which
 * is the period a creator most needs to see the shape of.
 *
 * <p>The ratio is `decimal.js` from the amount strings, and only the finished pixel coordinate
 * becomes a number. One point is a single day, which a client draws as a dot: a one-point line
 * draws nothing, which would show a campaign that took its first pledge as one that took none.
 */
export function trendPoints(days: readonly TrendDay[], from: string, to: string): readonly ChartPoint[] {
  if (days.length === 0) return [];

  const { width, height, padding } = TREND_CHART;
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  const span = Number.isFinite(first) && Number.isFinite(last) && last > first ? last - first : 0;

  const peak = days.reduce(
    (highest, day) => Decimal.max(highest, amountOf(day.cumulativeAmount)),
    new Decimal(0),
  );
  const plotWidth = new Decimal(width - padding * 2);
  const plotHeight = new Decimal(height - padding * 2);

  return days.map((day, index) => {
    const at = Date.parse(`${day.day}T00:00:00Z`);
    const across =
      span === 0 || !Number.isFinite(at)
        ? // A single-day range, or a day that will not parse: fall back to position, which is
          // exact when there is one point and honest when there are two.
          days.length === 1
          ? 0
          : index / (days.length - 1)
        : Math.min(1, Math.max(0, (at - first) / span));

    const up = peak.lessThanOrEqualTo(0) ? new Decimal(0) : amountOf(day.cumulativeAmount).div(peak);

    return {
      x: plotWidth.times(across).plus(padding).toNumber(),
      // SVG's y grows downward, so the tallest value is the smallest coordinate.
      y: new Decimal(1).minus(up).times(plotHeight).plus(padding).toNumber(),
    };
  });
}

/** The points as an SVG `points` attribute. */
export function polylinePoints(points: readonly ChartPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

/**
 * Each bar's width, as a whole percentage of the widest — the share bars under "Rewards and
 * destinations".
 *
 * <p>Relative to the largest row rather than the campaign's total, because the question is
 * "which of these is bigger" and scaling to a total makes every bar short on a campaign with many
 * tiers. A floor of two percent, so a tier that sold one small reward is a visible mark rather
 * than nothing — a bar of zero width and a missing row look the same. All zero when nothing was
 * taken.
 *
 * <p>The amounts are parsed exactly and the ratio is computed exactly; what becomes a number is a
 * length between 2 and 100 that is about to be rounded to a pixel anyway.
 */
export function shareWidths(amounts: readonly Money[]): readonly number[] {
  const largest = amounts.reduce((widest, amount) => Decimal.max(widest, amountOf(amount)), new Decimal(0));
  if (largest.lessThanOrEqualTo(0)) return amounts.map(() => 0);
  return amounts.map((amount) =>
    Math.max(2, amountOf(amount).div(largest).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()),
  );
}

/** The amount as an exact decimal. A missing or malformed one is nothing, not a broken layout. */
function amountOf(money: Money | undefined): Decimal {
  try {
    return new Decimal(money?.amount ?? 0);
  } catch {
    return new Decimal(0);
  }
}
