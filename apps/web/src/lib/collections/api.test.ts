import { describe, expect, it } from 'vitest';
import {
  collectionFrom,
  collectionPath,
  collectionQuery,
  collectionQueryParams,
  collectionsFrom,
  formatWindowDate,
  isOpenCall,
  windowFacts,
  type Collection,
} from './api';

/**
 * The collections client — D-08, issue #266.
 *
 * WHAT THESE COVER:
 *
 *   - **a collection with no slug or no title is dropped, not defaulted.** Without a slug it
 *     has no URL, so a card for it would be a link to nowhere in the site's own crawl path;
 *     without a title the only name left is a curator's internal handle.
 *   - the URL is a path with the slug encoded, because a slug is data.
 *   - an unknown kind costs a label and never a page. The field is widened for exactly this.
 *   - the window is stated as dates, and an unparseable instant is dropped rather than
 *     rendered as `Invalid Date` inside a `<time>` element.
 *   - the paging parameters are the service's own names, and the cursor is absent rather than
 *     empty on the first page.
 */

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'c1',
    slug: 'staff-picks',
    kind: 'staff_selection',
    title: 'Staff picks',
    description: 'What we are reading this month.',
    image: null,
    grantsBadge: false,
    projectCount: 6,
    opensAt: null,
    closesAt: null,
    ...overrides,
  };
}

describe('collectionPath', () => {
  it('is a path rather than a filter, because a curated order is not a filter', () => {
    expect(collectionPath('spring-2026')).toBe('/collections/spring-2026');
  });

  it('encodes the slug, which is data a curator typed', () => {
    expect(collectionPath('a b/c')).toBe('/collections/a%20b%2Fc');
  });
});

