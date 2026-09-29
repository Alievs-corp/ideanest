import { fetchCollection } from '../api/server';
import type { ProjectCard } from '../discovery/api';
import { PAGE_SIZE, type Collection } from './api';
import { fillPlaceholders } from '../i18n/placeholders';

/**
 * What a collection landing page needs, resolved once — D-08, §4.13 WS-04.
 *
 * <h2>Why this is not written twice in one `page.tsx`</h2>
 *
 * `generateMetadata` and the page component each need the same collection, and the failure
 * mode of resolving it separately is specific and bad: a `generateMetadata` that resolved a
 * collection the page then 404s produces a page with a real `<title>`, a canonical URL and a
 * social card over a not-found body. `lib/categories/landing.ts` makes the same argument for
 * the same reason and this is the same shape.
 *
 * Next dedupes concurrent `fetch` calls for the same URL within one request, and both calls
 * go through `lib/api/server.ts`, so calling this from `generateMetadata` and again from the
 * page costs one round trip rather than two.
 *
 * <h2>One read, unlike a category</h2>
 *
 * A category page needs two: the taxonomy to confirm the slug is real, and the feed for the
 * campaigns. A collection needs one, because `GET /v1/collections/{slug}` answers both
 * questions at once — the collection and its first page arrive together, in the curator's
 * order, which is the ordering no filter on the feed can reproduce.
 *
 * That also means there is no "the collection exists but its list could not be read" branch
 * here, and there is nothing to invent one from. It is one request; it either answered or it
 * did not.
 */

/** The slug names nothing a reader may see, or here is the page. */
export type CollectionLandingResult =
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'found';
      readonly collection: Collection;
      /** The first page, in the curator's order. */
      readonly campaigns: readonly ProjectCard[];
      /** The token for the page after this one, or `null` on the last page. */
      readonly nextCursor: string | null;
    };

/**
 * A collection page, or the fact that there is not one.
 *
 * <h2>EVERY REFUSAL IS THE SAME ANSWER, AND THAT IS DELIBERATE</h2>
 *
 * `fetchCollection` answers `null` for a slug that names nothing, for a collection that has
 * not been published, for one outside its window, and for a service that could not be
 * reached. The first three are indistinguishable **by design** — `CollectionController`
 * explains that a 403 would confirm to anybody who guesses `/collections/spring-2027` that
 * the platform is preparing something under that name — and this function must not undo it by
 * telling the four apart.
 *
 * The fourth is the uncomfortable one and it is still the same answer, for the reason
 * `resolveCategoryLanding` gives about a taxonomy that could not be read: without the
 * response there is no title for the heading, no standfirst, no cover, and no way to know the
 * slug is real. The alternative is a page titled with a slug, listing nothing, at a URL a
 * crawler will index and re-crawl forever. A 404 is recoverable; a page that invents a
 * collection is not.
 */
export async function resolveCollectionLanding(slug: string): Promise<CollectionLandingResult> {
  const landing = await fetchCollection(slug, { limit: PAGE_SIZE });
  if (landing === null) return { kind: 'not-found' };

  return {
    kind: 'found',
    collection: landing.collection,
    campaigns: landing.items,
    nextCursor: landing.nextCursor,
  };
}

/**
 * What a collection says about itself in a search result and a shared link.
 *
 * **THE CURATOR'S OWN STANDFIRST, WHEN THERE IS ONE.** It is the sentence they wrote for
 * exactly this purpose, and a generated description would be us paraphrasing somebody else's
 * editorial — the same mistake `projectSocialDescription` refuses to make with a campaign's
 * blurb.
 *
 * When there is none, the fallback names the collection and states what it is, and stops. It
 * invents no count and no deadline: a description is cached by crawlers and unfurlers for
 * days, and `projectCount` moves whenever a campaign in the collection ends.
 *
 * <p>THE FALLBACK ARRIVES AS AN ARGUMENT since #324. It is the one sentence here this platform
 * writes rather than the curator, and it is served under `/ru/collections/…` like everything
 * else on the page. It carries `{title}`, which the route fills; The brand's name is inside the message
 * rather than concatenated onto it, because "on IdeyaNest" is a preposition in four languages
 * and Turkish attaches it to the noun.
 */
export function collectionSocialDescription(collection: Collection, fallback: string): string {
  const standfirst = collection.description?.trim() ?? '';
  if (standfirst !== '') return standfirst;

  return fillPlaceholders(fallback, { title: collection.title });
}
