'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '../../i18n/navigation';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { FadeUp } from '@ideanest/ui/motion';
import type { ApiError } from '../../lib/api/problem';
import { PAGE_SIZE, slugNames } from '../../lib/discovery/api';
import { blameFor } from '../../lib/discovery/emptiness';
import {
  activeFilters,
  clearFilters,
  parseFilters,
  removeFilter,
  toHref,
  withQuery,
  type ActiveFilter,
  type DiscoveryFilters,
} from '../../lib/discovery/filters';
import { useDiscoveryFacets } from '../../lib/discovery/useDiscoveryFacets';
import { useDiscoveryFeed, type SeededFeed } from '../../lib/discovery/useDiscoveryFeed';
import { ActiveFilters } from './ActiveFilters';
import { DiscoverySkeleton } from './DiscoverySkeleton';
import { FilterRail } from './FilterRail';
import { ProjectCard } from './ProjectCard';
import { SearchBox } from './SearchBox';
import { SortControl } from './SortControl';
import type { ProjectCardCopy } from '../../lib/i18n/card-copy';
import type { FeedCopy } from '../../lib/i18n/feed-copy';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import type { Locale } from '../../lib/i18n/locale';

/**
 * Discovery: the filter rail, the sort control, the applied-filter chips, and
 * D-04's cursor-paginated feed.
 *
 * THE URL IS THE STATE. Every filter and the sort live in the query string, so
 * a filtered feed is linkable (D-12), survives a reload, and comes back
 * unchanged from the back button. Nothing about the results is duplicated in
 * React state; `parseFilters` reads the address bar on every render and that
 * reading is the single source of truth.
 *
 * `push`, NOT `replace`, ON A FILTER CHANGE. It costs a history entry per tick,
 * and it buys the thing people actually do with a filter panel: over-narrow,
 * then undo. Back is the control everybody already knows for that, and
 * `replace` would silently take it away — leaving the only way out a control
 * the reader has to find. The cursor stays out of the URL for the reason
 * `filters.ts` gives, so a back press lands on a filter set rather than
 * halfway down somebody's scroll.
 *
 * INFINITE SCROLL IS THE ENHANCEMENT, NOT THE MECHANISM. There is a real
 * "Show more projects" button, and the observer presses it when the sentinel
 * comes into view. The other way round — an observer with a button bolted on —
 * is how a feed becomes unreachable by keyboard and by screen reader, because
 * neither produces a scroll event that intersects anything. The button is also
 * what a reader gets when the observer is unavailable.
 *
 * MOTION. One `FadeUp`, on the page heading, once. Discovery's budget is
 * "skeleton to content crossfade only" (docs/motion-system.md §5) and §8
 * forbids animation in long lists outright — fifty animated cards produce
 * visible jank exactly where speed outranks everything.
 */

/** How far ahead of the sentinel the next page is fetched. */
const PREFETCH_MARGIN = '400px 0px';

/**
 * The service's own words for a refusal, never a generic apology.
 *
 * RFC 9457 (§10.4) gives every failure a `title`, a `detail`, and a `code`. The
 * endpoint knows which of its rules refused the request and this function does
 * not, so the prose it wrote is what is shown — "'finished' is not a value that
 * status takes" is actionable and "something went wrong" is not. `code` is what
 * anything branches on; `detail` is never matched against.
 */
function describeProblem(error: ApiError | null, copy: FeedCopy): { title: string; detail: string } {
  const problem = error?.problem ?? null;

  if (problem === null) {
    return { title: copy.errorTitle, detail: copy.unreachable };
  }

  return {
    title: problem.title ?? copy.errorTitle,
    detail: problem.detail ?? copy.refused,
  };
}

/**
 * What names the results list — #129.
 *
 * A constant rather than `useId()`: this is the only list on the surface and the identifier
 * appears twice in one component, so a generated one would buy nothing and would make the
 * markup differ between the server render and the hydration.
 */
const RESULTS_HEADING_ID = 'discovery-results-heading';

export interface DiscoveryViewProps {
  /**
   * The first page of the feed, already fetched by the Server Component — #119.
   *
   * **Absent is a supported state, not a degraded one.** The page passes nothing when the
   * service refused the read, and this view then fetches page one in the browser exactly as
   * it always did: the server render is what puts the cards in the HTML, and it is not what
   * makes the feed work. A visitor whose first request landed while the service was
   * restarting sees the skeleton and then the feed, rather than an error page.
   *
   * It carries the filter key it was fetched for. See `SeededFeed`.
   */
  readonly seeded?: SeededFeed;
  /** The card's words, resolved by the route — see `lib/i18n/card-copy.ts`. */
  readonly cardCopy: ProjectCardCopy;
  /** The language, for the card's two counted sentences and the feed's own. */
  readonly locale: Locale;
  /** Every word this surface draws — see `lib/i18n/feed-copy.ts`. */
  readonly copy: FeedCopy;
}

