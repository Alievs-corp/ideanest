import en from '@ideanest/messages/en.json';
import { filterVocabularyCopyFrom } from '@ideanest/discovery/copy';
import { blameFor } from '@ideanest/discovery/emptiness';
import type { DiscoveryFacets } from '@ideanest/discovery/facets';
import {
  NO_FILTERS,
  activeFilters,
  clearFilters,
  parseFilters,
  removeFilter,
  toSearchParams,
  withQuery,
  type DiscoveryFilters,
} from '@ideanest/discovery/filters';
import { boundsAreOrdered, isValidBound } from '@ideanest/discovery/bounds';

/**
 * The feed's shared logic, run where the app runs it — issue #153.
 *
 * `packages/discovery` is tested under vitest with Node's `URLSearchParams`. The app runs it on
 * Hermes, where `URLSearchParams` is React Native's own "small subset from whatwg-url". The two
 * differ in ways a filter link would notice — RN's splits a string on `&` and `=` by hand and
 * keeps keys in insertion order — so the round trips are repeated here against RN's class, and
 * a difference shows up as a red test rather than as a link that opens the wrong feed.
 */
const { URLSearchParams: NativeSearchParams } = require('react-native/Libraries/Blob/URLSearchParams');

const VOCABULARY = filterVocabularyCopyFrom({
  raw: (key) => (en.discovery.filters as Readonly<Record<string, unknown>>)[key],
});

const FILTERED: DiscoveryFilters = {
  ...NO_FILTERS,
  query: 'solar lamp',
  statuses: ['live', 'extended'],
  categories: ['games'],
  subcategories: ['tabletop'],
  tags: ['handmade', 'eco'],
  completion: ['75_to_100'],
  goal: { bands: ['under_1000'], min: '2500.00', max: '20000' },
  raised: { bands: [], min: null, max: '0' },
  sort: 'ending_soon',
};

describe.each([
  ['Node', globalThis.URLSearchParams],
  ['React Native', NativeSearchParams as typeof URLSearchParams],
])('the shared filters under %s URLSearchParams', (_name, Implementation) => {
  const original = globalThis.URLSearchParams;
  beforeAll(() => {
    globalThis.URLSearchParams = Implementation;
  });
  afterAll(() => {
    globalThis.URLSearchParams = original;
  });

  it('round-trips every dimension through a query string', () => {
    const query = toSearchParams(FILTERED).toString();
    expect(parseFilters(new Implementation(query))).toEqual(FILTERED);
  });

  it('omits the default sort, with and without a query', () => {
    expect(toSearchParams(NO_FILTERS).toString()).toBe('');
    expect(toSearchParams(withQuery(NO_FILTERS, 'lamp')).has('sort')).toBe(false);
  });

  it('reads comma-joined lists and lower-cases slugs, as a pasted link carries them', () => {
    const parsed = parseFilters(new Implementation('category=Games,Comics&status=live,finished'));
    expect(parsed.categories).toEqual(['games', 'comics']);
    expect(parsed.statuses).toEqual(['live']);
  });
});

describe('the shared filter operations', () => {
  it('clears every filter but keeps the query and the sort', () => {
    expect(clearFilters(FILTERED)).toEqual({ ...NO_FILTERS, query: 'solar lamp', sort: 'ending_soon' });
  });

  it('moves only a default sort when the query changes', () => {
    expect(withQuery(NO_FILTERS, 'lamp').sort).toBe('best_match');
    expect(withQuery(withQuery(NO_FILTERS, 'lamp'), '').sort).toBe('newest');
    expect(withQuery(FILTERED, '').sort).toBe('ending_soon');
  });

  it('removes exactly the chip it was given', () => {
    const chips = activeFilters(FILTERED, VOCABULARY);
    const handmade = chips.find((chip) => chip.key === 'tag:handmade');
    expect(handmade).toBeDefined();
    expect(removeFilter(FILTERED, handmade!).tags).toEqual(['eco']);
  });

  it('blames the filters whose facet counts zero', () => {
    const facets: DiscoveryFacets = {
      status: [{ value: 'live', count: 0 }],
      categories: [],
      tags: [],
      completion: [],
      goalAmount: [],
      amountRaised: [],
    };
    const filters: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'], categories: ['games'] };
    const blamed = blameFor(activeFilters(filters, VOCABULARY), facets);
    expect(blamed.map((chip) => chip.key)).toEqual(['status:live', 'category:games']);
  });

  it('validates custom range bounds as decimals', () => {
    expect(isValidBound('abc')).toBe(false);
    expect(isValidBound('2500.00')).toBe(true);
    expect(boundsAreOrdered('5000', '1000')).toBe(false);
  });
});
