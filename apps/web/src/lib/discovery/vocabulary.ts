/**
 * The closed vocabularies `GET /v1/discover` defines, and the words this
 * interface puts on them.
 *
 * EVERY VALUE HERE IS COPIED FROM THE SERVICE, not invented. The spellings come
 * from `az.ideanest.discovery.domain` — `DiscoveryStatus`, `DiscoverySort`,
 * `CompletionBand`, `AmountBand` — and the binder refuses anything else with
 * `400 DISCOVERY_VALUE_UNKNOWN` rather than ignoring it, so a typo here is a
 * feed that never loads rather than a filter that quietly does nothing.
 *
 * WHAT IS DELIBERATELY ABSENT. The service declares more than it can serve, and
 * answers the difference with `DISCOVERY_OPTION_UNSUPPORTED` naming the issue
 * that owns it (`DiscoveryCapability`). A control that cannot work is worse than
 * no control: it is a promise the interface breaks the first time somebody uses
 * it. So this module lists only what the tier-1 implementation actually serves,
 * and the gaps are recorded below rather than rendered.
 *
 *   `sort=relevance`                 #44 — the composite ranking
 *   `sort=near_me`, `country`, `city` #47 — no location schema exists
 *   `showOnly=saved`                 no saved-projects table exists
 *   `showOnly=recommended`           #44
 *   `showOnly=featured`              #48
 *
 * `q` (free text) WAS on that list and is not any more: #43 built the search
 * vector and `?q=` now composes with every filter, every sort, the cursor, and
 * the facet counts. It arrives with a sort of its own — see `best_match` below.
 */

/*
 * THE WORDS MOVED TO THE CATALOGUE — issue #324.
 *
 * This module used to pair each value with the label a reader sees. The values are the
 * service's and stay: `DiscoveryValueBinder` refuses anything outside them with
 * `400 DISCOVERY_VALUE_UNKNOWN`, so a typo here is a feed that never loads rather than a filter
 * that quietly does nothing. The labels were copy, and they were the last English on the
 * platform's front door.
 *
 * They are `discovery.filters.{status,sort,completion,amount}` now, keyed by the same value,
 * and `lib/i18n/feed-copy.ts` reads them. A value with no word renders as the value itself,
 * which is what `labelOf` did.
 */

/* -------------------------------------------------------------------------
 * Status — the words §4.3 gives a backer for where a campaign is
 * ---------------------------------------------------------------------- */

/*
 * IDN-EXT-01 (#37): `late_pledge` and `unsuccessful` are gone — late pledges are switched off, and a
 * campaign that ended without succeeding is hidden from the catalogue and search (its page stays).
 * `extended` is new, and is also inside `live`.
 */
export const STATUS_VALUES = ['upcoming', 'live', 'extended', 'successful'] as const;

export type DiscoveryStatus = (typeof STATUS_VALUES)[number];

/** In the order the rail lists them. `discovery.filters.status` names them. */
export const STATUSES: readonly DiscoveryStatus[] = STATUS_VALUES;

/* -------------------------------------------------------------------------
 * Sort
 * ---------------------------------------------------------------------- */

export const SORT_VALUES = [
  'newest',
  'ending_soon',
  'most_funded',
  'most_backed',
  'popularity',
  'best_match',
] as const;

export type DiscoverySort = (typeof SORT_VALUES)[number];

/**
 * `newest`, and the service agrees — `DiscoverySort.DEFAULT`.
 *
 * It is the only order that is meaningful with no filter: ending-soon opens an
 * unfiltered feed on whatever finished longest ago, and the two amount orders
 * open on the same handful of campaigns for everybody for ever.
 */
export const DEFAULT_SORT: DiscoverySort = 'newest';

/**
 * `best_match`, and the service agrees — `DiscoverySort.DEFAULT_WITH_TEXT`.
 *
 * AN UNSTATED SORT MEANS SOMETHING DIFFERENT WHEN THERE IS A QUERY. Ordering
 * search results by launch date puts the campaign that mentions the word once
 * in its ninth paragraph above the one named after it, so `DiscoveryQuery`
 * resolves an absent sort to `best_match` whenever `q` is present — and
 * resolves `best_match` back to `newest` when it is not, because there is then
 * nothing to rank. `defaultSortFor` in `filters.ts` is the client half of the
 * same rule, and it exists so the sort control can show what is actually in
 * force rather than the word it would have shown on an unsearched feed.
 */
