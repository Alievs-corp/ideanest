import { describe, expect, it } from 'vitest';
import { filenameOf, revenueQuery } from './revenue';

describe('the revenue query', () => {
  it('sends only the filters that were set', () => {
    const query = new URLSearchParams(revenueQuery({ from: '2026-09-01T00:00:00+04:00', method: 'CASH' }));

    expect(query.get('from')).toBe('2026-09-01T00:00:00+04:00');
    expect(query.get('method')).toBe('CASH');
    expect(query.has('to')).toBe(false);
    expect(query.has('planCode')).toBe(false);
    expect(query.has('accountId')).toBe(false);
  });

  it('treats a cleared field as absent, not as a filter for an empty code', () => {
    // `planCode=` would ask for a plan with no code, match nothing, and show zero revenue for
    // a month that had some — to somebody who only cleared a text field.
    const query = new URLSearchParams(revenueQuery({ planCode: '', accountId: null }));

    expect(query.has('planCode')).toBe(false);
    expect(query.has('accountId')).toBe(false);
  });

  it('carries the page size and the cursor only for the list', () => {
    expect(new URLSearchParams(revenueQuery({})).has('limit')).toBe(false);

    const page = new URLSearchParams(revenueQuery({}, { after: 'opaque-cursor', limit: 25 }));
    expect(page.get('limit')).toBe('25');
    expect(page.get('after')).toBe('opaque-cursor');
  });
});

describe('the exported file name', () => {
  it('reads the quoted form', () => {
    expect(filenameOf('attachment; filename="subscription-revenue-2026-09-01_2026-09-30-taken-2026-10-02.csv"')).toBe(
      'subscription-revenue-2026-09-01_2026-09-30-taken-2026-10-02.csv',
    );
  });

  it('prefers the encoded form when the service sends both', () => {
    expect(
      filenameOf(
        "attachment; filename=\"revenue.csv\"; filename*=UTF-8''subscription-revenue-2026-09-01_2026-09-30.csv",
      ),
    ).toBe('subscription-revenue-2026-09-01_2026-09-30.csv');
  });

  it('falls back to a safe name rather than to the route', () => {
    expect(filenameOf(null)).toBe('subscription-revenue.csv');
    expect(filenameOf('attachment')).toBe('subscription-revenue.csv');
  });
});
