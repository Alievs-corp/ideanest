import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { useCategories, type Category, type Subcategory } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { FadeUp } from '../motion';
import { Body, Heading } from '../text';
import {
  Pill,
  Skeleton,
  SkeletonGroup,
  haptics,
  useFocusRing,
} from '../ui';

/**
 * The categories index — the web's `/categories` (`app/[locale]/(site)/categories/page.tsx`),
 * issue #154.
 *
 * A heading and an intro, then one section per category in the service's order: its name as a
 * link to its landing page, and its subcategories as links beneath it. Text only, because the
 * taxonomy carries text only. The web lays the sections out in two or three columns from `sm`
 * upward; its phone layout is one, and so is this.
 *
 * <h2>A failed read and an empty taxonomy say the same thing</h2>
 *
 * As on the web: either way the feed is reachable and carries every campaign, which is the one
 * useful thing to say, so the paragraph links there. Unlike the web the app can try again, so a
 * "Try again" pill sits under it.
 *
 * <h2>Motion</h2>
 *
 * The heading and the intro fade up once; the sections never move (`mobile-design` skill §6.5).
 */

interface Section {
  readonly category: Category;
  readonly data: readonly Subcategory[];
}

export function CategoryIndex() {
  const t = useT('discovery.categories');
  const tAll = useT();
  const categories = useCategories();
  const [pulling, setPulling] = useState(false);

  const taxonomy = categories.data ?? [];
  const sections: Section[] = taxonomy.map((category) => ({
    category,
    data: category.subcategories,
  }));

  return (
    <>
    <Stack.Screen options={{ title: t('title') }} />
    <SectionList
      style={styles.fill}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(subcategory) => subcategory.id || subcategory.slug}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <FadeUp>
          <View style={styles.titles}>
            <Heading accessibilityRole="header">{t('title')}</Heading>
            <Body>{t('intro')}</Body>
          </View>
        </FadeUp>
      }
      renderSectionHeader={({ section }) => <CategoryHeading category={section.category} />}
      renderItem={({ item, section }) => (
        <SubcategoryLink category={section.category} subcategory={item} />
      )}
      renderSectionFooter={() => <View style={styles.sectionGap} />}
      ListEmptyComponent={
        categories.isPending ? (
          <IndexSkeleton label={tAll('mobile.browse.loadingCategories')} />
        ) : (
          <Unavailable retrying={categories.isFetching} onRetry={() => void categories.refetch()} />
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            haptics.refresh();
            setPulling(true);
            void categories.refetch().finally(() => setPulling(false));
          }}
          tintColor={colors.textSecondary}
          colors={[colors.textPrimary]}
          progressBackgroundColor={colors.surface3}
        />
      }
      testID="category-index"
    />
  </>
  );
}

/** The category's name, 20pt medium, as a link to its landing page. */
function CategoryHeading({ category }: { readonly category: Category }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Link href={{ pathname: '/categories/[category]', params: { category: category.slug } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={category.name}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => [styles.heading, pressed && styles.pressed, ring]}
      >
        <Text accessibilityRole="header" style={styles.headingText}>
          {category.name}
        </Text>
      </Pressable>
    </Link>
  );
}

/** One subcategory, 15pt white/64, as a link to its own landing page. */
function SubcategoryLink({
  category,
  subcategory,
}: {
  readonly category: Category;
  readonly subcategory: Subcategory;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Link
      href={{
        pathname: '/categories/[category]/[subcategory]',
        params: { category: category.slug, subcategory: subcategory.slug },
      }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={subcategory.name}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => [styles.child, pressed && styles.pressed, ring]}
      >
        <Text style={styles.childText}>{subcategory.name}</Text>
      </Pressable>
    </Link>
  );
}

/** The web's paragraph, its "feed" a link into Discover, and the app's own retry under it. */
function Unavailable({
  retrying,
  onRetry,
}: {
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  const t = useT('discovery.categories');
  const tFeed = useT('discovery.feed');
  const router = useRouter();
  return (
    <View style={styles.unavailable} testID="categories-unavailable">
      <Body>
        {t.rich('unavailable', {
          feed: (chunks) => (
            <Text
              accessibilityRole="link"
              onPress={() => router.push('/discover')}
              style={styles.inlineLink}
              testID="categories-feed-link"
            >
              {chunks}
            </Text>
          ),
        })}
      </Body>
      <View style={styles.retry}>
        <Pill
          label={tFeed('tryAgain')}
          variant="ghost"
          size="sm"
          busy={retrying}
          onPress={onRetry}
        />
      </View>
    </View>
  );
}

/** Three sections' worth of placeholder: a heading bar and three short lines each. */
function IndexSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.skeleton}>
        {[0, 1, 2].map((section) => (
          <View key={section} style={styles.skeletonSection}>
            <Skeleton height={lineHeight.h3} width="50%" radius="sm" />
            {[0, 1, 2].map((line) => (
              <Skeleton key={line} height={lineHeight.small} width="35%" radius="sm" />
            ))}
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  content: { padding: size.cardGap, paddingBottom: spacing[12] },
  titles: { gap: spacing[2], paddingTop: spacing[4], paddingBottom: spacing[10] },
  heading: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    marginBottom: spacing[2],
  },
  headingText: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
    color: colors.textPrimary,
  },
  child: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
  },
  childText: {
    ...font.regular,
    fontSize: fontSize.row,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.64 },
  // The web's `gap-y-12` between sections.
  sectionGap: { height: spacing[12] },
  unavailable: { gap: spacing[4] },
  inlineLink: { color: colors.textPrimary, textDecorationLine: 'underline' },
  retry: { flexDirection: 'row' },
  skeleton: { gap: spacing[12] },
  skeletonSection: { gap: spacing[3] },
});
