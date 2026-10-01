import { describe, expect, it } from 'vitest';
import { VOCABULARY } from './test-vocabulary';
import {
  NO_FILTERS,
  activeFilters,
  addSlugFilter,
  withQuery,
  boundsAreOrdered,
  clearFilters,
  filterKey,
  isValidBound,
  parseFilters,
  removeFilter,
  toHref,
  toSearchParams,
  toggleTag,
} from './filters';

/**
 * The URL is the state, so this is the file that decides whether a shared
 * filter link means the same thing to the person who receives it (D-12).
 *
 * The tests that carry the design are the round trip, the refusal to put a
 * cursor in the URL, and the money bounds — the last because a filter bound is
 * money and a bound that has been through a JavaScript number cannot be trusted
 * again.
 */

const params = (query: string): URLSearchParams => new URLSearchParams(query);

describe('parseFilters', () => {
  it('reads every dimension the service implements', () => {
    const filters = parseFilters(
      params(
        'status=live&category=games&subcategory=tabletop&tag=handmade&completion=under_25' +
          '&goalBand=1000_to_5000&goalMin=1000&goalMax=5000&raisedBand=under_1000&sort=most_funded',
      ),
    );

    expect(filters.statuses).toEqual(['live']);
    expect(filters.categories).toEqual(['games']);
    expect(filters.subcategories).toEqual(['tabletop']);
    expect(filters.tags).toEqual(['handmade']);
    expect(filters.completion).toEqual(['under_25']);
    expect(filters.goal).toEqual({ bands: ['1000_to_5000'], min: '1000', max: '5000' });
    expect(filters.raised.bands).toEqual(['under_1000']);
    expect(filters.sort).toBe('most_funded');
  });

  it('takes both the repeated form and the comma form', () => {
    // A form produces `?tag=a&tag=b`; a shared link is `?tag=a,b`. The binder
    // accepts either, so a link copied out of the address bar must not come
    // back meaning something else.
    expect(parseFilters(params('tag=a&tag=b')).tags).toEqual(['a', 'b']);
    expect(parseFilters(params('tag=a,b')).tags).toEqual(['a', 'b']);
    expect(parseFilters(params('tag=a,b&tag=c')).tags).toEqual(['a', 'b', 'c']);
  });

  it('drops a value that is not one of a closed vocabulary', () => {
    // `?status=finished` is a 400 from the service. Keeping it would turn a
    // mistyped link into an error page; dropping it shows the rest of the link.
    expect(parseFilters(params('status=finished&status=live')).statuses).toEqual(['live']);
    expect(parseFilters(params('sort=cheapest')).sort).toBe('newest');
    expect(parseFilters(params('completion=nearly')).completion).toEqual([]);
  });

  it('keeps a slug that names nothing', () => {
    // Categories and tags are data and change without a deployment. The service
    // answers an unknown slug with an empty feed rather than an error, so a link
    // shared before a rename says "nothing here" rather than widening to
    // everything.
    expect(parseFilters(params('category=underwater-basketweaving')).categories).toEqual([
      'underwater-basketweaving',
    ]);
  });

  it('folds a slug to lower case, as the service does', () => {
    expect(parseFilters(params('category=Games')).categories).toEqual(['games']);
  });

  it('defaults the sort to newest', () => {
    // The service's own default, and the only order that is meaningful with no
    // filter applied.
    expect(parseFilters(params('')).sort).toBe('newest');
  });
});

describe('toSearchParams', () => {
  it('round trips a filter set', () => {
    const original = parseFilters(
      params('status=live,upcoming&category=games&tag=a,b&goalMin=100&sort=ending_soon'),
    );

    expect(parseFilters(toSearchParams(original))).toEqual(original);
  });

  it('omits the default sort', () => {
    // `/discover` and `/discover?sort=newest` are the same feed. Printing the
    // default into every link makes the most-shared URL the noisiest one.
    expect(toHref(NO_FILTERS)).toBe('/discover');
    expect(toHref({ ...NO_FILTERS, sort: 'popularity' })).toBe('/discover?sort=popularity');
  });

  it('never writes a cursor', () => {
    // A shared link opens a fresh first page, not page seven of somebody else's
    // scroll — and a cursor is bound to the query it was issued for, so one in
    // the URL would 400 the moment the recipient touched a filter.
    const href = toHref(parseFilters(params('status=live&cursor=abc123')));

    expect(href).not.toContain('cursor');
    expect(href).toBe('/discover?status=live');
  });

  it('keys a filter set by everything that decides the results', () => {
    const a = parseFilters(params('status=live&sort=newest'));
    const b = parseFilters(params('status=live'));
    const c = parseFilters(params('status=upcoming'));

    expect(filterKey(a)).toBe(filterKey(b));
    expect(filterKey(a)).not.toBe(filterKey(c));
  });
});

