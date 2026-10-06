import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  REPORTED_STATES,
  backerOf,
  backerPageOf,
  backerQuery,
  exportBody,
  exportOf,
  filenameOf,
  filterBody,
  isNarrowed,
  segmentBody,
  segmentOf,
  toggleState,
  type BackerFilter,
} from './backers';

/**
 * §4.7's CD-10 and CD-11, the parts with one right answer (#163):
 *
 *   - **an empty axis is left out**, never sent as `[]` or `""`: the service reads absent as
 *     "any", and an empty list it might one day read as "none";
 *   - a segment and a filter are alternatives, so a read or an export names one of them;
 *   - `X-Export-Truncated` is compared as the string `'true'` — `Boolean('false')` is true.
 */

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

const NARROW: BackerFilter = {
  states: ['CHARGE_FAILED'],
  rewardTierIds: ['tier-1'],
  countries: ['DE'],
  term: '  anna ',
};

describe('the reported states', () => {
  it('are the five the report covers, in the order the chips are drawn', () => {
    expect(REPORTED_STATES).toEqual(['CONFIRMED', 'CHARGE_PENDING', 'CHARGE_FAILED', 'COLLECTED', 'FULFILLED']);
  });
});

describe('isNarrowed', () => {
  it('is false for no filter and for a term of spaces', () => {
    expect(isNarrowed(NO_FILTER)).toBe(false);
    expect(isNarrowed({ ...NO_FILTER, term: '   ' })).toBe(false);
  });

  it.each([
    ['a state', { states: ['CONFIRMED'] }],
    ['a tier', { rewardTierIds: ['tier-1'] }],
    ['a country', { countries: ['AZ'] }],
    ['a term', { term: 'anna' }],
  ] as const)('is true with %s', (_axis, change) => {
    expect(isNarrowed({ ...NO_FILTER, ...change })).toBe(true);
  });
});

describe('toggleState', () => {
  it('adds a state that is off and removes one that is on, keeping the others in order', () => {
    const one = toggleState(NO_FILTER, 'COLLECTED');
    const two = toggleState(one, 'CONFIRMED');
    expect(two.states).toEqual(['COLLECTED', 'CONFIRMED']);
    expect(toggleState(two, 'COLLECTED').states).toEqual(['CONFIRMED']);
  });
});

describe('filterBody', () => {
  it('omits every empty axis', () => {
    expect(filterBody(NO_FILTER)).toEqual({});
    expect(filterBody({ ...NO_FILTER, term: '  ' })).toEqual({});
    expect(Object.keys(filterBody({ ...NO_FILTER, states: ['CONFIRMED'] }))).toEqual(['states']);
  });

  it('sends every narrowed axis, the term trimmed', () => {
    expect(filterBody(NARROW)).toEqual({
      states: ['CHARGE_FAILED'],
      rewardTierIds: ['tier-1'],
      countries: ['DE'],
      term: 'anna',
    });
  });

  it('is what a segment is saved with, under a trimmed name', () => {
    expect(segmentBody('  Germany ', { ...NO_FILTER, countries: ['DE'] })).toEqual({
      name: 'Germany',
      filter: { countries: ['DE'] },
    });
  });
});

describe('exportBody', () => {
  it('names the segment alone when there is one', () => {
    expect(exportBody({ segmentId: 'segment-1', filter: NARROW })).toEqual({ segmentId: 'segment-1' });
  });

  it('otherwise sends the filter, empty axes omitted', () => {
    expect(exportBody({ filter: { ...NO_FILTER, states: ['COLLECTED'] } })).toEqual({
      filter: { states: ['COLLECTED'] },
    });
    expect(exportBody({})).toEqual({ filter: {} });
  });
});

describe('backerQuery', () => {
  it('sends the segment instead of the filter', () => {
    expect(backerQuery({ segmentId: 'segment-1', filter: NARROW, cursor: 'c2' })).toEqual({
      segment: 'segment-1',
      cursor: 'c2',
    });
  });

  it('repeats the list axes and leaves the empty ones out', () => {
    expect(backerQuery({ filter: NARROW, size: 50 })).toEqual({
      state: ['CHARGE_FAILED'],
      rewardTier: ['tier-1'],
      country: ['DE'],
      q: 'anna',
      size: 50,
    });
    expect(backerQuery({ filter: NO_FILTER })).toEqual({});
  });
});

describe('exportOf', () => {
  it('reads the filename, the row count and the truncation flag from the headers', () => {
    const file = exportOf(
      headers({
        'Content-Disposition': 'attachment; filename="backers-2026-10-07.csv"',
        'X-Export-Rows': '10000',
        'X-Export-Truncated': 'true',
      }),
      'name,email\n',
    );
    expect(file).toEqual({ filename: 'backers-2026-10-07.csv', csv: 'name,email\n', rows: 10000, truncated: true });
  });

  it("reads 'false' as not truncated, and a missing header as not truncated", () => {
    expect(exportOf(headers({ 'X-Export-Truncated': 'false', 'X-Export-Rows': '3' }), '').truncated).toBe(false);
    expect(exportOf(headers({}), '').truncated).toBe(false);
    expect(exportOf(headers({}), '').rows).toBe(0);
  });

  it('falls back to a safe filename', () => {
    expect(filenameOf(null)).toBe('backers.csv');
    expect(filenameOf('attachment')).toBe('backers.csv');
    expect(filenameOf('attachment; filename=plain.csv')).toBe('plain.csv');
  });
});

describe('narrowing the contract', () => {
  it('keeps the optional fields absent and fills the rest', () => {
    expect(backerOf({ pledgeId: 'p1', amount: { amount: '10.00', currency: 'AZN' } })).toEqual({
      pledgeId: 'p1',
      name: '',
      email: '',
      anonymous: false,
      rewardTierId: undefined,
      rewardTitle: undefined,
      amount: { amount: '10.00', currency: 'AZN' },
      state: 'CONFIRMED',
      country: undefined,
      backedAt: '',
    });
  });

  it('reads a page with its cursor and the campaign-wide count', () => {
    const page = backerPageOf({ backers: [{ pledgeId: 'p1' }], nextCursor: 'c2', matched: 120 });
    expect(page.backers).toHaveLength(1);
    expect(page.nextCursor).toBe('c2');
    expect(page.matched).toBe(120);
    expect(backerPageOf({}).matched).toBe(0);
  });

  it('reads a segment with an empty filter as no filter', () => {
    expect(segmentOf({ id: 's1', name: 'All' }).filter).toEqual(NO_FILTER);
  });
});
