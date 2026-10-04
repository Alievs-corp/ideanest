import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Glyphs } from '../../icons';
import { NO_FILTERS, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { findCategory, findSubcategory } from '@ideanest/discovery/taxonomy';
import {
  FEED_PAGE_SIZE,
  useCategories,
  useDiscoveryFeed,
  type Card,
  type Category,
  type Subcategory,
} from '../../api/queries';
import { definedRouteParams, useFeedProblem } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, spacing } from '../../theme';
import { CampaignColumn, CampaignColumnSkeleton } from '../campaign-column';
import { NotFoundState } from '../not-found-state';
import { Body, Heading, Meta } from '../text';
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../ui';
import { Breadcrumb, LinkPill, PILL_HEIGHT, type Crumb } from './breadcrumb';

/**
 * A category's or a subcategory's landing page — the web's `CategoryLanding`
 * (`components/browse/CategoryLanding.tsx`), issue #154.
 *
 * <h2>One component, two routes</h2>
 *
 * The two pages differ in the trail, the heading, the standfirst, the filter, and whether there
 * is a row of children — exactly as on the web, which says why it is one component: two would
 * disagree about the empty state within a month.
 *
 * Top to bottom: the trail, the heading, the standfirst, the subcategory chips (category only),
 * the count, up to twenty-four cards, and a pill into the feed with the filter already applied.
 * No sort, no filter and no paging here, because the feed is where those live; this screen hands
 * off to it as the web does.
 *
 * <h2>Not found, and could not be read, are two answers</h2>
 *
 * A slug the taxonomy does not name — or a subcategory slug not under this category — is the
 * not-found screen, as on the web. A taxonomy that could not be read is the web's 404 too, because
 * a server render cannot tell a reader anything else; the app can, so it says the service could
 * not be reached and offers a retry. Likewise a feed read that failed: the web shows "nothing
 * here", the app an error with retry, because "nothing published in Games" would be untrue.
 *
 * <h2>The reads are parallel</h2>
 *
 * The feed is asked for under the route's own slug while the taxonomy loads, as the web's
 * `resolveCategoryLanding` does, and the taxonomy shares its key with Home and the index, so a
 * category opened from either costs one read, not two.
 *
 * <h2>Shape and motion</h2>
 *
 * The page is the kit's `Screen` on a stack route, so its foot clears the home indicator. The
 * trail and the subcategory chips are raised pills (`LinkPill`) with the press give. The heading
 * never moves; the cards rise as `CampaignColumn` decides (first screenful only, `mobile-design`
 * skill §6.5), and the kit's own motion still runs under the skill's §6 rules.
 */

export interface CategoryLandingProps {
  readonly categorySlug: string;
  /** Present on a subcategory page, absent on a category page. */
  readonly subcategorySlug?: string;
}

export function CategoryLanding({ categorySlug, subcategorySlug }: CategoryLandingProps) {
  const tAll = useT();
  const tFeed = useT('discovery.feed');
  const categories = useCategories();
  const [pulling, setPulling] = useState(false);

  const query: DiscoveryFilters = useMemo(
    () => ({
      ...NO_FILTERS,
      categories: [categorySlug],
      subcategories: subcategorySlug === undefined ? [] : [subcategorySlug],
    }),
    [categorySlug, subcategorySlug],
  );
  const feed = useDiscoveryFeed(query, { limit: FEED_PAGE_SIZE });

  const category =
    categories.data === undefined ? null : findCategory(categories.data, categorySlug);
  const subcategory =
    category === null || subcategorySlug === undefined
      ? null
      : findSubcategory(category, subcategorySlug);

  if (categories.isPending) {
    return (
      <>
        <Stack.Screen options={{ title: tAll('shell.nav.categories') }} />
        <LandingSkeleton
          label={tAll('mobile.browse.loadingCategory')}
          chips={subcategorySlug === undefined}
        />
      </>
    );
  }

  if (categories.data === undefined) {
    return (
      <>
        <Stack.Screen options={{ title: tAll('shell.nav.categories') }} />
        <Screen hasContent edges={EDGES}>
          <View style={styles.centre}>
            <ErrorState
              title={tFeed('errorTitle')}
              description={tFeed('unreachable')}
              onRetry={() => void categories.refetch()}
              retrying={categories.isFetching}
              testID="taxonomy-error"
            />
          </View>
        </Screen>
      </>
    );
  }

  if (category === null || (subcategorySlug !== undefined && subcategory === null)) {
    return <NotFoundState testID="category-not-found" />;
  }

  return (
    <>
    <Stack.Screen options={{ title: subcategory?.name ?? category.name }} />
    <Screen
      hasContent
      edges={EDGES}
      onRefresh={() => {
        setPulling(true);
        void Promise.allSettled([categories.refetch(), feed.refetch()]).then(() =>
          setPulling(false),
        );
      }}
      refreshing={pulling}
      testID="category-landing"
    >
      <LandingBody category={category} subcategory={subcategory} feed={feed} />
    </Screen>
  </>
  );
}