/**
 * Free text, and the order it brings with it.
 *
 * The rule these pin is the service's own: an unstated sort resolves to
 * `best_match` when there is a query and to `newest` when there is not
 * (`DiscoveryQuery`, `DiscoverySort.DEFAULT_WITH_TEXT`). It is duplicated on
 * the client for one reason — so the sort control can display the order that is
 * actually in force. A control reading "Newest" over a feed the service ranked
 * by match quality is a control that lies.
 */
describe('free text', () => {
  it('carries the query under the service’s own parameter name', () => {
    expect(parseFilters(params('q=ceramics')).query).toBe('ceramics');
    expect(toHref(withQuery(NO_FILTERS, 'ceramics'))).toBe('/discover?q=ceramics');
  });

  it('trims what was typed, and treats blank as no search', () => {
    expect(parseFilters(params('q=%20%20')).query).toBe('');
    expect(parseFilters(params('q=%20ceramics%20')).query).toBe('ceramics');
    expect(toHref(withQuery(NO_FILTERS, '   '))).toBe('/discover');
  });

  it('round trips a search alongside its filters', () => {
    const original = parseFilters(params('q=ceramics&category=games&sort=ending_soon'));

    expect(parseFilters(toSearchParams(original))).toEqual(original);
  });

  it('resolves an unstated sort to best match when there is a query', () => {
    expect(parseFilters(params('q=ceramics')).sort).toBe('best_match');
    expect(parseFilters(params('')).sort).toBe('newest');
  });

  it('resolves best match back to newest when there is nothing to rank', () => {
    // The service does exactly this, so a URL that asked for it would be
    // answered in a different order than the one it names.
    expect(parseFilters(params('sort=best_match')).sort).toBe('newest');
  });

  it('omits whichever sort is the default for the feed it describes', () => {
    // `?q=ceramics` alone means best match, and printing it would make the
    // shortest, most-shared URL the noisiest one.
    expect(toHref(withQuery(NO_FILTERS, 'ceramics'))).toBe('/discover?q=ceramics');
    expect(toHref({ ...withQuery(NO_FILTERS, 'ceramics'), sort: 'newest' })).toBe(
      '/discover?q=ceramics&sort=newest',
    );
  });

  it('moves a default sort to the new default, and keeps a chosen one', () => {
    // Nobody reordered this feed, so searching it ranks by match quality.
    expect(withQuery(NO_FILTERS, 'ceramics').sort).toBe('best_match');
    // And clearing the box puts it back, because best match has nothing to rank.
    expect(withQuery(parseFilters(params('q=ceramics')), '').sort).toBe('newest');
    // A chosen order survives both directions.
    expect(withQuery(parseFilters(params('sort=ending_soon')), 'ceramics').sort).toBe(
      'ending_soon',
    );
    expect(withQuery(parseFilters(params('q=ceramics&sort=ending_soon')), '').sort).toBe(
      'ending_soon',
    );
  });

  it('keys a searched feed apart from an unsearched one', () => {
    // The query decides which campaigns come back, so it belongs in the key the
    // feed hook refetches on — the same rule the server's fingerprint follows.
    expect(filterKey(withQuery(NO_FILTERS, 'ceramics'))).not.toBe(filterKey(NO_FILTERS));
  });

  it('survives clearing the filters, because it is not one', () => {
    // "Clear all filters" must not silently throw away what was typed: emptying
    // the search box is what the search box is for.
    const filters = parseFilters(params('q=ceramics&category=games&status=live'));

    expect(clearFilters(filters).query).toBe('ceramics');
    expect(clearFilters(filters).categories).toEqual([]);
  });
});

describe('addSlugFilter', () => {
  it('adds rather than toggles, so choosing what is already chosen is a no-op', () => {
    // A reader who picks "Games" from the suggestion list is asking for Games.
    // If Games is already ticked the honest answer is "you already have it",
    // never "then I shall remove it" — which is what a toggle would do.
    const once = addSlugFilter(NO_FILTERS, 'category', 'games');
    const twice = addSlugFilter(once, 'category', 'games');

    expect(twice.categories).toEqual(['games']);
  });

  it('folds the slug to lower case, as the service does', () => {
    expect(addSlugFilter(NO_FILTERS, 'tag', 'Handmade').tags).toEqual(['handmade']);
  });

  it('leaves the parent category alone when a subcategory is applied', () => {
    const filters = addSlugFilter(NO_FILTERS, 'subcategory', 'tabletop');

    // The two are independent and AND'd server-side; adding both would narrow
    // the feed twice for one choice.
    expect(filters.subcategories).toEqual(['tabletop']);
    expect(filters.categories).toEqual([]);
  });
});

