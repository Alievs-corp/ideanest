import {
  DEFAULT_SORT,
  DEFAULT_SORT_WITH_QUERY,
  isAmountBand,
  isCompletionBand,
  isSort,
  isStatus,
  labelOf,
  type AmountBand,
  type CompletionBand,
  type DiscoverySort,
  type DiscoveryStatus,
} from './vocabulary';
import type { FilterVocabularyCopy } from './copy';
import { fillPlaceholders } from '@ideanest/messages/placeholders';

/**
 * The filter, sort, and range state of the discovery feed — and the URL it is
 * written to.
 *
 * THE URL IS THE STATE. D-12 asks for shareable filter URLs, and everything
 * that decides which campaigns are shown lives in the query string: a filtered
 * feed is linkable, survives a reload, and the back button undoes a filter
 * rather than leaving the page. React state holding the same thing would be a
 * second copy to keep in step, and the one that loses is always the URL.
 *
 * THE CURSOR IS NOT IN THE URL, and that is a decision rather than an omission.
 * Two reasons, and the second is the one that settles it:
 *
 *   1. A shared link should open a fresh first page. Somebody who pastes the
 *      feed they are reading into a message is sharing "campaigns in Games,
 *      ending soon", not "page seven of my scroll" — and page seven of somebody
 *      else's scroll is a feed that opens halfway down with no way to know what
 *      was skipped.
 *   2. A cursor is bound to the query it was issued for. `DiscoveryQuery`
 *      fingerprints the filters and the sort into it, and replaying one against
 *      a different filter set is answered `400 DISCOVERY_CURSOR_MISMATCH`. A
 *      cursor in the URL would therefore be a link that 400s the moment the
 *      recipient touched a filter — or, worse, an entry in the back stack that
 *      does.
 *
 * The parameter names and value spellings are the service's own
 * (`DiscoveryQueryBinder`); this module never invents one.
 */

export interface AmountFilter {
  readonly bands: readonly AmountBand[];
  /**
   * A decimal string, or null. NEVER A NUMBER — this bound is compared against
   * `goal_amount` server-side, so it is money and money never touches floating
   * point (CLAUDE.md §3). It is carried as the digits the reader typed and
   * validated with `decimal.js` before it is applied.
   */
  readonly min: string | null;
  readonly max: string | null;
}

export interface DiscoveryFilters {
  /**
   * D-01's free text, as it was typed. Empty means no search.
   *
   * IT LIVES IN THE URL WITH THE FILTERS, for the reason all of them do: a
   * searched feed has to be linkable, survive a reload, and come back from the
   * back button. It is NOT a filter dimension — there is no chip for it and no
   * facet counts it (docs/architecture.md §4.3) — but it narrows the same set,
   * so it belongs in the same query string under the service's own name, `q`.
   *
   * Trimmed, and never folded. Folding is the service's (`ideanest_fold`), and
   * a client that folded would show the reader "secenek" where they typed
   * "seç" — their own language spelled wrong back at them.
   */
  readonly query: string;
  readonly statuses: readonly DiscoveryStatus[];
  readonly categories: readonly string[];
  readonly subcategories: readonly string[];
  readonly tags: readonly string[];
  readonly completion: readonly CompletionBand[];
  readonly goal: AmountFilter;
  readonly raised: AmountFilter;
  readonly sort: DiscoverySort;
}

export const NO_AMOUNT_FILTER: AmountFilter = { bands: [], min: null, max: null };

export const NO_FILTERS: DiscoveryFilters = {
  query: '',
  statuses: [],
  categories: [],
  subcategories: [],
  tags: [],
  completion: [],
  goal: NO_AMOUNT_FILTER,
  raised: NO_AMOUNT_FILTER,
  sort: DEFAULT_SORT,
};

/* -------------------------------------------------------------------------
 * Reading a URL
 * ---------------------------------------------------------------------- */