function LandingBody({
  category,
  subcategory,
  feed,
}: {
  readonly category: Category;
  readonly subcategory: Subcategory | null;
  readonly feed: ReturnType<typeof useDiscoveryFeed>;
}) {
  const t = useT('discovery.landing');
  const tAll = useT();
  const tFeed = useT('discovery.feed');
  const router = useRouter();
  const problem = useFeedProblem(feed.error);

  const title = subcategory?.name ?? category.name;
  const page = feed.data?.pages[0];
  const cards = useMemo(() => (page?.items ?? []) as Card[], [page]);
  const hasMore = page?.nextCursor != null && page.nextCursor !== '';

  /*
   * The canonical slugs, from the taxonomy rather than the route: a link typed `/categories/GAMES`
   * opens the feed as `?category=games`. The category goes alongside the subcategory, as on the
   * web, so the URL reads as the trail above it.
   */
  const feedFilters: DiscoveryFilters = {
    ...NO_FILTERS,
    categories: [category.slug],
    subcategories: subcategory === null ? [] : [subcategory.slug],
  };
  const openFeed = (filters: DiscoveryFilters = NO_FILTERS) =>
    router.push({ pathname: '/discover', params: definedRouteParams(filters) });

  const crumbs: Crumb[] = [
    { label: tAll('common.trail.categories'), href: '/categories' },
    ...(subcategory === null
      ? []
      : [
          {
            label: category.name,
            href: { pathname: '/categories/[category]', params: { category: category.slug } },
          } satisfies Crumb,
        ]),
    { label: title },
  ];

  return (
    <View style={styles.page}>
      <View style={styles.head}>
        <Breadcrumb label={tAll('common.breadcrumb')} crumbs={crumbs} testID="breadcrumb" />
        <Heading accessibilityRole="header">{title}</Heading>
        <Body>
          {subcategory === null
            ? t('standfirst', { category: category.name })
            : t('subStandfirst', { category: category.name, subcategory: subcategory.name })}
        </Body>
      </View>

      {subcategory === null && category.subcategories.length > 0 ? (
        <View
          style={styles.chips}
          accessibilityLabel={t('subcategoriesLabel', { category: category.name })}
          testID="subcategory-chips"
        >
          {category.subcategories.map((child) => (
            <LinkPill
              key={child.id || child.slug}
              label={child.name}
              href={{
                pathname: '/categories/[category]/[subcategory]',
                params: { category: category.slug, subcategory: child.slug },
              }}
            />
          ))}
        </View>
      ) : null}

      {feed.isPending ? (
        <CampaignColumnSkeleton label={tFeed('loading')} />
      ) : feed.isError && cards.length === 0 ? (
        <InlineAlert
          variant="danger"
          title={problem.title}
          description={problem.detail}
          action={
            <View style={styles.row}>
              <Pill
                label={tFeed('tryAgain')}
                variant="ghost"
                size="sm"
                busy={feed.isFetching}
                onPress={() => void feed.refetch()}
              />
            </View>
          }
          testID="landing-error"
        />
      ) : (
        <>
          <Meta tone="secondary" style={styles.count} testID="landing-count">
            {t(hasMore ? 'countMore' : 'count', { count: cards.length })}
          </Meta>

          {cards.length === 0 ? (
            /*
              `empty`, not `filtered`: nothing here is a filter the reader chose — they followed a
              link to a category with nothing published in it — so there is nothing to clear.
            */
            <EmptyState
              variant="empty"
              title={t('emptyTitle', { title })}
              description={t('emptyBody')}
              action={<Pill label={t('emptyAction')} onPress={() => openFeed()} />}
              testID="landing-empty"
            />
          ) : (
            <>
              <View accessibilityLabel={t('gridLabel', { title })} testID="landing-cards">
                <CampaignColumn cards={cards} priority={3} />
              </View>
              <View style={styles.more}>
                <Pill
                  label={hasMore ? t('seeEvery', { title }) : t('filterAndSort', { title })}
                  variant="outline"
                  iconRight={Glyphs.ArrowRight}
                  onPress={() => openFeed(feedFilters)}
                  testID="feed-pill"
                />
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

/** The trail, the heading, the chips when a category has them, then six cards. */
function LandingSkeleton({ label, chips }: { readonly label: string; readonly chips: boolean }) {
  return (
    <Screen hasContent edges={EDGES}>
      <SkeletonGroup label={label}>
        <View style={styles.page}>
          <View style={styles.head}>
            <Skeleton height={lineHeight.small} width="40%" radius="sm" />
            <Skeleton height={lineHeight.h2} width="60%" radius="sm" />
            <Skeleton height={lineHeight.body} width="90%" radius="sm" />
          </View>
          {chips ? (
            <View style={styles.chips}>
              {[0, 1, 2].map((chip) => (
                <Skeleton key={chip} height={PILL_HEIGHT} width={spacing[24]} radius="lg" />
              ))}
            </View>
          ) : null}
          <CampaignColumnSkeleton label={label} />
        </View>
      </SkeletonGroup>
    </Screen>
  );
}

/** A stack route: no tab bar under it, so the page owns the bottom inset. */
const EDGES = ['left', 'right', 'bottom'] as const;

const styles = StyleSheet.create({
  centre: { flexGrow: 1, justifyContent: 'center' },
  page: { gap: spacing[6], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[2] },
  count: { ...font.regular, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row' },
  more: { alignItems: 'center', paddingTop: spacing[4] },
});
