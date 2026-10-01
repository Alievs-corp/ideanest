/**
 * D-10's live faceted counts, the page size, and the two readings every client makes of them.
 *
 * Moved here from `apps/web/src/lib/discovery/api.ts` with the rest of the feed's logic (#153):
 * the empty state's blame, the chips' names and the filter sheet's counts read the same
 * response on a phone as in a browser, and two copies of "which count belongs to which chip"
 * would be two answers to that question. The fetches stay in each application, because how a
 * request is sent is the one part that is genuinely different.
 */

export interface ValueCount {
  value: string;
  count: number;
}

export interface NamedCount {
  slug: string;
  name: string;
  count: number;
}

export interface CategoryCount extends NamedCount {
  subcategories: readonly NamedCount[];
}

/**
 * The response of `GET /v1/discover/facets`.
 *
 * A FACET EXCLUDES ITS OWN DIMENSION and applies every other. That is what
 * makes the panel usable: counted under the category filter already chosen,
 * every other category would read zero, and a backer who picked Games could
 * never learn there are four campaigns in Comics matching everything else they
 * chose. The fixed vocabularies answer for all of their values including the
 * empty ones; `tags` lists only tags with campaigns behind them, because the
 * vocabulary is free and unbounded.
 */
export interface DiscoveryFacets {
  status: readonly ValueCount[];
  categories: readonly CategoryCount[];
  tags: readonly NamedCount[];
  completion: readonly ValueCount[];
  goalAmount: readonly ValueCount[];
  amountRaised: readonly ValueCount[];
}

/**
 * Cards per page.
 *
 * Twenty-four, which is the service's own default and divides exactly by two,
 * three, four, and six — every column count the grid takes between a phone and
 * a wide desktop — so a page never ends in a half-filled row. The app asks for
 * the same number, so "24 projects shown, more available" means the same thing
 * on both.
 */
export const PAGE_SIZE = 24;

/** The count for one value of a fixed vocabulary, or zero when the panel has not loaded. */
export function countOf(counts: readonly ValueCount[] | undefined, value: string): number {
  return counts?.find((entry) => entry.value === value)?.count ?? 0;
}

/**
 * Slug to translated name, over every category, subcategory, and tag the panel
 * carries.
 *
 * One map rather than three: a chip holds a slug and wants a name, and which
 * dimension it came from does not change the answer. Names are localised by the
 * service against `Accept-Language`, which both clients send on every request.
 */
export function slugNames(facets: DiscoveryFacets | null): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (facets === null) return names;

  for (const category of facets.categories) {
    names.set(category.slug, category.name);
    for (const subcategory of category.subcategories) names.set(subcategory.slug, subcategory.name);
  }
  for (const tag of facets.tags) names.set(tag.slug, tag.name);

  return names;
}