export const DEFAULT_SORT_WITH_QUERY: DiscoverySort = 'best_match';

/**
 * `best_match` IS NOT `relevance`. It is `ts_rank` over the search vector — a
 * title match above a blurb match above a story match — and it is the only one
 * of the two that exists. §11.2's relevance is a composite of seven terms, none
 * of which is about what the reader typed; it stays #44's.
 */
export const SORTS: readonly DiscoverySort[] = [
  'best_match',
  'newest',
  'ending_soon',
  'most_funded',
  'most_backed',
  'popularity',
];

/**
 * The orders that can be offered for a given feed.
 *
 * `best_match` HAS NOTHING TO MATCH WITHOUT A QUERY, and the service resolves
 * it straight back to `newest` — so offering it on an unsearched feed would be
 * a control that silently does nothing, which docs/architecture.md §4.3 calls
 * the promise the interface breaks the first time somebody uses it. It appears
 * the moment there is text and disappears when the text is cleared.
 */
export function sortsFor(hasQuery: boolean): readonly DiscoverySort[] {
  return hasQuery ? SORTS : SORTS.filter((value) => value !== 'best_match');
}

/* -------------------------------------------------------------------------
 * Completion
 *
 * Closed below, open above — `[lower, upper)`. The labels say so, because
 * "25–50%" and "50–75%" both look like they contain a campaign standing at
 * exactly 50%, and only one of them does. Exactly 100% is "Funded": the question
 * a backer is asking is "did it make it", and a campaign at its goal did.
 * ---------------------------------------------------------------------- */

export const COMPLETION_VALUES = ['under_25', '25_to_50', '50_to_75', '75_to_100', 'over_100'] as const;

export type CompletionBand = (typeof COMPLETION_VALUES)[number];

export const COMPLETION_BANDS: readonly CompletionBand[] = COMPLETION_VALUES;

/* -------------------------------------------------------------------------
 * Money bands
 *
 * One vocabulary, used by both the goal filter and the amount-raised filter.
 * The amounts are AZN, which is the only currency a campaign may be
 * denominated in today (§21.2), so the label carries the code rather than a
 * symbol — there is no agreed manat symbol in either language the product
 * ships in.
 * ---------------------------------------------------------------------- */

export const AMOUNT_BAND_VALUES = [
  'under_1000',
  '1000_to_5000',
  '5000_to_20000',
  '20000_to_50000',
  'over_50000',
] as const;

export type AmountBand = (typeof AMOUNT_BAND_VALUES)[number];

export const AMOUNT_BANDS: readonly AmountBand[] = AMOUNT_BAND_VALUES;

/* -------------------------------------------------------------------------
 * Narrowing
 *
 * A URL is written by anybody. `?status=finished` is a 400 from the service and
 * so is never sent; the value is dropped on the way in instead, which is the
 * one place where dropping rather than refusing is right — the alternative is
 * an error page for a link somebody mistyped.
 * ---------------------------------------------------------------------- */

function member<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export const isStatus = (value: string): value is DiscoveryStatus => member(STATUS_VALUES, value);
export const isSort = (value: string): value is DiscoverySort => member(SORT_VALUES, value);
export const isCompletionBand = (value: string): value is CompletionBand =>
  member(COMPLETION_VALUES, value);
export const isAmountBand = (value: string): value is AmountBand => member(AMOUNT_BAND_VALUES, value);

/**
 * The reader-facing word for a value, or the value itself if this build has no word for it.
 *
 * The table is the catalogue's rather than this module's since #324, and the fallback is the
 * one `labelOf` always had: a value the service starts returning before the interface knows it
 * renders as itself, which is unfriendly and true, rather than as an empty control.
 */
export function labelOf(words: Readonly<Record<string, string>>, value: string): string {
  return words[value] ?? value;
}