/**
 * Every value of one parameter, accepting both forms the binder does.
 *
 * `?tag=a&tag=b` is what a form produces and `?tag=a,b` is what a shared link
 * looks like; the service takes either, and so does this, or a link copied out
 * of the address bar would come back meaning something else.
 */
function values(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    /*
     * A string check rather than a type assertion: React Native's `URLSearchParams` stores
     * `undefined` for a parameter written without `=` (`?tag`), where the standard stores `''`.
     * The app builds its params with `searchParamsFrom`, which never does that; this keeps a
     * native instance built elsewhere from throwing on `.split`.
     */
    .filter((raw): raw is string => typeof raw === 'string')
    .flatMap((raw) => raw.split(','))
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Slugs are lower case everywhere in the schema, and the service folds them. */
function slugs(params: URLSearchParams, name: string): readonly string[] {
  return unique(values(params, name).map((value) => value.toLowerCase()));
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

/**
 * A money bound as it was written, or null.
 *
 * Kept as a string rather than parsed: this is the value that goes back onto
 * the wire, and a round trip through a number would put a campaign on the wrong
 * side of a boundary it sits exactly on. `isValidBound` is what decides whether
 * it may be applied at all.
 */
function bound(params: URLSearchParams, name: string): string | null {
  const raw: unknown = params.get(name);
  if (typeof raw !== 'string') return null; // `undefined` on React Native; see `values`.
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function amountFilter(params: URLSearchParams, prefix: 'goal' | 'raised'): AmountFilter {
  return {
    bands: unique(values(params, `${prefix}Band`).filter(isAmountBand)),
    min: bound(params, `${prefix}Min`),
    max: bound(params, `${prefix}Max`),
  };
}

/** One parameter's values as a router hands them over: one, several, or none. */
export type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * A `URLSearchParams` built the same way on every runtime, from a query string or from a
 * router's params object.
 *
 * WHY NOT `new URLSearchParams(input)`. On Hermes that is React Native's own "small subset from
 * whatwg-url", and its constructors disagree with the standard exactly where a hand-written or
 * truncated link lives: `?tag` (no `=`) is stored as `undefined`, `?q=a=b` keeps only `a`, a
 * stray `%` throws a `URIError`, and an object whose value is an array is stored as one array
 * rather than as several values. Parsing here and `append`ing the strings means the app reads a
 * link exactly as the browser does: the first `=` splits, `+` is a space, a parameter with no
 * value is empty, and an undecodable part is kept as written instead of taking the screen down.
 */
export function searchParamsFrom(input: string | RawParams): URLSearchParams {
  const params = new URLSearchParams();

  if (typeof input === 'string') {
    for (const pair of input.replace(/^\?/, '').split('&')) {
      if (pair === '') continue;
      const split = pair.indexOf('=');
      const name = split === -1 ? pair : pair.slice(0, split);
      const value = split === -1 ? '' : pair.slice(split + 1);
      params.append(decodePart(name), decodePart(value));
    }
    return params;
  }

  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const one of typeof value === 'string' ? [value] : value) params.append(name, one);
  }
  return params;
}

function decodePart(part: string): string {
  const spaced = part.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/**
 * The filters a query string asks for.
 *
 * An unrecognised value of a CLOSED vocabulary is dropped rather than kept.
 * The service answers `?status=finished` with a 400, so keeping it would turn a
 * mistyped link into an error page; dropping it shows the feed the rest of the
 * link asked for. An unrecognised SLUG is kept, because the service treats it
 * as an empty result rather than an error — categories and tags are data and
 * change without a deployment, and a link shared before a rename should say
 * "nothing here" rather than silently widen to everything.
 */
export function parseFilters(params: URLSearchParams): DiscoveryFilters {
  const query = params.get('q')?.trim() ?? '';

  return {
    query,
    statuses: unique(values(params, 'status').filter(isStatus)),
    categories: slugs(params, 'category'),
    subcategories: slugs(params, 'subcategory'),
    tags: slugs(params, 'tag'),
    completion: unique(values(params, 'completion').filter(isCompletionBand)),
    goal: amountFilter(params, 'goal'),
    raised: amountFilter(params, 'raised'),
    sort: parseSort(params.get('sort'), query),
  };
}

/**
 * The order a query string asks for, resolved exactly as `DiscoveryQuery` does.
 *
 * Two rules, both the service's, and both here so that the sort control can
 * show the order that is actually in force rather than the one the URL happens
 * to spell:
 *
 *   - AN UNSTATED SORT RESOLVES TO `best_match` WHEN THERE IS TEXT. Otherwise
 *     `/discover?q=ceramics` would say "Newest" while the service was ranking
 *     by match quality, and the control would be lying about what the reader is
 *     looking at.
 *   - `best_match` WITH NO TEXT RESOLVES BACK TO `newest`, because it has
 *     nothing to rank. A reader who searches, chooses nothing, and then clears
 *     the box is put back on the default rather than left on an order the
 *     service quietly stopped honouring.
 */
function parseSort(raw: string | null, query: string): DiscoverySort {
  const fallback = defaultSortFor(query);
  if (raw === null || !isSort(raw)) return fallback;
  return raw === DEFAULT_SORT_WITH_QUERY && query === '' ? DEFAULT_SORT : raw;
}

/** The order in force when the URL names none. See `parseSort`. */
export function defaultSortFor(query: string): DiscoverySort {
  return query === '' ? DEFAULT_SORT : DEFAULT_SORT_WITH_QUERY;
}

/* -------------------------------------------------------------------------
 * Writing a URL
 * ---------------------------------------------------------------------- */

function appendList(params: URLSearchParams, name: string, list: readonly string[]): void {
  if (list.length > 0) params.set(name, list.join(','));
}

function appendAmount(params: URLSearchParams, prefix: 'goal' | 'raised', filter: AmountFilter): void {
  appendList(params, `${prefix}Band`, filter.bands);
  if (filter.min !== null) params.set(`${prefix}Min`, filter.min);
  if (filter.max !== null) params.set(`${prefix}Max`, filter.max);
}

/**
 * The query string for a filter set, in a fixed parameter order.
 *
 * The default sort is omitted rather than written. `/discover` and
 * `/discover?sort=newest` are the same feed, and printing the default into
 * every link makes the shortest, most-shared URL the noisiest one — and makes
 * "did the reader choose this order" unanswerable from the URL.
 *
 * WHICH default depends on whether there is a query, because the service's does
 * — see `defaultSortFor`. `?q=ceramics` alone means best match and `?q=ceramics`
 * with `sort=newest` means the reader overrode it, and both round-trip.
 */
export function toSearchParams(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams();

  // `q` first: it is the thing the reader typed, and it is what makes a shared
  // link legible at a glance.
  if (filters.query !== '') params.set('q', filters.query);
  appendList(params, 'status', filters.statuses);
  appendList(params, 'category', filters.categories);
  appendList(params, 'subcategory', filters.subcategories);
  appendList(params, 'tag', filters.tags);
  appendList(params, 'completion', filters.completion);
  appendAmount(params, 'goal', filters.goal);
  appendAmount(params, 'raised', filters.raised);
  if (filters.sort !== defaultSortFor(filters.query)) params.set('sort', filters.sort);

  return params;
}

/** The path the address bar should hold for these filters. */
export function toHref(filters: DiscoveryFilters, pathname = '/discover'): string {
  const query = toSearchParams(filters).toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/**
 * A stable key for a filter set.
 *
 * Everything that decides which campaigns come back and in what order, and
 * nothing else — the same rule `DiscoveryQuery.fingerprint()` follows on the
 * server. It is what tells the feed hook that the query changed and the pages
 * it is holding are no longer answers to the question being asked.
 */
export function filterKey(filters: DiscoveryFilters): string {
  return toSearchParams(filters).toString();
}

/* -------------------------------------------------------------------------
 * Money bounds
 * ---------------------------------------------------------------------- */

export { isValidBound, boundsAreOrdered } from './bounds';

/* -------------------------------------------------------------------------
 * Toggling
 * ---------------------------------------------------------------------- */

function toggle<T>(list: readonly T[], value: T): readonly T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function toggleStatus(filters: DiscoveryFilters, value: DiscoveryStatus): DiscoveryFilters {
  return { ...filters, statuses: toggle(filters.statuses, value) };
}

/**
 * Ticks or unticks a primary category.
 *
 * Subcategories are left alone. The two filters are independent server-side and
 * AND'd — "Games, and subcategory Tabletop" and "subcategory Tabletop" are both
 * expressible — so clearing the children here would silently widen a filter the
 * reader did not touch. Both appear as their own chips, so either can be
 * removed on its own.
 */
export function toggleCategory(filters: DiscoveryFilters, slug: string): DiscoveryFilters {
  return { ...filters, categories: toggle(filters.categories, slug) };
}

export function toggleSubcategory(filters: DiscoveryFilters, slug: string): DiscoveryFilters {
  return { ...filters, subcategories: toggle(filters.subcategories, slug) };
}

export function toggleTag(filters: DiscoveryFilters, slug: string): DiscoveryFilters {
  return { ...filters, tags: toggle(filters.tags, slug) };
}

export function toggleCompletion(filters: DiscoveryFilters, value: CompletionBand): DiscoveryFilters {
  return { ...filters, completion: toggle(filters.completion, value) };
}

export function toggleAmountBand(
  filters: DiscoveryFilters,
  dimension: 'goal' | 'raised',
  value: AmountBand,
): DiscoveryFilters {
  const current = filters[dimension];
  return { ...filters, [dimension]: { ...current, bands: toggle(current.bands, value) } };
}

export function withAmountRange(
  filters: DiscoveryFilters,
  dimension: 'goal' | 'raised',
  range: { min: string | null; max: string | null },
): DiscoveryFilters {
  return { ...filters, [dimension]: { ...filters[dimension], ...range } };
}

/**
 * Every filter dropped; the sort and the search text kept.
 *
 * "Clear all" is about the narrowing, not about the order. Somebody who chose
 * "ending soon" and then over-filtered wants their campaigns back in the order
 * they picked; resetting that too would be a second, unasked-for change hidden
 * behind one control.
 *
 * THE QUERY IS NOT A FILTER and survives for the same reason. It has no chip
 * and no facet, the panel never counted it, and "clear all filters" pressed on
 * a search for "ceramics" must not silently throw away what was typed —
 * emptying the search box is what the search box is for.
 */
export function clearFilters(filters: DiscoveryFilters): DiscoveryFilters {
  return { ...NO_FILTERS, query: filters.query, sort: filters.sort };
}

/* -------------------------------------------------------------------------
 * Free text
 * ---------------------------------------------------------------------- */

/**
 * The filter set searching for something else.
 *
 * THE FILTERS SURVIVE THE SEARCH. `?q=` composes with every filter server-side
 * and narrows the set the facets are counted over, so a reader who has picked
 * Games and then types a word is narrowing what they were already looking at.
 * Dropping their choices at the first keystroke would be the search box
 * quietly undoing the panel beside it.
 *
 * A SORT THAT WAS THE DEFAULT STAYS THE DEFAULT, and one the reader chose is
 * kept. Which order is the default depends on whether there is text — see
 * `defaultSortFor` — so the two cases are:
 *
 *   - typing into an unsearched feed nobody had reordered moves `newest` to
 *     `best_match`, exactly as the service moves it. Carrying `newest` across
 *     would write `?q=games&sort=newest` for a reader who never touched the
 *     sort control, and would rank a search by launch date.
 *   - emptying the box moves `best_match` back to `newest`, because
 *     `best_match` has nothing to rank and the service resolves it away — so
 *     leaving it would put a word in the URL that the feed does not obey.
 *
 * `ending_soon` survives both, because it is a choice rather than a default.
 *
 * A reader who explicitly picks the order that is already the default is
 * indistinguishable from one who picked nothing, and is treated as the latter.
 * That is the cost of `toSearchParams` omitting the default rather than writing
 * it, and it is the right trade: it keeps the shortest, most-shared URL the
 * quietest one.
 */
export function withQuery(filters: DiscoveryFilters, query: string): DiscoveryFilters {
  const text = query.trim();
  const wasDefault = filters.sort === defaultSortFor(filters.query);

  return { ...filters, query: text, sort: wasDefault ? defaultSortFor(text) : filters.sort };
}

/**
 * A category, subcategory, or tag ADDED to the filter set — not toggled.
 *
 * This is what choosing a suggestion of that kind does, and toggling would be
 * wrong for it: a reader who picks "Games" from the list is asking for Games,
 * and if Games is already ticked the honest answer is "you already have it",
 * never "then I shall remove it". `toggleCategory` and its siblings stay the
 * contract of the CHECKBOX, where pressing an on control is a request to turn
 * it off.
 */
export function addSlugFilter(
  filters: DiscoveryFilters,
  dimension: 'category' | 'subcategory' | 'tag',
  slug: string,
): DiscoveryFilters {
  const value = slug.toLowerCase();

  switch (dimension) {
    case 'category':
      return { ...filters, categories: unique([...filters.categories, value]) };
    case 'subcategory':
      /*
       * The parent category is NOT added alongside it. The two filters are
       * independent and AND'd server-side, so adding both would narrow the feed
       * twice for one choice — and the reader asked for tabletop games, not for
       * tabletop games that are also filed under Games.
       */
      return { ...filters, subcategories: unique([...filters.subcategories, value]) };
    case 'tag':
      return { ...filters, tags: unique([...filters.tags, value]) };
  }
}

/* -------------------------------------------------------------------------
 * The active set, as removable chips
 * ---------------------------------------------------------------------- */

/** Which control a chip came from. Used to route its removal, and to blame it. */
export type FilterDimension =
  | 'status'
  | 'category'
  | 'subcategory'
  | 'tag'
  | 'completion'
  | 'goalBand'
  | 'raisedBand'
  | 'goalRange'
  | 'raisedRange';

export interface ActiveFilter {
  /** Unique within one active set, and stable across renders. */
  readonly key: string;
  readonly dimension: FilterDimension;
  /** The wire value, or the slug. Empty for a custom range, which has no single value. */
  readonly value: string;
  /** What the reader chose, in their words. */
  readonly label: string;
  /** Which control it came from, for the chip's accessible name. */
  readonly group: string;
}

/**
 * Names for slugs, which are data rather than a vocabulary this build knows.
 *
 * The facet response carries the translated name of every category, subcategory
 * and tag it counts, so a chip can say "Tabletop games" rather than "tabletop".
 * When the panel has not loaded — or the slug came from a link and matches
 * nothing — the slug itself is the label, which is worse than the name and much
 * better than an empty chip.
 */
export type SlugNames = ReadonlyMap<string, string>;

function nameFor(names: SlugNames | undefined, slug: string): string {
  return names?.get(slug) ?? slug;
}

function rangeLabel(
  min: string | null,
  max: string | null,
  copy: FilterVocabularyCopy,
): string | null {
  if (min !== null && max !== null) return fillPlaceholders(copy.range.between, { min, max });
  if (min !== null) return fillPlaceholders(copy.range.from, { min });
  if (max !== null) return fillPlaceholders(copy.range.upTo, { max });
  return null;
}

/**
 * Every filter currently narrowing the feed, one entry per removable thing.
 *
 * A custom range is ONE entry rather than two, because a minimum and a maximum
 * are one thought — removing half of "2,500 to 20,000" leaves a filter nobody
 * asked for. The bands beside it are separate entries, because ticking two
 * bands is two independent choices.
 */
export function activeFilters(
  filters: DiscoveryFilters,
  copy: FilterVocabularyCopy,
  names?: SlugNames,
): readonly ActiveFilter[] {
  const active: ActiveFilter[] = [];

  for (const value of filters.statuses) {
    active.push({
      key: `status:${value}`,
      dimension: 'status',
      value,
      label: labelOf(copy.status, value),
      group: copy.groups.status,
    });
  }
  for (const slug of filters.categories) {
    active.push({
      key: `category:${slug}`,
      dimension: 'category',
      value: slug,
      label: nameFor(names, slug),
      group: copy.groups.category,
    });
  }
  for (const slug of filters.subcategories) {
    active.push({
      key: `subcategory:${slug}`,
      dimension: 'subcategory',
      value: slug,
      label: nameFor(names, slug),
      group: copy.groups.subcategory,
    });
  }
  for (const value of filters.completion) {
    active.push({
      key: `completion:${value}`,
      dimension: 'completion',
      value,
      label: labelOf(copy.completion, value),
      group: copy.groups.completion,
    });
  }
  for (const value of filters.goal.bands) {
    active.push({
      key: `goalBand:${value}`,
      dimension: 'goalBand',
      value,
      label: labelOf(copy.amount, value),
      group: copy.groups.goal,
    });
  }
  const goalRange = rangeLabel(filters.goal.min, filters.goal.max, copy);
  if (goalRange !== null) {
    active.push({
      key: 'goalRange',
      dimension: 'goalRange',
      value: '',
      label: goalRange,
      group: copy.groups.goal,
    });
  }
  for (const value of filters.raised.bands) {
    active.push({
      key: `raisedBand:${value}`,
      dimension: 'raisedBand',
      value,
      label: labelOf(copy.amount, value),
      group: copy.groups.raised,
    });
  }
  const raisedRange = rangeLabel(filters.raised.min, filters.raised.max, copy);
  if (raisedRange !== null) {
    active.push({
      key: 'raisedRange',
      dimension: 'raisedRange',
      value: '',
      label: raisedRange,
      group: copy.groups.raised,
    });
  }
  for (const slug of filters.tags) {
    active.push({
      key: `tag:${slug}`,
      dimension: 'tag',
      value: slug,
      label: nameFor(names, slug),
      group: copy.groups.tag,
    });
  }

  return active;
}

/** The filter set with one active entry taken out of it. */
export function removeFilter(filters: DiscoveryFilters, filter: ActiveFilter): DiscoveryFilters {
  switch (filter.dimension) {
    case 'status':
      return { ...filters, statuses: filters.statuses.filter((v) => v !== filter.value) };
    case 'category':
      return { ...filters, categories: filters.categories.filter((v) => v !== filter.value) };
    case 'subcategory':
      return { ...filters, subcategories: filters.subcategories.filter((v) => v !== filter.value) };
    case 'tag':
      return { ...filters, tags: filters.tags.filter((v) => v !== filter.value) };
    case 'completion':
      return { ...filters, completion: filters.completion.filter((v) => v !== filter.value) };
    case 'goalBand':
      return { ...filters, goal: { ...filters.goal, bands: filters.goal.bands.filter((v) => v !== filter.value) } };
    case 'raisedBand':
      return {
        ...filters,
        raised: { ...filters.raised, bands: filters.raised.bands.filter((v) => v !== filter.value) },
      };
    case 'goalRange':
      return { ...filters, goal: { ...filters.goal, min: null, max: null } };
    case 'raisedRange':
      return { ...filters, raised: { ...filters.raised, min: null, max: null } };
  }
}
