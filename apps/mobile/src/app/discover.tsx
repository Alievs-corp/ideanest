import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import { blameFor } from '@ideanest/discovery/emptiness';
import { PAGE_SIZE, slugNames } from '@ideanest/discovery/facets';
import {
  activeFilters,
  addSlugFilter,
  clearFilters,
  filterKey,
  removeFilter,
  withQuery,
  type DiscoveryFilters,
  type RawParams,
} from '@ideanest/discovery/filters';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { useDiscoveryFacets, useDiscoveryFeed, type Card } from '../api/queries';
import { CampaignColumnSkeleton } from '../components/campaign-column';
import { CampaignList } from '../components/campaign-list';
import { ActiveFilters } from '../components/discovery/active-filters';
import { FilterSheet } from '../components/discovery/filter-sheet';
import { SearchBox } from '../components/discovery/search-box';
import { SortControl } from '../components/discovery/sort-control';
import { FadeUp } from '../components/motion';
import { Body, Heading, Meta } from '../components/text';
import {
  EmptyState,
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  Skeleton,
  SkeletonGroup,
  announce,
} from '../components/ui';
import {
  filtersFromParams,
  routeParamsFor,
  useFeedProblem,
  useFilterVocabulary,
} from '../lib/discovery';
import { pluralCategory, useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../theme';

/**
 * Discover — the web's `/discover` (`components/discovery/DiscoveryView.tsx`), issue #153.
 *
 * <h2>The route is the state</h2>
 *
 * The filters, the query and the sort are this route's params under the service's own names,
 * read with the shared `parseFilters` and written back with `router.setParams` — a replace, not a
 * push, so Back leaves the screen rather than walking through forty filter states. A link
 * `/discover?category=games&sort=ending_soon` opens exactly the feed the web would show for it.
 *
 * <h2>What is the web's, and what is the phone's</h2>
 *
 * The words, the counts, the order of the header, the empty states and the paging rules are the
 * web's, through `@ideanest/discovery`. The phone's own decisions are the issue's: the filters in
 * a sheet, the sort as a sheet of radios, and pull to refresh.
 *
 * <h2>Paging</h2>
 *
 * Twenty-four a page, as on the web. The list asks for the next page about half a screen — some
 * 400pt on a phone, the web sentinel's `rootMargin` — before the end, and "Show more projects" is
 * the same request for somebody who does not scroll. Neither asks while a page is in flight, and
 * neither asks again by itself after a page failed: the button is how that page is retried.
 *
 * <h2>Motion</h2>
 *
 * Discovery's budget is minimal (`docs/motion-system.md` §5): the title fades up once, the cards
 * never move, and Reduce Motion turns the fade off.
 */
export default function DiscoverScreen() {
  const t = useT('discovery.feed');
  const tAll = useT();
  const locale = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams() as RawParams;

  // Keyed by what the params say rather than by the object, which is new on every render.
  const paramsKey = JSON.stringify(params);
  const filters = useMemo(() => filtersFromParams(params), [paramsKey]);
  const key = filterKey(filters);

  const feed = useDiscoveryFeed(filters);
  const facetsQuery = useDiscoveryFacets(filters);
  const facets = facetsQuery.isError ? null : (facetsQuery.data ?? null);
  const vocabulary = useFilterVocabulary();
  const names = useMemo(() => slugNames(facets), [facets]);
  const active = useMemo(
    () => activeFilters(filters, vocabulary, names),
    [filters, vocabulary, names],
  );
  const problem = useFeedProblem(feed.error);
  const [sheetOpen, setSheetOpen] = useState(false);

  const cards = useMemo(
    () => (feed.data?.pages ?? []).flatMap((page) => (page.items ?? []) as Card[]),
    [feed.data],
  );
  const hasMore = feed.hasNextPage;
  const firstLoad = feed.isPending;
  const firstPageFailed = feed.isError && cards.length === 0;
  const nextPageFailed = feed.isFetchNextPageError;

  function apply(next: DiscoveryFilters): void {
    router.setParams(routeParamsFor(next));
  }

  /*
   * The cursor last asked for, by filter set. A guard on `isFetchingNextPage` alone is a render
   * late: two presses, or a press and the end of the list, land before the flag is set, and both
   * would ask for the same page. A failed page may be asked for again, by the button only.
   */
  const asked = useRef<string | null>(null);
  const nextCursor = feed.data?.pages.at(-1)?.nextCursor ?? null;

  function loadMore({ retry = false }: { retry?: boolean } = {}): void {
    if (!hasMore || nextCursor === null) return;
    const ask = `${key}|${nextCursor}`;
    if (asked.current === ask && !(retry && nextPageFailed)) return;
    asked.current = ask;
    void feed.fetchNextPage({ cancelRefetch: false });
  }

  useFeedAnnouncements(key, feed.data?.pages);

  const countLine = firstLoad
    ? t('loading')
    : tAll(
        `discovery.feed.${hasMore ? 'shownMore' : 'shown'}.${pluralCategory(locale, cards.length)}`,
        { count: String(cards.length) },
      );

  const header = (
    <View style={styles.header}>
      <FadeUp>
        <View style={styles.titles}>
          <Heading accessibilityRole="header">{t('title')}</Heading>
          <Body>{t('standfirst')}</Body>
        </View>
      </FadeUp>

      <SearchBox
        query={filters.query}
        onSubmitQuery={(text) => apply(withQuery(filters, text))}
        onChooseFilter={(kind, slug) => apply(addSlugFilter(withQuery(filters, ''), kind, slug))}
      />

      <Pill
        label={active.length > 0 ? `${t('railLabel')} (${active.length})` : t('railLabel')}
        iconLeft={SlidersHorizontal}
        variant="outline"
        fullWidth
        onPress={() => setSheetOpen(true)}
        testID="filters-button"
      />

      <View style={styles.results}>
        <Meta tone="secondary" style={styles.count} accessibilityLiveRegion="none">
          {countLine}
        </Meta>
        <SortControl
          sort={filters.sort}
          hasQuery={filters.query !== ''}
          onChange={(sort) => apply({ ...filters, sort })}
        />
      </View>

      <ActiveFilters
        filters={active}
        onRemove={(filter) => apply(removeFilter(filters, filter))}
        onClear={() => apply(clearFilters(filters))}
      />
    </View>
  );

  return (
    <MotionBudgetProvider level="minimal">
      <Stack.Screen options={{ title: t('title') }} />
      <CampaignList
        cards={cards}
        header={header}
        empty={emptyBody()}
        footer={cards.length > 0 ? footer() : undefined}
        onEndReached={() => loadMore()}
        onRefresh={() => {
          void feed.refetch();
          void facetsQuery.refetch();
        }}
        refreshing={feed.isRefetching && !feed.isFetchingNextPage}
      />
      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        facets={facets}
        onChange={apply}
      />
    </MotionBudgetProvider>
  );

  /** What stands where the cards would be when there are none: loading, failed, or empty. */
  function emptyBody() {
    if (firstLoad) return <CampaignColumnSkeleton label={t('loading')} />;

    if (firstPageFailed) {
      return (
        <InlineAlert
          variant="danger"
          title={problem.title}
          description={problem.detail}
          action={
            <View style={styles.actions}>
              <Pill
                label={t('tryAgain')}
                variant="ghost"
                size="sm"
                busy={feed.isFetching}
                onPress={() => void feed.refetch()}
              />
              {active.length > 0 ? (
                <Pill
                  label={t('clearAll')}
                  variant="ghost"
                  size="sm"
                  onPress={() => apply(clearFilters(filters))}
                />
              ) : null}
            </View>
          }
          testID="feed-error"
        />
      );
    }

    return <FeedEmpty filters={filters} active={active} facets={facets} onApply={apply} />;
  }

  /** After the last card: more, the end, or the next page's failure above "Show more". */
  function footer() {
    return (
      <View style={styles.footer}>
        {nextPageFailed ? (
          <InlineAlert
            variant="danger"
            title={problem.title}
            description={problem.detail}
            testID="next-page-error"
          />
        ) : null}
        {hasMore ? (
          <>
            <Pill
              label={feed.isFetchingNextPage ? t('loadingMore') : t('showMore')}
              disabled={feed.isFetchingNextPage}
              onPress={() => loadMore({ retry: true })}
              testID="show-more"
            />
            {feed.isFetchingNextPage ? (
              <View style={styles.more}>
                <SkeletonGroup label={t('loadingMore')}>
                  <View style={styles.more}>
                    {[0, 1, 2].map((row) => (
                      <Skeleton key={row} height={spacing[24]} radius="lg" />
                    ))}
                  </View>
                </SkeletonGroup>
              </View>
            ) : null}
          </>
        ) : (
          <Meta style={styles.end}>{cards.length <= PAGE_SIZE ? t('endAll') : t('endFeed')}</Meta>
        )}
      </View>
    );
  }
}

/**
 * The polite announcement the web makes from its live region: how many projects the first page
 * showed (or that none match), then how many each further page added. Fired once per page that
 * settles, never on a re-render, and reset when the filters change.
 */
function useFeedAnnouncements(
  key: string,
  pages: readonly { items?: readonly unknown[] }[] | undefined,
) {
  const t = useT();
  const locale = useLocale();
  const said = useRef<{ key: string; pages: number }>({ key: '', pages: 0 });

  useEffect(() => {
    if (pages === undefined) return;
    if (said.current.key !== key) said.current = { key, pages: 0 };
    if (pages.length <= said.current.pages) return;

    const last = pages[pages.length - 1]?.items?.length ?? 0;
    if (pages.length === 1) {
      announce(
        last === 0
          ? t('discovery.feed.announceNone')
          : t(`discovery.feed.announceShown.${pluralCategory(locale, last)}`, {
              count: String(last),
            }),
      );
    } else {
      announce(
        t(`discovery.feed.announceMore.${pluralCategory(locale, last)}`, { count: String(last) }),
      );
    }
    said.current = { key, pages: pages.length };
  }, [key, pages, t, locale]);
}

/**
 * The four empty feeds, told apart as the web tells them apart: nothing on the platform, nothing
 * for a search, nothing for these filters — with the filters to blame named, and a "Remove" for
 * each — or nothing for a search with filters.
 */
function FeedEmpty({
  filters,
  active,
  facets,
  onApply,
}: {
  readonly filters: DiscoveryFilters;
  readonly active: ReturnType<typeof activeFilters>;
  readonly facets: Parameters<typeof blameFor>[1];
  readonly onApply: (next: DiscoveryFilters) => void;
}) {
  const t = useT('discovery.feed');
  const blamed = blameFor(active, facets);
  const searching = filters.query !== '';

  const title = searching
    ? fillPlaceholders(String(t.raw('emptyQueryTitle')), { query: filters.query })
    : active.length > 0
      ? t('emptyFilteredTitle')
      : t('emptyTitle');

  const description =
    searching && blamed.length === 0
      ? active.length > 0
        ? t('emptyQueryBodyFiltered')
        : t('emptyQueryBody')
      : blamed.length === 0
        ? t('emptyBody')
        : blamed.length === 1
          ? fillPlaceholders(String(t.raw('blamedOne')), { filter: blamed[0]?.label ?? '' })
          : fillPlaceholders(String(t.raw('blamedMany')), {
              filters: blamed.map((filter) => filter.label).join(', '),
            });

  const actions =
    blamed.length > 0 || searching ? (
      <View style={[styles.actions, styles.centred]}>
        {blamed.map((filter) => (
          <Pill
            key={filter.key}
            label={fillPlaceholders(String(t.raw('removeFilter')), { label: filter.label })}
            variant="ghost"
            size="sm"
            onPress={() => onApply(removeFilter(filters, filter))}
          />
        ))}
        {searching ? (
          <Pill
            label={t('clearSearch')}
            variant="ghost"
            size="sm"
            onPress={() => onApply(withQuery(filters, ''))}
          />
        ) : null}
        {active.length > 0 ? (
          <Pill label={t('clearAll')} size="sm" onPress={() => onApply(clearFilters(filters))} />
        ) : null}
      </View>
    ) : undefined;

  return (
    <EmptyState
      variant={active.length > 0 || searching ? 'filtered' : 'empty'}
      title={title}
      description={description}
      action={actions}
      testID="feed-empty"
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing[4], paddingBottom: spacing[2] },
  titles: { gap: spacing[2] },
  results: { gap: spacing[3] },
  count: { ...font.regular, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  centred: { justifyContent: 'center' },
  footer: { alignItems: 'center', gap: spacing[4], paddingTop: spacing[4] },
  more: { alignSelf: 'stretch', gap: spacing[4] },
  end: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
