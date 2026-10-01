import { fetchCategories, fetchDiscoveryFeed } from '../api/server';
import { PAGE_SIZE, feedQuery, type ProjectCard } from '../discovery/api';
import { NO_FILTERS } from '@ideanest/discovery/filters';
import { findCategory, findSubcategory, type Category, type Subcategory } from './api';

/**
 * What a category landing page needs, resolved once — §4.13 WS-05.
 *
 * <h2>Why this is not written twice in two `page.tsx` files</h2>
 *
 * `generateMetadata` and the page component are two functions that each need the same
 * category, and there are two routes (a category and a subcategory) that each need both. That
 * is four resolutions of the same slug, and the failure mode of writing them separately is
 * specific and bad: a `generateMetadata` that resolved a category the page then 404s produces
 * a page with a real `<title>` and a not-found body.
 *
 * Next dedupes concurrent `fetch` calls for the same URL within one request, and both reads
 * below go through `lib/api/server.ts`, so calling this from `generateMetadata` and again from
 * the page costs one round trip rather than two.
 */

/** The taxonomy could not be read, the slug names nothing, or here is the page. */
export type CategoryLandingResult =
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'found';
      readonly category: Category;
      readonly subcategory: Subcategory | null;
      readonly campaigns: readonly ProjectCard[];
      readonly hasMore: boolean;
    };

/**
 * A category page, or the fact that there is not one.
 *
 * **A SLUG THAT NAMES NOTHING IS A 404, AND SO IS A TAXONOMY THAT COULD NOT BE READ.** The
 * second is the uncomfortable one and it is still right: without the tree there is no name to
 * put in the heading, no children to list, and no way to know the slug is real — so the
 * alternative is a page titled with a slug, listing whatever the service happens to return for
 * a filter nobody can confirm exists. A 404 is recoverable and a page that invents a category
 * is not.
 *
 * The campaigns are read even when the tree read fails, because they are independent and
 * concurrent; the result is discarded in that branch. Serialising them to avoid one wasted
 * request would add a round trip to every successful page, which is the common case.
 */
export async function resolveCategoryLanding(
  categorySlug: string,
  subcategorySlug?: string,
): Promise<CategoryLandingResult> {
  const [tree, feed] = await Promise.all([
    fetchCategories(),
    fetchDiscoveryFeed(landingQuery(categorySlug, subcategorySlug)),
  ]);

  if (tree === null) return { kind: 'not-found' };

  const category = findCategory(tree, categorySlug);
  if (category === null) return { kind: 'not-found' };

  if (subcategorySlug === undefined) {
    return {
      kind: 'found',
      category,
      subcategory: null,
      campaigns: feed?.items ?? [],
      hasMore: hasMoreIn(feed),
    };
  }

  const subcategory = findSubcategory(category, subcategorySlug);
  if (subcategory === null) return { kind: 'not-found' };

  return {
    kind: 'found',
    category,
    subcategory,
    campaigns: feed?.items ?? [],
    hasMore: hasMoreIn(feed),
  };
}

/**
 * The feed query behind a landing page.
 *
 * `newest`, which is `NO_FILTERS`'s own default and the service's. A landing page is somebody
 * arriving from a search result with no opinion about ordering yet, and `vocabulary.ts` gives
 * the argument: it is the only order that is meaningful without a filter, because ending-soon
 * opens on whatever finished longest ago.
 *
 * The category is sent alongside the subcategory rather than instead of it, so that the
 * request and the URL the page offers into the feed are the same filter set.
 */
function landingQuery(categorySlug: string, subcategorySlug?: string): string {
  return feedQuery(
    subcategorySlug === undefined
      ? { ...NO_FILTERS, categories: [categorySlug] }
      : { ...NO_FILTERS, categories: [categorySlug], subcategories: [subcategorySlug] },
    { limit: PAGE_SIZE },
  );
}

/** A short page is not the end of a feed — only the absence of a cursor is (`api.ts`). */
function hasMoreIn(feed: { nextCursor?: string | null } | null): boolean {
  const cursor = feed?.nextCursor;
  return cursor != null && cursor !== '';
}