describe('reading a collection off the wire', () => {
  it('narrows the fields a page renders', () => {
    const parsed = collectionFrom({
      id: 'c9',
      slug: 'spring-2026',
      kind: 'open_call',
      title: 'Spring 2026',
      description: 'Applications for the spring programme.',
      image: { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900 },
      grantsBadge: true,
      projectCount: 12,
      opensAt: '2026-03-01T00:00:00Z',
      closesAt: '2026-05-31T20:59:59Z',
    });

    expect(parsed).toEqual({
      id: 'c9',
      slug: 'spring-2026',
      kind: 'open_call',
      title: 'Spring 2026',
      description: 'Applications for the spring programme.',
      image: { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900 },
      grantsBadge: true,
      projectCount: 12,
      opensAt: '2026-03-01T00:00:00Z',
      closesAt: '2026-05-31T20:59:59Z',
    });
  });

  it('reads an omitted null as an absent field rather than as a hole', () => {
    // The service serialises with `default-property-inclusion: non_null`, so a collection with
    // no standfirst, no cover and no window has none of those keys at all.
    const parsed = collectionFrom({ id: 'c1', slug: 's', kind: 'themed', title: 'T' });

    expect(parsed?.description).toBeNull();
    expect(parsed?.image).toBeNull();
    expect(parsed?.opensAt).toBeNull();
    expect(parsed?.closesAt).toBeNull();
    expect(parsed?.grantsBadge).toBe(false);
    expect(parsed?.projectCount).toBe(0);
  });

  it('drops a collection with no slug, which would be a link to nowhere', () => {
    expect(collectionFrom({ id: 'c1', title: 'Nameless' })).toBeNull();
  });

  it('drops a collection with no title, because a slug is not a name', () => {
    expect(collectionFrom({ id: 'c1', slug: 'spring-2026' })).toBeNull();
  });

  it('drops a cover that is missing a dimension, keeping the collection', () => {
    // `MediaFrame` reserves a box from a ratio, and a missing height is a reservation nobody
    // can compute. A collection with no cover is an ordinary state; a broken one is not.
    const parsed = collectionFrom({
      slug: 's',
      title: 'T',
      image: { url: 'https://cdn.example/x.jpg', width: 1600 },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.image).toBeNull();
  });

  it('keeps the curator’s order and drops only the unrenderable rows', () => {
    const parsed = collectionsFrom([
      { slug: 'first', title: 'First' },
      { title: 'No slug' },
      { slug: 'second', title: 'Second' },
    ]);

    expect(parsed.map((entry) => entry.slug)).toEqual(['first', 'second']);
  });
});

describe('the kind', () => {
  /*
   * The three names and the "a kind this build does not know renders nothing" rule moved to
   * `discovery.collections.kinds` with #324, and the lookup is now `copy.kinds[kind] ?? null`
   * in the two components that draw the tag. `catalogue.test.ts` asserts the four languages
   * hold the same three keys; what is left here is the predicate that is not copy.
   */

  it('recognises the one kind a campaign is submitted to', () => {
    expect(isOpenCall(collection({ kind: 'open_call' }))).toBe(true);
    expect(isOpenCall(collection({ kind: 'themed' }))).toBe(false);
  });
});

describe('the window', () => {
  /** The English catalogue's two terms. `discovery.collections.window`. */
  const COPY = { closes: 'Closes', openSince: 'Open since' };

  it('states when an open call closes, which is the fact somebody acts on', () => {
    const facts = windowFacts(collection({ closesAt: '2026-05-31T20:59:59Z' }), 'en', COPY);

    expect(facts).toHaveLength(1);
    expect(facts[0]?.term).toBe('Closes');
    expect(facts[0]?.iso).toBe('2026-05-31T20:59:59Z');
    expect(facts[0]?.date).toBe('31 May 2026');
  });

  it('puts the closing before the opening, because the deadline is the decision', () => {
    const facts = windowFacts(
      collection({ opensAt: '2026-03-01T00:00:00Z', closesAt: '2026-05-31T20:59:59Z' }),
      'en',
      COPY,
    );

    expect(facts.map((fact) => fact.term)).toEqual(['Closes', 'Open since']);
  });

  it('says nothing at all for a standing list', () => {
    expect(windowFacts(collection(), 'en', COPY)).toEqual([]);
  });

  it('drops an instant that is not a date, rather than putting Invalid Date in a time element', () => {
    expect(formatWindowDate('soon', 'en')).toBeNull();
    expect(windowFacts(collection({ closesAt: 'soon' }), 'en', COPY)).toEqual([]);
  });

  /**
   * #324. The date was pinned to `en-GB` with a note saying the application could not
   * localise it yet. It can, and the pin is gone; the terms beside it come from the
   * catalogue rather than from a literal in this module.
   */
  it('writes the date in the reader’s own language', () => {
    expect(formatWindowDate('2026-05-31T20:59:59Z', 'az')).toBe('31 may 2026');
    expect(formatWindowDate('2026-05-31T20:59:59Z', 'ru')).toBe('31 мая 2026 г.');
    expect(formatWindowDate('2026-05-31T20:59:59Z', 'tr')).toBe('31 Mayıs 2026');
  });
});

describe('paging', () => {
  it('sends the service its own parameter names', () => {
    expect(collectionQueryParams({ cursor: 'abc', limit: 24 })).toEqual({
      cursor: 'abc',
      limit: '24',
    });
  });

  it('omits the cursor on a first page rather than sending an empty one', () => {
    expect(collectionQueryParams()).toEqual({ limit: '24' });
    expect(collectionQueryParams({ cursor: '' })).toEqual({ limit: '24' });
    expect(collectionQueryParams({ cursor: null })).toEqual({ limit: '24' });
  });

  it('serialises to the same names as a query string', () => {
    expect(collectionQuery({ cursor: 'abc', limit: 2 })).toBe('cursor=abc&limit=2');
  });
});

/*
 * `campaignCount` moved to `discovery.collections.count` with #324. It carried a
 * singular/plural split, which is the whole of English and none of Russian — the catalogue
 * holds four CLDR forms per language and `packages/messages/src/plurals.ts` selects between them.
 */