export function DiscoveryView({ seeded, cardCopy, locale, copy }: DiscoveryViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /*
   * `useSearchParams()` hands back a read-only instance, and `parseFilters`
   * takes a `URLSearchParams` — one is constructed from its string form rather
   * than cast, because the two are different types and the cast would be a lie
   * that compiles.
   */
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const facets = useDiscoveryFacets(filters);
  const feed = useDiscoveryFeed(filters, copy, locale, seeded);

  const names = useMemo(() => slugNames(facets), [facets]);
  const active = useMemo(
    () => activeFilters(filters, copy.filters, names),
    [filters, copy.filters, names],
  );

  const apply = useCallback(
    (next: DiscoveryFilters) => {
      router.push(toHref(next, pathname), { scroll: false });
    },
    [router, pathname],
  );

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = feed;

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasMore) return;

    /*
     * The observer is an ENHANCEMENT and is allowed to be absent. A browser
     * without it, or a test environment that stubs it, still has the button —
     * which is why nothing here is the only way to reach the next page.
     */
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: PREFETCH_MARGIN },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const blamed = feed.items.length === 0 ? blameFor(active, facets) : [];
  const problem = describeProblem(feed.error, copy);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
      <FadeUp>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-2 max-w-[60ch] text-white/64">{copy.standfirst}</p>
      </FadeUp>

      {/*
        OUTSIDE THE `FadeUp`. Discovery's budget gives the heading one entry
        animation, once (docs/motion-system.md §5.1) — and a control the reader
        may be typing into before the page has settled must not be one of the
        things still moving.
      */}
      <div className="mt-6 max-w-[720px]">
        <SearchBox filters={filters} onApply={apply} copy={copy.suggest} />
      </div>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <aside
          aria-label={copy.filtersLabel}
          className="w-full shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:w-[300px] lg:overflow-y-auto"
        >
          <FilterRail
            filters={filters}
            facets={facets}
            onChange={apply}
            copy={copy}
            locale={locale}
          />
        </aside>

        {/*
          A `div`, not a `main`. The site shell renders the page's one `<main>` and it is the
          skip link's target (§4.13 WS-01); a second landmark here would make "jump to main"
          a question with two answers. This is the feed column, and the heading below names it.
        */}
        <div className="min-w-0 flex-1">
          {/*
            #129. A HEADING THAT IS THERE FOR THE LADDER RATHER THAN FOR THE LAYOUT.

            Every card title is an `<h3>`, and until this existed the nearest heading above
            them was the page's `<h1>` — so a reader navigating by heading level went from
            "Discover" straight into the first campaign, with two hundred `<h3>`s and nothing
            naming what they were a list of. Making the cards `<h2>` was the other option and
            it is worse: `ProjectCard` is the same component on the category landings and in a
            collection, where an `<h2>` already names the section it sits in.

            Visually hidden rather than drawn, because the column is obvious to anybody who
            can see it and the design has no room for a second title. It is the `<ul>`'s
            accessible name as well, so the list announces what it is a list of.
          */}
          <h2 id={RESULTS_HEADING_ID} className="sr-only">
            {copy.resultsHeading}
          </h2>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="text-sm text-white/64 tabular-nums">
                {feed.status === 'loading'
                  ? copy.loading
                  : pluralise(locale, hasMore ? copy.shownMore : copy.shown, feed.items.length)}
              </p>

              <SortControl
                sort={filters.sort}
                hasQuery={filters.query !== ''}
                onChange={(sort) => apply({ ...filters, sort })}
                copy={copy}
              />
            </div>

            <ActiveFilters
              filters={active}
              onRemove={(filter: ActiveFilter) => apply(removeFilter(filters, filter))}
              onClear={() => apply(clearFilters(filters))}
              copy={copy}
            />
          </div>

          {/*
            THE ANNOUNCEMENT. `role="status"` is polite: a page of results
            arriving is an outcome the reader asked for, not an interruption to
            assert over whatever they are already hearing. It is a permanent
            region whose text changes, because a live region that only exists
            while it has something in it is inserted and read as ordinary
            content rather than announced.
          */}
          <p role="status" aria-live="polite" className="sr-only">
            {feed.announcement}
          </p>

          <div className="mt-6">
            {feed.status === 'loading' && <DiscoverySkeleton label={copy.loading} />}

            {feed.status === 'failed' && (
              <InlineAlert variant="danger" title={problem.title}>
                <p>{problem.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill size="sm" variant="ghost" onClick={feed.retry}>
                    {copy.tryAgain}
                  </Pill>
                  {active.length > 0 && (
                    <Pill size="sm" variant="ghost" onClick={() => apply(clearFilters(filters))}>
                      {copy.clearAll}
                    </Pill>
                  )}
                </div>
              </InlineAlert>
            )}

            {feed.status === 'ready' && feed.items.length === 0 && (
              <EmptyState
                variant={active.length > 0 || filters.query !== '' ? 'filtered' : 'empty'}
                headingLevel={2}
                title={
                  /*
                   * THE SEARCH TEXT IS NAMED WHEN THERE IS ANY. No facet counts
                   * it — `?q=` narrows the set the facets are counted over
                   * rather than being a dimension of its own — so `blameFor`
                   * cannot see it and would blame the filters for an emptiness
                   * a misspelt word caused. The word is the first thing to try
                   * changing, so it is the first thing the page says.
                   */
                  filters.query !== ''
                    ? fillPlaceholders(copy.emptyQueryTitle, { query: filters.query })
                    : active.length > 0
                      ? copy.emptyFilteredTitle
                      : copy.emptyTitle
                }
                description={
                  filters.query !== '' && blamed.length === 0 ? (
                    active.length > 0 ? (
                      copy.emptyQueryBodyFiltered
                    ) : (
                      copy.emptyQueryBody
                    )
                  ) : blamed.length === 0 ? (
                    copy.emptyBody
                  ) : blamed.length === 1 ? (
                    <>
                      {fillNodes(copy.blamedOne, {
                        filter: <strong className="text-white">{blamed[0]?.label}</strong>,
                      })}
                    </>
                  ) : (
                    <>
                      {fillNodes(copy.blamedMany, {
                        filters: (
                          <strong className="text-white">
                            {blamed.map((filter) => filter.label).join(', ')}
                          </strong>
                        ),
                      })}
                    </>
                  )
                }
                action={
                  blamed.length > 0 || filters.query !== '' ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {blamed.map((filter) => (
                        <Pill
                          key={filter.key}
                          size="sm"
                          variant="ghost"
                          onClick={() => apply(removeFilter(filters, filter))}
                        >
                          {fillPlaceholders(copy.removeFilter, { label: filter.label })}
                        </Pill>
                      ))}
                      {filters.query !== '' && (
                        <Pill
                          size="sm"
                          variant="ghost"
                          onClick={() => apply(withQuery(filters, ''))}
                        >
                          {copy.clearSearch}
                        </Pill>
                      )}
                      {active.length > 0 && (
                        <Pill size="sm" onClick={() => apply(clearFilters(filters))}>
                          {copy.clearAll}
                        </Pill>
                      )}
                    </div>
                  ) : undefined
                }
              />
            )}

            {feed.items.length > 0 && (
              <>
                <ul
                  aria-labelledby={RESULTS_HEADING_ID}
                  className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {feed.items.map((card, index) => (
                    <li key={card.id}>
                      {/*
                        The first row loads its cover eagerly; everything below
                        it stays lazy. Three is the widest this grid ever gets
                        (`xl:grid-cols-3`), so "index under three" is the set of
                        cards that can be on screen before a scroll rather than
                        a guess. One of them is the largest contentful paint on
                        this route and the rest must not compete with it.
                      */}
                      <ProjectCard
                        card={card}
                        priority={index < 3}
                        copy={cardCopy}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>

                {feed.error !== null && feed.status === 'ready' && (
                  /*
                    A page that failed part-way down does not blank the cards
                    already read. The complaint belongs next to the control that
                    failed, not over the whole feed.
                  */
                  <InlineAlert variant="danger" title={problem.title} className="mt-6">
                    {problem.detail}
                  </InlineAlert>
                )}

                <div className="mt-8 flex flex-col items-center gap-4">
                  {hasMore ? (
                    <>
                      <Pill onClick={loadMore} disabled={feed.loadingMore}>
                        {feed.loadingMore ? copy.loadingMore : copy.showMore}
                      </Pill>

                      {feed.loadingMore && (
                        <SkeletonGroup label={copy.loadingMore} className="w-full">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <Skeleton height="6rem" />
                            <Skeleton height="6rem" />
                            <Skeleton height="6rem" />
                          </div>
                        </SkeletonGroup>
                      )}

                      {/*
                        The sentinel. Purely decorative to assistive technology —
                        the button above it is the control, and this only makes
                        the same thing happen sooner for somebody scrolling.
                      */}
                      <div ref={sentinel} aria-hidden="true" className="h-px w-full" />
                    </>
                  ) : (
                    <p className="text-sm text-white/40">
                      {feed.items.length <= PAGE_SIZE ? copy.endAll : copy.endFeed}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
