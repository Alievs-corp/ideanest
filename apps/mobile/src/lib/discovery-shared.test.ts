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
  searchParamsFrom,
  toSearchParams,
  withQuery,
  type DiscoveryFilters,
} from '@ideanest/discovery/filters';
import { boundsAreOrdered, isValidBound } from '@ideanest/discovery/bounds';

/**
 * The feed's shared logic, run where the app runs it — issue #153.
 *
 * `packages/discovery` is tested under vitest with Node's `URLSearchParams`. The app runs it on
 * Hermes, where `URLSearchParams` is React Native's own "small subset from whatwg-url". Its
 * constructors differ from the standard where a hand-written link lives — `?tag` with no `=`, a
 * second `=` in a value, a stray `%`, an object holding an array — so the app never hands them a
 * link: it builds its params with `searchParamsFrom`, and the round trips run here against RN's
 * class, so a difference is a red test rather than a link that opens the wrong feed.
 *
 * <p>One difference is left alone on purpose: RN's `toString` leaves `'!()~` unencoded where the
 * standard escapes them, so a query string built on the phone is not byte-identical to the web's.
 * Both read back to the same filters, which is what a link has to do.
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
    expect(parseFilters(searchParamsFrom(query))).toEqual(FILTERED);
  });

  it('round-trips text the two encoders escape differently', () => {
    const awkward = withQuery(FILTERED, "kids' (3–6) toys ~ eco! 50% off & more = fun");
    expect(parseFilters(searchParamsFrom(toSearchParams(awkward).toString()))).toEqual(awkward);
  });

  it('reads a router params object, arrays included', () => {
    const parsed = parseFilters(
      searchParamsFrom({ tag: ['handmade', 'eco'], status: 'live', q: undefined }),
    );
    expect(parsed.tags).toEqual(['handmade', 'eco']);
    expect(parsed.statuses).toEqual(['live']);
    expect(parsed.query).toBe('');
  });

  it('survives a parameter with no value, a second "=", and a stray "%"', () => {
    const parsed = parseFilters(searchParamsFrom('?tag&goalMin&q=a=b&category=100%&status=live'));
    expect(parsed.tags).toEqual([]);
    expect(parsed.goal.min).toBeNull();
    expect(parsed.query).toBe('a=b');
    expect(parsed.categories).toEqual(['100%']);
    expect(parsed.statuses).toEqual(['live']);
  });

  it("does not throw on the platform class's own reading of a value-less parameter", () => {
    expect(() => parseFilters(new Implementation('tag&goalMin'))).not.toThrow();
  });

  it('omits the default sort, with and without a query', () => {
    expect(toSearchParams(NO_FILTERS).toString()).toBe('');
    expect(toSearchParams(withQuery(NO_FILTERS, 'lamp')).has('sort')).toBe(false);
  });

  it('reads comma-joined lists and lower-cases slugs, as a pasted link carries them', () => {
    const parsed = parseFilters(searchParamsFrom('category=Games,Comics&status=live,finished'));
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
