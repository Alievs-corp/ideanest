import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NO_FILTERS, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { useCategories, useDiscoveryFeed, type Card } from '../../api/queries';
import { CampaignColumn } from '../../components/campaign-column';
import {
  CategoryTiles,
  HomeEmpty,
  HomeHero,
  HomeSection,
  RailSkeleton,
  TilesSkeleton,
} from '../../components/home/home-parts';
import { InlineAlert, MotionBudgetProvider, Pill, haptics } from '../../components/ui';
import { definedRouteParams } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { colors, size, spacing } from '../../theme';

/**
 * Home — the web's `/` (`app/[locale]/(site)/page.tsx`), issue #153.
 *
 * Top to bottom, as on the web: a small hero, then "Ending soon", "Recently launched" and
 * "Browse by category", each only when it has something in it, and the empty card when both
 * campaign rails are empty. The three reads run in parallel.
 *
 * <h2>Failure is per section</h2>
 *
 * A rail whose read failed is absent, as on the web. Unlike the web, the app can tell "nothing is
 * live" from "the service could not be reached", so when both campaign reads failed it says so,
 * with a retry, instead of drawing the empty card — which would tell a backer the platform is
 * empty when it is only out of reach.
 *
 * <h2>Motion</h2>
 *
 * Discovery's budget: the hero and the rail headings fade up once, the cards never move, and
 * Reduce Motion turns the fades off.
 */

/** Six to a rail, the web's `RAIL_SIZE`. */
const RAIL_SIZE = 6;

const CLOSING: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' };
const LAUNCHED: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'] };

export default function HomeScreen() {
  const t = useT('home');
  const tFeed = useT('discovery.feed');
  const router = useRouter();

  const closing = useDiscoveryFeed(CLOSING, { limit: RAIL_SIZE });
  const launched = useDiscoveryFeed(LAUNCHED, { limit: RAIL_SIZE });
  const categories = useCategories();

  const closingCards = useFirstPage(closing.data);
  const launchedCards = useFirstPage(launched.data);
  const taxonomy = categories.data ?? [];

  const bothFailed = closing.isError && launched.isError;
  // The pull's own spinner: a retry, a reconnect or a stale refetch is not somebody pulling.
  const [pulling, setPulling] = useState(false);

  function refresh(): Promise<unknown> {
    return Promise.allSettled([closing.refetch(), launched.refetch(), categories.refetch()]);
  }

  function openFeed(filters: DiscoveryFilters = NO_FILTERS): void {
    router.push({ pathname: '/discover', params: definedRouteParams(filters) });
  }

  return (
    <MotionBudgetProvider level="minimal">
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              haptics.refresh();
              setPulling(true);
              void refresh().then(() => setPulling(false));
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        }
      >
        <HomeHero onBrowse={() => openFeed()} onStart={() => router.push('/campaigns/new')} />

        {closing.isPending ? (
          <RailSkeleton label={tFeed('loading')} />
        ) : closingCards.length > 0 ? (
          <HomeSection
            heading={t('closing.heading')}
            standfirst={t('closing.standfirst')}
            href={{ pathname: '/discover', params: definedRouteParams(CLOSING) }}
            linkLabel={t('closing.link')}
            testID="rail-closing"
          >
            {/* The only rail whose covers are fetched first: it is what the screen opens on. */}
            <CampaignColumn cards={closingCards} priority={3} />
          </HomeSection>
        ) : null}

        {launched.isPending ? (
          <RailSkeleton label={tFeed('loading')} />
        ) : launchedCards.length > 0 ? (
          <HomeSection
            heading={t('launched.heading')}
            standfirst={t('launched.standfirst')}
            href={{ pathname: '/discover', params: definedRouteParams(LAUNCHED) }}
            linkLabel={t('launched.link')}
            testID="rail-launched"
          >
            <CampaignColumn cards={launchedCards} />
          </HomeSection>
        ) : null}

        {categories.isPending ? (
          <TilesSkeleton label={tFeed('loading')} />
        ) : taxonomy.length > 0 ? (
          <HomeSection
            heading={t('categories.heading')}
            standfirst={t('categories.standfirst')}
            href="/categories"
            linkLabel={t('categories.link')}
            testID="categories"
          >
            <CategoryTiles categories={taxonomy} />
          </HomeSection>
        ) : null}

        {closing.isPending || launched.isPending ? null : bothFailed ? (
          <InlineAlert
            variant="danger"
            title={tFeed('errorTitle')}
            description={tFeed('unreachable')}
            action={
              <View style={styles.retry}>
                <Pill
                  label={tFeed('tryAgain')}
                  variant="ghost"
                  size="sm"
                  busy={closing.isFetching || launched.isFetching}
                  onPress={() => void refresh()}
                />
              </View>
            }
            testID="home-error"
          />
        ) : closingCards.length === 0 && launchedCards.length === 0 ? (
          <HomeEmpty onOpenFeed={() => openFeed()} />
        ) : null}
      </ScrollView>
    </MotionBudgetProvider>
  );
}

/** The first page's cards, flattened once per data change. */
function useFirstPage(data: { pages: readonly { items?: readonly Card[] }[] } | undefined) {
  return useMemo(() => (data?.pages[0]?.items ?? []) as Card[], [data]);
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  content: {
    padding: size.cardGap,
    paddingBottom: spacing[12],
    gap: spacing[12],
  },
  retry: { flexDirection: 'row' },
});

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
