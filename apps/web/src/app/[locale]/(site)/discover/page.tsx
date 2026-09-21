import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DiscoverySkeleton } from '../../../../components/discovery/DiscoverySkeleton';
import { DiscoveryView } from '../../../../components/discovery/DiscoveryView';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { fetchDiscoveryFeed } from '../../../../lib/api/server';
import { feedQuery } from '../../../../lib/discovery/api';
import { filterKey, parseFilters } from '../../../../lib/discovery/filters';
import type { SeededFeed } from '../../../../lib/discovery/useDiscoveryFeed';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { discoverPageGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';
import { getLocale, getTranslations } from 'next-intl/server';
import { feedCopy, projectCardCopy } from '../../../../lib/i18n/shell-copy.server';

/**
 * `/discover`, and every filtered variant of it, is one canonical URL.
 *
 * **A STATIC `metadata`, NOT `generateMetadata`.** Reading `searchParams` in
 * `generateMetadata` would let this page emit a per-filter canonical, and one canonical is
 * what is wanted: the filters select a subset of one corpus, so `?category=games` is the
 * same set of campaigns in a different arrangement rather than a page of its own. Indexing
 * every combination would spend the crawl budget for the whole site on permutations of one
 * list.
 *
 * **What changed with #119, and what did not.** This route used to be statically rendered,
 * and the comment here used to give that as the second reason for a static `metadata`.
 * Server-rendering the feed makes the route dynamic — `searchParams` is read below — so
 * that argument no longer applies and is not being kept as though it did. The canonical
 * decision stands on its own, for the reason above.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('discovery.discover');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/discover',
    locale: localeOrDefault(locale),
  });
}

/**
 * `/discover` — docs/architecture.md §4.3, server-rendered since #119.
 *
 * <h2>The first page of the feed is in the HTML</h2>
 *
 * This route is the platform's front door and it used to ship an empty grid: `DiscoveryView`
 * fetched page one from the browser, so a crawler, a link unfurler, and anybody on a slow
 * connection were served a skeleton. #119's requirement is that the content is present in
 * the initial HTML, and the fetch below is what makes that true — for the filters the
 * visitor actually asked for, not just for the unfiltered feed.
 *
 * **The URL is still the state.** `DiscoveryView` reads it with `useSearchParams` and this
 * page reads it from `searchParams`; both go through `parseFilters`, so there is one parser
 * and no second opinion about what `?status=live&sort=ending_soon` means. The seeded page
 * carries the filter key it was fetched for, and the hook shows it only while it answers
 * the question being asked.
 *
 * **A failed read is not a failed page.** `fetchDiscoveryFeed` answers `null` when the
 * service refuses or cannot be reached, and this passes nothing — at which point the view
 * behaves exactly as it did before #119 and fetches page one itself. A visitor whose first
 * request arrives during a restart sees the skeleton and then the feed, rather than an
 * error.
 *
 * <h2>What is deliberately still fetched in the browser</h2>
 *
 * The facet counts beside the filter controls. They are a control panel rather than
 * content: no crawler reads "Games (12)", the numbers move continuously, and putting them in
 * the server render would double the work of the most requested page on the platform to fill
 * in a rail that is off-screen on a phone.
 *
 * <h2>Boundaries</h2>
 *
 * THE `Suspense` BOUNDARY STAYS. `DiscoveryView` reads the query string with
 * `useSearchParams`, and the boundary is what a static render of this route would need; it
 * costs nothing now that the route is dynamic and it is what stops a future change from
 * failing the build. The fallback is the same skeleton the view shows while a client-side
 * page is in flight, so the two are indistinguishable.
 *
 * NOTHING FROM `@ideanest/ui` IS IMPORTED HERE. It is a barrel and several of its members
 * consume `createContext`; reaching it from a Server Component pulls client-only modules
 * into the server graph and the build refuses the route. Both children below carry their own
 * `'use client'`.
 *
 * **THE SITE'S IDENTITY IS NO LONGER CLAIMED HERE.** It was, while this route was the front
 * door in the literal sense: the application answered its own origin with a 404. #264 built
 * `/`, the `Organization` and `WebSite` nodes moved there, and what is left in this page's
 * graph is the trail. Two `Organization` nodes for one organisation across a crawl is exactly
 * what `lib/seo/structured-data/identity.ts` argues against.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(searchParamsOf(await searchParams));

  /*
   * `feedQuery` is the one place that turns filters into the service's parameter names, and
   * it is what the browser sends. Using it here is what makes the server render and the
   * client's own refetch two requests for the same thing rather than two spellings of it.
   */
  const feed = await fetchDiscoveryFeed(feedQuery(filters));
  const seeded: SeededFeed | undefined =
    feed === null ? undefined : { key: filterKey(filters), feed };

  return (
    <>
      <StructuredData nodes={discoverPageGraph(await graphContext())} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
            <DiscoverySkeleton label={(await feedCopy()).loading} />
          </div>
        }
      >
        <DiscoveryView
          {...(seeded === undefined ? {} : { seeded })}
          cardCopy={await projectCardCopy()}
          locale={localeOrDefault(await getLocale())}
          copy={await feedCopy()}
        />
      </Suspense>
    </>
  );
}

/**
 * Next's `searchParams` object as the `URLSearchParams` every parser here takes.
 *
 * A repeated parameter arrives as an array and has to stay repeated: `?tag=a&tag=b` is two
 * tags to `parseFilters` and to `DiscoveryQueryBinder` alike, and flattening it would
 * silently drop every filter but the first.
 */
function searchParamsOf(source: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item);
      continue;
    }
    params.append(name, value);
  }
  return params;
}
