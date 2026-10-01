import { countOf, type DiscoveryFacets } from './facets';
import type { ActiveFilter } from './filters';

/**
 * Which filter emptied the feed.
 *
 * "No results" is the least useful sentence an interface can produce. It is
 * indistinguishable from "the platform has nothing", and the reader's only move
 * is to start undoing choices at random until something comes back. The panel
 * already holds the answer, so the empty state says it.
 *
 * HOW IT IS KNOWN. A facet count excludes its own dimension and applies every
 * other (`DiscoveryFacetsApiTests`), so the count beside a chosen value is
 * exactly how many campaigns that value would return under everything else the
 * reader picked. A chosen value counting zero is therefore a value that is
 * incompatible with the rest of the choice — and removing it is the move that
 * brings results back.
 *
 * WHEN NOTHING COUNTS ZERO the filters are jointly responsible rather than
 * individually, and the honest answer is to name all of them. This is the tag
 * case: tags are AND'd, so "handmade" and "ceramics" can each have campaigns
 * behind them while nothing carries both. Blaming one of them would be picking
 * a culprit at random and would send the reader to remove a filter that was not
 * the problem.
 */

/** The facet count for one active filter, or null when there is no count for it. */
function countFor(filter: ActiveFilter, facets: DiscoveryFacets): number | null {
  switch (filter.dimension) {
    case 'status':
      return countOf(facets.status, filter.value);
    case 'completion':
      return countOf(facets.completion, filter.value);
    case 'goalBand':
      return countOf(facets.goalAmount, filter.value);
    case 'raisedBand':
      return countOf(facets.amountRaised, filter.value);
    case 'category':
      return facets.categories.find((entry) => entry.slug === filter.value)?.count ?? 0;
    case 'subcategory':
      return (
        facets.categories
          .flatMap((entry) => entry.subcategories)
          .find((entry) => entry.slug === filter.value)?.count ?? 0
      );
    case 'tag':
      /*
       * The tag facet lists only tags with campaigns behind them, because the
       * vocabulary is free and unbounded — so an absent tag genuinely counts
       * zero rather than being unknown.
       */
      return facets.tags.find((entry) => entry.slug === filter.value)?.count ?? 0;
    case 'goalRange':
    case 'raisedRange':
      /*
       * A custom range has no facet: the bands are a fixed vocabulary and two
       * typed numbers are not. Unknown rather than zero — a range this function
       * cannot count must not be blamed for an emptiness it may have had
       * nothing to do with.
       */
      return null;
  }
}

/**
 * The active filters that account for an empty feed, in the order they appear.
 *
 * Empty when there are no filters at all, which is the other empty feed: the
 * platform has nothing to show, and no amount of removing filters will change
 * that.
 */
export function blameFor(
  active: readonly ActiveFilter[],
  facets: DiscoveryFacets | null,
): readonly ActiveFilter[] {
  if (active.length === 0) return [];
  if (facets === null) return active;

  const impossible = active.filter((filter) => countFor(filter, facets) === 0);

  return impossible.length > 0 ? impossible : active;
}
