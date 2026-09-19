import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { EmptyState } from '@ideanest/ui/server';
import { CampaignGrid } from '../../../../components/browse/CampaignGrid';
import { SearchField } from '../../../../components/search/SearchField';
import { fetchSearchResults } from '../../../../lib/api/server';
import { PAGE_SIZE } from '../../../../lib/discovery/api';
import { NO_FILTERS, toHref } from '../../../../lib/discovery/filters';
import { SEARCH_QUERY_PARAM, readSearchQuery } from '../../../../lib/search/query';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getLocale, getTranslations } from 'next-intl/server';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { projectCardCopy, searchFieldCopy } from '../../../../lib/i18n/shell-copy.server';

/**
 * `/search` — §4.13 WS-06, issue #262.
 *
 * <h2>Why a route of its own, when `/discover?q=` exists</h2>
 *
 * §4.13 draws the line: discovery's panel is a **refinement** surface and this is an **entry
 * point with its own URL**. The header's search field is on every page in the site, and what
 * it needs behind it is somewhere to land — a page whose whole content is "what matches this
 * phrase", reachable from a link somebody sent, with the results in the HTML.
 *
 * The two are not duplicates and they call different endpoints. This reads `GET /v1/search`,
 * which ranks by match quality and refuses a request with no phrase; discovery reads
 * `GET /v1/discover`, which takes a phrase as one narrowing among nine. What is shared is the
 * card, the parameter name, and the trip back: every result page offers the same search
 * inside the feed, one click away, where the filters are.
 *
 * <h2>`noindex`, and it is in `robots.txt` as well</h2>
 *
 * The URL space here is written by whoever types in the box, so every phrase anybody searches
 * for is a URL a crawler could be handed by a referrer log. `lib/seo/indexability.ts` already
 * disallows `/discover?` wholesale for that reason and `/search` is added beside it; the
 * `noindex, nofollow` here is the second lock, for the case where a crawler reaches the page
 * without reading robots.txt first.
 *
 * `nofollow` costs nothing that matters. Every campaign this page can link to is already in
 * the sitemap and on a category page, so there is no discovery path that only runs through a
 * search result.
 *
 * <h2>Rendered on the server, and dynamic on purpose</h2>
 *
 * Reading `searchParams` opts this route out of static rendering, which is correct: there is
 * no such thing as a prerendered answer to a phrase nobody has typed yet.
 */

export const metadata: Metadata = privatePageMetadata({
  title: 'Search',
  description: 'Search every campaign on IdeaNest.',
});

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('discovery.search');
  const locale = localeOrDefault(await getLocale());
  const cardCopy = await projectCardCopy();
  const searchCopy = await searchFieldCopy();
  const query = readSearchQuery(searchParamsOf(await searchParams));

  /*
   * NOTHING IS ASKED OF THE SERVICE FOR AN EMPTY PHRASE. `/v1/search` answers one with a 400
   * (`requireQuery`), so calling it would be spending a request to be refused — and the page
   * that came back would show an error where the reader has simply not typed anything yet.
   */
  const feed = query === '' ? null : await fetchSearchResults(searchQuery(query));
  const results = feed?.items ?? [];
  const hasMore = feed?.nextCursor != null && feed.nextCursor !== '';

  /** The same phrase, inside the feed, where the filters are. */
  const inDiscovery = toHref({ ...NO_FILTERS, query });

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
        {query === '' ? t('title') : t('resultsTitle', { query })}
      </h1>

      <div className="mt-6 max-w-[560px]">
        {/*
          Seeded with the phrase the results answer, so the box says what is on screen after a
          shared link is opened or the back button is pressed — the rule `SearchBox` states
          for the same pair on discovery.
        */}
        <SearchField copy={searchCopy} fullWidth initialQuery={query} />
      </div>

      {query === '' ? (
        <p className="mt-6 max-w-[60ch] text-white/64">
          {t.rich('prompt', {
            feed: (chunks) => (
              <Link
                href="/discover"
                className="text-white underline underline-offset-4 hover:text-white/80"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <>
          {/*
            The count, as text, before the grid. A results page whose only statement of how
            many there are is the number of cards on screen is one a screen-reader user has to
            count.
          */}
          <p className="mt-6 text-sm text-white/64 tabular-nums">
            {/*
              ICU PLURALS RATHER THAN A TERNARY. "campaign" against "campaigns" is the whole
              of English and none of Russian, which has three forms and picks between them by
              the last digit — 1 кампания, 2 кампании, 5 кампаний. A singular/plural split
              would be wrong for most numbers in one of the four languages and there would be
              nothing on screen to say so.
            */}
            {t(hasMore ? 'countMore' : 'count', { count: results.length })}
          </p>

          <div className="mt-8">
            {results.length === 0 ? (
              <EmptyState
                variant="filtered"
                headingLevel={2}
                title={t('emptyTitle', { query })}
                description={t('emptyBody')}
                action={
                  <Link
                    href="/discover"
                    className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
                  >
                    {t('emptyAction')}
                  </Link>
                }
              />
            ) : (
              <>
                <CampaignGrid
                  cardCopy={cardCopy}
                  locale={locale}
                  campaigns={results}
                  priorityCount={3}
                  label={t('gridLabel', { query })}
                />

                {/*
                  NO INFINITE SCROLL HERE, DELIBERATELY. Paging this feed in the browser would
                  mean shipping the cursor machinery to a page whose job is to answer one
                  phrase, and the surface built for reading a long feed is one link away with
                  the same phrase applied. `hasMore` is what makes the offer honest rather
                  than a suggestion.
                */}
                <div className="mt-10 flex justify-center">
                  <Link
                    href={inDiscovery}
                    className="inline-flex h-11 items-center rounded-full border border-white/16 px-6 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
                  >
                    {hasMore ? 'See more results in the feed' : 'Refine these results in the feed'}
                  </Link>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The query string for one search.
 *
 * `PAGE_SIZE` is discovery's, and it is used here on purpose: a reader who follows the link
 * into the feed should not find the results renumbering because the two pages counted
 * differently.
 */
function searchQuery(query: string): string {
  return new URLSearchParams({
    [SEARCH_QUERY_PARAM]: query,
    limit: String(PAGE_SIZE),
  }).toString();
}

/**
 * Next's `searchParams` object as the `URLSearchParams` `readSearchQuery` takes.
 *
 * A repeated parameter stays repeated rather than being flattened — the same conversion
 * `app/(site)/discover/page.tsx` makes, and for the same reason: flattening is a decision
 * about meaning, and it belongs in the parser rather than in the adapter.
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
