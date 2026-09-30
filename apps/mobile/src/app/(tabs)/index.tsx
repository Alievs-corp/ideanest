import { useMemo } from 'react';
import { useDiscoveryFeed, type Card } from '../../api/queries';
import { CampaignList } from '../../components/campaign-list';
import { EmptyState, ErrorState, Loading } from '../../components/states';
import { useT } from '../../lib/i18n';

/**
 * Discovery — issue #112's first half.
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
 */
export default function DiscoverScreen() {
  // The web's own feed sentences, so a state reads the same on both.
  const t = useT('discovery.feed');
  const feed = useDiscoveryFeed({});

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

  if (cards.length === 0) {
    if (feed.isLoading) return <Loading label={t('loading')} />;
    if (feed.isError) {
      return <ErrorState title={t('errorTitle')} detail={t('unreachable')} />;
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
      empty={<EmptyState title={t('emptyTitle')} detail={t('emptyBody')} />}
    />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
