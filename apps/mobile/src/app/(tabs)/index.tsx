import { useMemo } from 'react';
import { NO_FILTERS } from '@ideanest/discovery/filters';
import { useDiscoveryFeed, type Card } from '../../api/queries';
import { CampaignList, CampaignListSkeleton } from '../../components/campaign-list';
import { EmptyState, MotionBudgetProvider, Screen } from '../../components/ui';
import { useT } from '../../lib/i18n';

/**
 * Discovery — §4.3's first half.
 *
 * <h2>What the screen decides, and what it does not</h2>
 *
 * The ranking is the service's (§6.2's `DiscoverySort`), the paging is
 * `useDiscoveryFeed`'s, and the virtualisation and the stagger cap are
 * `CampaignList`'s. What is left here is the order in which the four possible
 * states are answered, and that order is the only thing on this screen anybody
 * gets wrong:
 *
 *   1. **Cards, if there are any** — including cards from a previous fetch while
 *      the next one is in flight. A list that empties itself on every refetch is
 *      a list that flickers.
 *   2. **The error**, but only when there is nothing to show. An error banner
 *      over a working list is noise; an error instead of a working list is a
 *      regression.
 *   3. **Loading**, on the first fetch only.
 *   4. **Empty**, which means the service answered and there is genuinely
 *      nothing — a real fact about the platform rather than a failure.
 *
 * <h2>Motion: minimal</h2>
 *
 * This tab is the discovery feed, not the web's marketing home (`/`), so it takes
 * discovery's budget from `docs/motion-system.md` §5 — **minimal** — rather than
 * the home row's **full**: the cards do not animate (§5.1), and what may move is
 * the skeleton's shimmer and the progress bars. The marketing home's hero has no
 * counterpart in the app to spend a full budget on.
 */
export default function DiscoverScreen() {
  // The web's own feed sentences, so a state reads the same on both.
  const t = useT('discovery.feed');
  const feed = useDiscoveryFeed(NO_FILTERS);

  /*
   * Flattened once per data change rather than on every render. The pages are
   * an array of arrays and this is the one place they become a list; doing it
   * inline would hand `CampaignList` a new array identity every render and
   * defeat its recycling.
   */
  const cards = useMemo(
    () => (feed.data?.pages ?? []).flatMap((page) => (page.items ?? []) as Card[]),
    [feed.data],
  );

  return <MotionBudgetProvider level="minimal">{body()}</MotionBudgetProvider>;

  function body() {
    if (cards.length === 0) {
      if (feed.isLoading) return <CampaignListSkeleton label={t('loading')} />;
      if (feed.isError) {
        // Retry is the query's own refetch: an error with no way to ask again is a dead end.
        return (
          <Screen
            hasContent={false}
            error={{
              title: t('errorTitle'),
              description: t('unreachable'),
              onRetry: () => void feed.refetch(),
              retrying: feed.isFetching,
            }}
          />
        );
      }
    }

    return (
      <CampaignList
        cards={cards}
        onEndReached={() => {
          // Guarded rather than fired blind: `fetchNextPage` while a fetch is
          // already in flight queues a duplicate request for the same cursor.
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onRefresh={() => void feed.refetch()}
        refreshing={feed.isRefetching}
        empty={<EmptyState title={t('emptyTitle')} description={t('emptyBody')} />}
      />
    );
  }
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
