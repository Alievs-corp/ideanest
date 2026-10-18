import { describe, expect, it } from 'vitest';
import {
  axisLabelIndices,
  bucketSeries,
  daysBetween,
  fromMinorUnits,
  granularityFor,
  highestBucket,
  niceScale,
  toMinorUnits,
  totalAmount,
} from './chart-series';

describe('daysBetween', () => {
  it('lists every day, both ends included, across a month end', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('is empty for a reversed or malformed range', () => {
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([]);
    expect(daysBetween('yesterday', '2026-10-01')).toEqual([]);
  });
});

describe('money in minor units', () => {
  it('reads decimal strings exactly, without floating point', () => {
    expect(toMinorUnits('0.1') + toMinorUnits('0.2')).toBe(toMinorUnits('0.3'));
    expect(toMinorUnits('999999999999.99')).toBe(99999999999999n);
    expect(toMinorUnits('12')).toBe(1200n);
    expect(toMinorUnits('-3.5')).toBe(-350n);
  });

  it('treats a malformed figure as zero rather than throwing inside a render', () => {
    expect(toMinorUnits('1e3')).toBe(0n);
    expect(toMinorUnits('')).toBe(0n);
  });

  it('writes them back at two places', () => {
    expect(fromMinorUnits(1250n)).toBe('12.50');
    expect(fromMinorUnits(5n)).toBe('0.05');
    expect(fromMinorUnits(-350n)).toBe('-3.50');
  });
});

describe('granularityFor', () => {
  it('draws two months by day, half a year by week and a year by month', () => {
    expect(granularityFor(1)).toBe('day');
    expect(granularityFor(62)).toBe('day');
    expect(granularityFor(63)).toBe('week');
    expect(granularityFor(182)).toBe('week');
    expect(granularityFor(365)).toBe('month');
  });
});

describe('bucketSeries', () => {
  it('gives a missing day a zero column instead of closing the gap', () => {
    const series = bucketSeries(
      [
        { day: '2026-10-01', amount: '10.00', count: 1 },
        { day: '2026-10-03', amount: '5.50', count: 2 },
      ],
      '2026-10-01',
      '2026-10-03',
    );

    expect(series.granularity).toBe('day');
    expect(series.buckets).toEqual([
      { from: '2026-10-01', to: '2026-10-01', amount: '10.00', count: 1 },
      { from: '2026-10-02', to: '2026-10-02', amount: '0.00', count: 0 },
      { from: '2026-10-03', to: '2026-10-03', amount: '5.50', count: 2 },
    ]);
  });

  it('ignores days outside the range and adds two entries for the same day', () => {
    const series = bucketSeries(
      [
        { day: '2026-09-30', amount: '99.00', count: 9 },
        { day: '2026-10-01', amount: '0.10', count: 1 },
        { day: '2026-10-01', amount: '0.20', count: 1 },
      ],
      '2026-10-01',
      '2026-10-01',
    );

    expect(series.buckets).toEqual([{ from: '2026-10-01', to: '2026-10-01', amount: '0.30', count: 2 }]);
  });

  it('sums ninety days into Monday weeks, clipping the first and last to the range', () => {
    // 2026-07-21 is a Tuesday; 2026-10-18 is a Sunday.
    const series = bucketSeries([{ day: '2026-07-21', amount: '1.00', count: 1 }, { day: '2026-07-26', amount: '2.00', count: 1 }], '2026-07-21', '2026-10-18');

    expect(series.granularity).toBe('week');
    expect(series.buckets[0]).toEqual({ from: '2026-07-21', to: '2026-07-26', amount: '3.00', count: 2 });
    expect(series.buckets[1]).toMatchObject({ from: '2026-07-27', to: '2026-08-02' });
    expect(series.buckets[series.buckets.length - 1]).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(series.buckets).toHaveLength(13);
  });

  it('sums a year into calendar months', () => {
    const series = bucketSeries([{ day: '2026-02-28', amount: '4.00', count: 4 }], '2025-10-19', '2026-10-18');

    expect(series.granularity).toBe('month');
    expect(series.buckets).toHaveLength(13);
    expect(series.buckets[0]).toMatchObject({ from: '2025-10-19', to: '2025-10-31' });
    expect(series.buckets.find((bucket) => bucket.from === '2026-02-01')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      amount: '4.00',
      count: 4,
    });
  });
});

describe('highestBucket and totalAmount', () => {
  const buckets = [
    { from: 'a', to: 'a', amount: '5.00', count: 1 },
    { from: 'b', to: 'b', amount: '7.25', count: 1 },
    { from: 'c', to: 'c', amount: '7.25', count: 3 },
  ];

  it('picks the earliest of the largest', () => {
    expect(highestBucket(buckets)?.from).toBe('b');
    expect(highestBucket([])).toBeUndefined();
  });

  it('adds exactly', () => {
    expect(totalAmount(buckets)).toBe('19.50');
  });
});

describe('niceScale', () => {
  it('rounds the top up to a readable step', () => {
    expect(niceScale(toMinorUnits('933.70'))).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000], step: 250 });
    expect(niceScale(toMinorUnits('42'))).toEqual({ max: 50, ticks: [0, 10, 20, 30, 40, 50], step: 10 });
    expect(niceScale(toMinorUnits('7'))).toEqual({ max: 7.5, ticks: [0, 2.5, 5, 7.5], step: 2.5 });
  });

  it('never prints a floating-point artefact on a gridline', () => {
    const scale = niceScale(toMinorUnits('0.7'));
    expect(scale.ticks).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('gives a series of zeros an axis', () => {
    expect(niceScale(0n)).toEqual({ max: 1, ticks: [0, 1], step: 1 });
  });

  it('always reaches the highest column', () => {
    for (const peak of ['1', '9.99', '10', '101', '2500', '123456.78']) {
      expect(niceScale(toMinorUnits(peak)).max).toBeGreaterThanOrEqual(Number(peak));
    }
  });
});

describe('axisLabelIndices', () => {
  it('labels every column when there is room', () => {
    expect(axisLabelIndices(5, 6)).toEqual([0, 1, 2, 3, 4]);
  });

  it('always names both ends and spaces the rest', () => {
    const indices = axisLabelIndices(30, 6);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(29);
    expect(indices.length).toBeLessThanOrEqual(6);
  });

  it('spaces labels by a whole number of columns', () => {
    expect(axisLabelIndices(13, 7)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(axisLabelIndices(30, 6)).toEqual([0, 6, 12, 18, 24, 29]);
    // The last would sit one column after 24: it takes that label's place instead.
    expect(axisLabelIndices(26, 6)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(axisLabelIndices(27, 6)).toEqual([0, 6, 12, 18, 26]);
  });

  it('is empty for no columns', () => {
    expect(axisLabelIndices(0, 6)).toEqual([]);
  });
});
