import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { Glyphs } from '../../icons';
import { useCategories, type Category } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { accent as accents, colors, lineHeight, radius, size, spacing } from '../../theme';
import { FadeUp, useFirstScreenfulIndex } from '../motion';
import { categoryLook } from '@ideanest/discovery/category-look';
import { categoryGlyph } from './category-look';
import { Body, CardTitle, Heading } from '../text';
import {
  ContentSheet,
  Icon,
  Pill,
  PressableScale,
  Screen,
  Skeleton,
  SkeletonGroup,
  TONES,
  useFocusRing,
} from '../ui';
import { BLOCK } from '../ui/surface';
import { LinkPill } from './breadcrumb';

/**
 * The categories index — the web's `/categories` (`app/[locale]/(site)/categories/page.tsx`),
 * issue #154, in the `mobile-design` skill's language (#281).
 *
 * A heading and an intro on the dark canvas, then the taxonomy in a white content sheet
 * (`ContentSheet`), in the service's order: each category a row that links to its landing page,
 * with its subcategories as link pills beneath it. The badge beside each name is the category's
 * icon on the accent its Home tile takes, both from `@ideanest/discovery/category-look` (#335) —
 * a decoration, never a meaning, and always beside the name.
 *
 * <h2>A failed read and an empty taxonomy say the same thing</h2>
 *
 * As on the web: either way the feed is reachable and carries every campaign, which is the one
 * useful thing to say, so the paragraph links there. Unlike the web the app can try again, so a
 * "Try again" pill sits under it.
 *
 * <h2>Motion</h2>
 *
 * The heading and the intro fade up once, then the first screenful of categories, staggered
 * (`FadeUp`, skill §6.5). Rows give under the thumb (`PressableScale`).
 */

export function CategoryIndex() {
  const t = useT('discovery.categories');
  const tAll = useT();
  const categories = useCategories();
  const [pulling, setPulling] = useState(false);
  const taxonomy = categories.data ?? [];
  const entryIndex = useFirstScreenfulIndex(taxonomy.map((category) => category.id || category.slug));

  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <Screen
        hasContent
        edges={EDGES}
        onRefresh={() => {
          setPulling(true);
          void categories.refetch().finally(() => setPulling(false));
        }}
        refreshing={pulling}
        testID="category-index"
      >
        <FadeUp index={0}>
          <View style={styles.titles}>
            <Heading accessibilityRole="header">{t('title')}</Heading>
            <Body>{t('intro')}</Body>
          </View>
        </FadeUp>

        {categories.isPending ? (
          <ContentSheet>
            <IndexSkeleton label={tAll('mobile.browse.loadingCategories')} />
          </ContentSheet>
        ) : taxonomy.length === 0 ? (
          <Unavailable retrying={categories.isFetching} onRetry={() => void categories.refetch()} />
        ) : (
          <ContentSheet testID="category-sheet">
            <View style={styles.groups}>
              {taxonomy.map((category) => (
                <FadeUp key={category.id || category.slug} index={entryIndex(category.id || category.slug) + 1}>
                  <CategoryGroup category={category} />
                </FadeUp>
              ))}
            </View>
          </ContentSheet>
        )}
      </Screen>
    </>
  );
}

/** A category's row, then its subcategories as pills. */
function CategoryGroup({ category }: { readonly category: Category }) {
  return (
    <View style={styles.group}>
      <CategoryRow category={category} />
      {category.subcategories.length > 0 ? (
        <View style={styles.chips}>
          {category.subcategories.map((subcategory) => (
            <LinkPill
              key={subcategory.id || subcategory.slug}
              label={subcategory.name}
              href={{
                pathname: '/categories/[category]/[subcategory]',
                params: { category: category.slug, subcategory: subcategory.slug },
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const ON_WHITE = TONES.white;

/** The category's name, beside its accent badge, as a link to its landing page. */
function CategoryRow({ category }: { readonly category: Category }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const tone = accents[categoryLook(category.slug).accent];
  return (
    <Link href={{ pathname: '/categories/[category]', params: { category: category.slug } }} asChild>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={category.name}
        onFocus={onFocus}
        onBlur={onBlur}
        contentStyle={({ pressed }) => [
          styles.row,
          pressed ? { backgroundColor: BLOCK.white.pressed } : null,
          ring,
        ]}
      >
        <View style={[styles.badge, { backgroundColor: tone.surface }]}>
          <Icon icon={categoryGlyph(category.slug)} variant="bulk" size={22} color={tone.text} />
        </View>
        <CardTitle accessibilityRole="header" style={styles.name}>
          {category.name}
        </CardTitle>
        <Icon icon={Glyphs.ArrowRight} size={18} color={ON_WHITE.tertiary} />
      </PressableScale>
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

/** Three groups' worth of placeholder: a row and three short pills each. */
function IndexSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.groups}>
        {[0, 1, 2].map((group) => (
          <View key={group} style={styles.group}>
            <Skeleton height={lineHeight.h3} width="50%" radius="sm" />
            <View style={styles.chips}>
              {[0, 1, 2].map((pill) => (
                <Skeleton key={pill} height={spacing[8]} width={spacing[20]} radius="lg" />
              ))}
            </View>
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** A stack route: no tab bar under it, so the page owns the bottom inset. */
const EDGES = ['left', 'right', 'bottom'] as const;

/** The accent badge beside a category's name. */
const BADGE = spacing[10];

const styles = StyleSheet.create({
  titles: { gap: spacing[2], paddingTop: spacing[4], paddingBottom: spacing[4] },
  groups: { gap: spacing[6] },
  group: { gap: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: size.touchTarget,
    paddingVertical: spacing[1],
    borderRadius: radius.lg,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[2] },
  unavailable: { gap: spacing[4] },
  inlineLink: { color: colors.textPrimary, textDecorationLine: 'underline' },
  retry: { flexDirection: 'row' },
});
