import { describe, expect, it } from 'vitest';
import {
  WINDOW_DATE_OPTIONS,
  collectionFrom,
  collectionPath,
  collectionQueryParams,
  collectionsFrom,
  isCollectionKind,
  isOpenCall,
  windowFacts,
} from './collections';

/**
 * Curated collections as both clients read them (#154): which rows can be rendered, the window
 * in the order a reader needs it, and a page request in the contract's own types.
 */

const COPY = { closes: 'Closes', openSince: 'Open since' };

/** The formatter the clients pass, in English, for the assertions to read. */
function englishUtc(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : new Intl.DateTimeFormat('en-GB', WINDOW_DATE_OPTIONS).format(at);
}

describe('collectionFrom', () => {
  it('drops a row with no slug or no title rather than defaulting it', () => {
    expect(collectionFrom({ title: 'Spring picks' })).toBeNull();
    expect(collectionFrom({ slug: 'spring' })).toBeNull();
  });

  it('turns absent fields into nulls, and keeps a cover only when it is whole', () => {
    expect(
      collectionFrom({ slug: 'spring', title: 'Spring', image: { url: 'https://x/a.jpg', width: 1600 } }),
    ).toEqual({
      id: 'spring',
      slug: 'spring',
      kind: '',
      title: 'Spring',
      description: null,
      image: null,
      grantsBadge: false,
      projectCount: 0,
      opensAt: null,
      closesAt: null,
    });
  });

  it('keeps the curator’s order and skips only what cannot be rendered', () => {
    const rows = collectionsFrom([{ slug: 'b', title: 'B' }, { slug: '' }, { slug: 'a', title: 'A' }]);
    expect(rows.map((row) => row.slug)).toEqual(['b', 'a']);
  });
});

describe('the kinds', () => {
  it('knows three and narrows nothing else', () => {
    expect(isCollectionKind('open_call')).toBe(true);
    expect(isCollectionKind('festival')).toBe(false);
    expect(isOpenCall(collectionFrom({ slug: 's', title: 'S', kind: 'open_call' })!)).toBe(true);
    expect(isOpenCall(collectionFrom({ slug: 's', title: 'S', kind: 'themed' })!)).toBe(false);
  });
});

describe('windowFacts', () => {
  it('states the close before the opening', () => {
    const facts = windowFacts(
      { opensAt: '2026-09-01T00:00:00Z', closesAt: '2026-10-15T00:00:00Z' },
      COPY,
      englishUtc,
    );
    expect(facts.map((fact) => fact.term)).toEqual(['Closes', 'Open since']);
    expect(facts[0]?.date).toBe('15 October 2026');
  });

  it('dates an instant in UTC, so 23:30 on the 31st is the 31st everywhere', () => {
    const [fact] = windowFacts({ opensAt: null, closesAt: '2026-10-31T23:30:00Z' }, COPY, englishUtc);
    expect(fact?.date).toBe('31 October 2026');
  });

  it('drops an instant that is not a date, and says nothing for a standing list', () => {
    expect(windowFacts({ opensAt: 'soon', closesAt: null }, COPY, englishUtc)).toEqual([]);
    expect(windowFacts({ opensAt: null, closesAt: null }, COPY, englishUtc)).toEqual([]);
  });
});

describe('paths and paging', () => {
  it('encodes the slug', () => {
    expect(collectionPath('spring picks')).toBe('/collections/spring%20picks');
  });

  it('sends limit as a string, and a cursor only when there is one', () => {
    expect(collectionQueryParams({}, 24)).toEqual({ limit: '24' });
    expect(collectionQueryParams({ cursor: '' }, 24)).toEqual({ limit: '24' });
    expect(collectionQueryParams({ cursor: 'abc', limit: 6 }, 24)).toEqual({ cursor: 'abc', limit: '6' });
  });
});
