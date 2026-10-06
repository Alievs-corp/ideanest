import { describe, expect, it } from 'vitest';
import type { Money } from '@ideanest/money';
import { TREND_CHART, polylinePoints, readTrend, shareWidths, trendPoints, type TrendDay } from './analytics';

const money = (amount: string): Money => ({ amount, currency: 'AZN' });

function day(date: string, cumulative: string): TrendDay {
  return {
    day: date,
    pledgeCount: 1,
    amount: money('1.00'),
    cumulativePledgeCount: 1,
    cumulativeAmount: money(cumulative),
  };
}

/** Sparse, as the rollup writes it: five days with takings inside a thirty-day range. */
const DAYS: readonly TrendDay[] = [
  day('2026-07-20', '100.00'),
  day('2026-07-23', '150.50'),
  day('2026-08-01', '333.33'),
  day('2026-08-05', '1000.00'),
  day('2026-08-18', '1234.56'),
];

/**
 * What the web's `TrendChart` drew for these fixtures before the geometry moved here, recorded
 * from its own `pointsOf`. Both clients now call `trendPoints`, so this pins that the move did not
 * shift the line.
 */
const WEB_POINTS = [
  { x: 8, y: 195.47589424572317 },
  { x: 80.82758620689656, y: 187.13122083981338 },
  { x: 299.3103448275862, y: 156.92019828926905 },
  { x: 396.41379310344826, y: 46.75894245723173 },
  { x: 712, y: 8 },
];

function expectPoints(actual: readonly { x: number; y: number }[], expected: readonly { x: number; y: number }[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]!.x, 9);
    expect(point.y).toBeCloseTo(expected[index]!.y, 9);
  });
}

describe('the funding trend geometry', () => {
  it('draws the same points the web drew for the same days', () => {
    expectPoints(trendPoints(DAYS, '2026-07-20', '2026-08-18'), WEB_POINTS);
  });

  it('places a day by its date, so a gap in the series stays a gap', () => {
    const points = trendPoints([day('2026-07-20', '1.00'), day('2026-08-18', '2.00')], '2026-07-20', '2026-08-18');
    const tight = trendPoints([day('2026-07-20', '1.00'), day('2026-07-21', '2.00')], '2026-07-20', '2026-08-18');

    expect(points[1]?.x).toBe(TREND_CHART.width - TREND_CHART.padding);
    expect(tight[1]?.x).toBeLessThan(40);
  });

  it('reaches the top of the box at the range peak, and the bottom at zero', () => {
    const points = trendPoints([day('2026-07-20', '0.00'), day('2026-07-21', '50.00')], '2026-07-20', '2026-07-21');

    expect(points[0]?.y).toBe(TREND_CHART.height - TREND_CHART.padding);
    expect(points[1]?.y).toBe(TREND_CHART.padding);
  });

  it('gives a single day one point, which the clients draw as a dot', () => {
    const points = trendPoints([day('2026-08-01', '10.00')], '2026-07-20', '2026-08-18');

    expectPoints(points, [{ x: 299.3103448275862, y: 8 }]);
  });

  it('falls back to position when the range is a single day', () => {
    expectPoints(trendPoints(DAYS.slice(0, 3), '2026-08-01', '2026-08-01'), [
      { x: 8, y: 150.79938799387995 },
      { x: 360, y: 119.89307893078931 },
      { x: 712, y: 8 },
    ]);
  });

  it('draws nothing for an empty range, and a flat baseline when nothing was taken', () => {
    expect(trendPoints([], '2026-07-20', '2026-08-18')).toEqual([]);
    const flat = trendPoints([day('2026-07-20', '0.00'), day('2026-07-21', '0.00')], '2026-07-20', '2026-07-21');
    expect(flat.map((point) => point.y)).toEqual([212, 212]);
  });

  /** Twelve integer digits: a double cannot hold these and the ratio still has to be exact. */
  it('scales twelve-digit amounts without losing precision', () => {
    const points = trendPoints(
      [day('2026-07-20', '499999999999.99'), day('2026-07-21', '999999999999.98')],
      '2026-07-20',
      '2026-07-21',
    );

    expect(points[0]?.y).toBe(TREND_CHART.padding + (TREND_CHART.height - TREND_CHART.padding * 2) / 2);
    expect(points[1]?.y).toBe(TREND_CHART.padding);

    const close = trendPoints(
      [day('2026-07-20', '999999999999.98'), day('2026-07-21', '999999999999.99')],
      '2026-07-20',
      '2026-07-21',
    );
    // One qapik apart on a trillion still lands below the peak, not on it.
    expect(close[0]!.y).toBeGreaterThan(close[1]!.y);
  });

  it('writes the points as an SVG attribute', () => {
    expect(polylinePoints([{ x: 8, y: 212 }, { x: 712, y: 8 }])).toBe('8,212 712,8');
  });
});

describe('reading the trend', () => {
  it('fills the zone and the range, and keeps the amounts as strings', () => {
    const trend = readTrend({
      from: '2026-07-20',
      to: '2026-08-18',
      days: [{ day: '2026-08-01', pledgeCount: 2, amount: money('10.00'), cumulativeAmount: money('10.00') }],
    });

    expect(trend.zone).toBe('UTC');
    expect(trend.computedAt).toBeUndefined();
    expect(trend.days[0]).toEqual({
      day: '2026-08-01',
      pledgeCount: 2,
      amount: money('10.00'),
      cumulativePledgeCount: 0,
      cumulativeAmount: money('10.00'),
    });
  });
});

describe('the share bars', () => {
  it('sizes every bar against the largest amount', () => {
    expect(shareWidths([money('200.00'), money('100.00'), money('50.00')])).toEqual([100, 50, 25]);
  });

  it('keeps a small share visible at two percent', () => {
    expect(shareWidths([money('1000.00'), money('1.00')])).toEqual([100, 2]);
  });

  it('draws nothing when nothing was taken', () => {
    expect(shareWidths([money('0.00'), money('0.00')])).toEqual([0, 0]);
    expect(shareWidths([])).toEqual([]);
  });

  it('rounds to a whole percent from the exact ratio of twelve-digit amounts', () => {
    expect(shareWidths([money('999999999999.99'), money('495000000000.00'), money('494999999999.99')])).toEqual([
      100, 50, 49,
    ]);
  });

  it('treats a malformed amount as nothing rather than breaking the row', () => {
    expect(shareWidths([money('100.00'), money('not a number')])).toEqual([100, 2]);
  });
});