describe('activeFilters', () => {
  const names = new Map([
    ['games', 'Games'],
    ['tabletop', 'Tabletop games'],
    ['handmade', 'Handmade'],
  ]);

  it('names every applied filter with its group and its translated label', () => {
    const filters = parseFilters(
      params('status=live&category=games&subcategory=tabletop&tag=handmade&completion=over_100'),
    );

    expect(activeFilters(filters, VOCABULARY, names).map((f) => [f.group, f.label])).toEqual([
      ['Status', 'Live'],
      ['Category', 'Games'],
      ['Subcategory', 'Tabletop games'],
      ['Completion', 'Funded — 100% or more'],
      ['Tag', 'Handmade'],
    ]);
  });

  it('falls back to the slug when the panel has not named it', () => {
    expect(activeFilters(parseFilters(params('tag=ceramics')), VOCABULARY).at(0)?.label).toBe('ceramics');
  });

  it('treats a custom range as one filter, not two', () => {
    // A minimum and a maximum are one thought. Removing half of "2,500 to
    // 20,000" leaves a filter nobody asked for.
    const active = activeFilters(parseFilters(params('goalMin=2500&goalMax=20000')), VOCABULARY);

    expect(active).toHaveLength(1);
    expect(active.at(0)?.label).toBe('2500 to 20000 AZN');
  });

  it('is empty with no filters, whatever the sort', () => {
    expect(activeFilters(parseFilters(params('sort=most_backed')), VOCABULARY)).toEqual([]);
  });
});

describe('removeFilter', () => {
  it('removes exactly the one named, from every dimension', () => {
    const filters = parseFilters(params('status=live,upcoming&tag=a,b&goalBand=under_1000'));
    const active = activeFilters(filters, VOCABULARY);

    const withoutLive = removeFilter(filters, active.find((f) => f.value === 'live')!);
    expect(withoutLive.statuses).toEqual(['upcoming']);
    expect(withoutLive.tags).toEqual(['a', 'b']);

    const withoutTag = removeFilter(filters, active.find((f) => f.value === 'a')!);
    expect(withoutTag.tags).toEqual(['b']);

    const withoutBand = removeFilter(filters, active.find((f) => f.dimension === 'goalBand')!);
    expect(withoutBand.goal.bands).toEqual([]);
  });

  it('clears both ends of a custom range together', () => {
    const filters = parseFilters(params('raisedMin=100&raisedMax=900'));
    const cleared = removeFilter(filters, activeFilters(filters, VOCABULARY)[0]!);

    expect(cleared.raised).toEqual({ bands: [], min: null, max: null });
  });
});

describe('clearFilters', () => {
  it('drops every filter and keeps the order the reader chose', () => {
    // "Clear all" is about the narrowing, not the order. Resetting the sort too
    // would be a second, unasked-for change hidden behind one control.
    const cleared = clearFilters(parseFilters(params('status=live&tag=a&sort=ending_soon')));

    expect(activeFilters(cleared, VOCABULARY)).toEqual([]);
    expect(cleared.sort).toBe('ending_soon');
  });
});

describe('toggleTag', () => {
  it('adds and removes without disturbing the rest', () => {
    const once = toggleTag(NO_FILTERS, 'handmade');
    expect(once.tags).toEqual(['handmade']);
    expect(toggleTag(once, 'handmade').tags).toEqual([]);
  });
});

describe('money bounds', () => {
  it('accepts the amounts the API accepts', () => {
    expect(isValidBound('2500')).toBe(true);
    expect(isValidBound('2500.00')).toBe(true);
    // Zero is a real bound here, unlike a goal or a reward price: "raised up to
    // 0" asks for the campaigns nobody has backed yet.
    expect(isValidBound('0')).toBe(true);
    expect(isValidBound(null)).toBe(true);
    expect(isValidBound('')).toBe(true);
  });

  it('refuses what a JavaScript number would silently swallow', () => {
    // `Number()` accepts every one of these and loses the value. A bound that
    // has been through one can never be trusted again.
    expect(isValidBound('1e5')).toBe(false);
    expect(isValidBound('0x10')).toBe(false);
    expect(isValidBound('12abc')).toBe(false);
    expect(isValidBound('Infinity')).toBe(false);
    expect(isValidBound('-100')).toBe(false);
    expect(isValidBound('1,50')).toBe(false);
  });

  it('orders bounds as decimals, not as strings or floats', () => {
    expect(boundsAreOrdered('1000', '5000')).toBe(true);
    expect(boundsAreOrdered('5000', '1000')).toBe(false);
    // '100' sorts below '99' as a string, and '9.99' below '10' only by
    // accident. Both are compared as decimals here.
    expect(boundsAreOrdered('99', '100')).toBe(true);
    expect(boundsAreOrdered('9.99', '10')).toBe(true);
    expect(boundsAreOrdered('10', '9.99')).toBe(false);
    // Equal ends are a range of exactly one amount, which is legitimate.
    expect(boundsAreOrdered('5000.00', '5000')).toBe(true);
  });
});
