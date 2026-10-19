import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NO_FILTERS, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { useCategories, useDiscoveryFeed, type Card } from '../../api/queries';
import { CampaignColumn } from '../../components/campaign-column';
import {
  CategoryTiles,
  CreatorPages,
  HomeEmpty,
  HomeHero,
  HomeSection,
  RailSkeleton,
  TilesSkeleton,
} from '../../components/home/home-parts';
import { FadeUp } from '../../components/motion';
import { Body, Heading } from '../../components/text';
import { InlineAlert, Pill, Screen } from '../../components/ui';
import { definedRouteParams } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { withScreenRoot } from '../../components/screen-root';

/**
 * Home — the web's `/` (`app/[locale]/(site)/page.tsx`), issue #153.
 *
 * Top to bottom, as on the web's phone layout: a small hero, then "Popular right now", "Ending
 * soon", "Recently launched", "For creators" and "Browse by category", each campaign section only
 * when it has something in it, and the empty card when every campaign read came back empty. The
 * reads run in parallel.
 *
 * <h2>One campaign per section</h2>
 *
 * The owner asked for each campaign section to show a single card and a button to the whole list
 * under it, as the web does on a phone. So each read asks for one campaign: a section that draws
 * one card has no use for six.
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
 * The `mobile-design` skill §6: the hero and the rail headings fade up once, staggered by their
 * place on the screen; the rails' cards rise as `CampaignColumn` decides (first screenful only),
 * and Reduce Motion turns the fades off.
 *
 * <p>The page is the kit's `Screen`, which pads it clear of the floating tab bar
 * (`useTabBarInset()`) and draws the pull to refresh.
 */

/** One campaign per section, and the section's button opens the rest. */
const SECTION_SIZE = 1;

/** The feed's own popularity ranking: money raised against the campaign's age. */
const POPULAR: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'], sort: 'popularity' };
const CLOSING: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' };
const LAUNCHED: DiscoveryFilters = { ...NO_FILTERS, statuses: ['live'] };

function HomeScreen() {
  const t = useT('home');
  const tFeed = useT('discovery.feed');
  const tPages = useT('static');
  const tPricing = useT('pricing');
  const router = useRouter();

  const popular = useDiscoveryFeed(POPULAR, { limit: SECTION_SIZE });
  const closing = useDiscoveryFeed(CLOSING, { limit: SECTION_SIZE });
  const launched = useDiscoveryFeed(LAUNCHED, { limit: SECTION_SIZE });
  const categories = useCategories();

  const popularCards = useFirstPage(popular.data);
  const closingCards = useFirstPage(closing.data);
  const launchedCards = useFirstPage(launched.data);
  const taxonomy = categories.data ?? [];

  const reads = [popular, closing, launched];
  const anyPending = reads.some((read) => read.isPending);
  const allFailed = reads.every((read) => read.isError);
  const allEmpty = popularCards.length === 0 && closingCards.length === 0 && launchedCards.length === 0;

  const creatorPages = [
    { href: '/how-it-works', title: tPages('howItWorks.metaTitle'), body: tPages('howItWorks.metaDescription') },
    { href: '/pricing', title: tPricing('metaTitle'), body: tPricing('metaDescription') },
    { href: '/trust-safety', title: tPages('trustSafety.metaTitle'), body: tPages('trustSafety.metaDescription') },
  ] as const;
  // The pull's own spinner: a retry, a reconnect or a stale refetch is not somebody pulling.
  const [pulling, setPulling] = useState(false);

  function refresh(): Promise<unknown> {
    return Promise.allSettled([
      popular.refetch(),
      closing.refetch(),
      launched.refetch(),
      categories.refetch(),
    ]);
  }

  function openFeed(filters: DiscoveryFilters = NO_FILTERS): void {
    router.push({ pathname: '/discover', params: definedRouteParams(filters) });
  }

  return (
    <Screen
      hasContent
      onRefresh={() => {
        setPulling(true);
        void refresh().then(() => setPulling(false));
      }}
      refreshing={pulling}
      testID="home"
    >
      <View style={styles.page}>
        <HomeHero onBrowse={() => openFeed()} onStart={() => router.push('/campaigns/new')} />

        {popular.isPending ? (
          <RailSkeleton label={tFeed('loading')} />
        ) : popularCards.length > 0 ? (
          <HomeSection
            heading={t('featured.heading')}
            standfirst={t('featured.standfirst')}
            href={{ pathname: '/discover', params: definedRouteParams(POPULAR) }}
            linkLabel={t('featured.link')}
            index={1}
            testID="rail-popular"
          >
            {/* The first campaign under the hero, so its cover is fetched first. */}
            <CampaignColumn cards={popularCards} priority={1} />
          </HomeSection>
        ) : null}

        {closing.isPending ? (
          <RailSkeleton label={tFeed('loading')} />
        ) : closingCards.length > 0 ? (
          <HomeSection
            heading={t('closing.heading')}
            standfirst={t('closing.standfirst')}
            href={{ pathname: '/discover', params: definedRouteParams(CLOSING) }}
            linkLabel={t('closing.link')}
            index={2}
            testID="rail-closing"
          >
            <CampaignColumn cards={closingCards} />
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
            index={3}
            testID="rail-launched"
          >
            <CampaignColumn cards={launchedCards} />
          </HomeSection>
        ) : null}

        <View style={styles.creators} testID="creators">
          <FadeUp index={4}>
            <View style={styles.titles}>
              <Heading accessibilityRole="header">{t('creators.heading')}</Heading>
              <Body>{t('creators.standfirst')}</Body>
            </View>
          </FadeUp>
          <CreatorPages pages={creatorPages} />
        </View>

        {categories.isPending ? (
          <TilesSkeleton label={tFeed('loading')} />
        ) : taxonomy.length > 0 ? (
          <HomeSection
            heading={t('categories.heading')}
            standfirst={t('categories.standfirst')}
            href="/categories"
            linkLabel={t('categories.link')}
            index={5}
            testID="categories"
          >
            <CategoryTiles categories={taxonomy} />
          </HomeSection>
        ) : null}

        {anyPending ? null : allFailed ? (
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
                  busy={reads.some((read) => read.isFetching)}
                  onPress={() => void refresh()}
                />
              </View>
            }
            testID="home-error"
          />
        ) : allEmpty ? (
          <HomeEmpty onOpenFeed={() => openFeed()} />
        ) : null}
      </View>
    </Screen>
  );
}

/** The first page's cards, flattened once per data change. */
function useFirstPage(data: { pages: readonly { items?: readonly Card[] }[] } | undefined) {
  return useMemo(() => (data?.pages[0]?.items ?? []) as Card[], [data]);
}

const styles = StyleSheet.create({
  page: { gap: spacing[12], paddingTop: spacing[4] },
  creators: { gap: spacing[4] },
  titles: { gap: spacing[2] },
  retry: { flexDirection: 'row' },
});

export default withScreenRoot('home', HomeScreen);

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
