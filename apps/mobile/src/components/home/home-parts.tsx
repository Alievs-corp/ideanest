import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { Glyphs } from '../../icons';
import type { Category } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { FadeUp } from '../motion';
import { Body, Display, Heading } from '../text';
import { Icon, Pill, Skeleton, SkeletonCard, SkeletonGroup, useFocusRing } from '../ui';

/**
 * The pieces of the Home tab — the web home's inline hero and `HomeSection` (issue #153).
 *
 * <h2>No lime in the hero</h2>
 *
 * §1.1 allows one lime element among a set, and Home spends it where it means something: the
 * urgency tag on a campaign closing within 48 hours, in the Ending soon rail. The hero's actions
 * are a white pill and an outline pill, as on the web.
 */

export interface HomeHeroProps {
  readonly onBrowse: () => void;
  readonly onStart: () => void;
}

/** A heading, the 80% rule in a sentence, and two actions. Static copy, so it draws at once. */
export function HomeHero({ onBrowse, onStart }: HomeHeroProps) {
  const t = useT('home.hero');
  return (
    <FadeUp>
      <View style={styles.hero}>
        <Display accessibilityRole="header">{t('title')}</Display>
        <Body>{t('standfirst')}</Body>
        <View style={styles.actions}>
          <Pill label={t('browse')} iconRight={Glyphs.ArrowRight} size="lg" onPress={onBrowse} />
          <Pill label={t('start')} variant="outline" size="lg" onPress={onStart} />
        </View>
      </View>
    </FadeUp>
  );
}

export interface HomeSectionProps {
  readonly heading: string;
  readonly standfirst: string;
  readonly href: Href;
  readonly linkLabel: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/** A rail: its heading and standfirst fade up once; the link and the cards below never move. */
export function HomeSection({
  heading,
  standfirst,
  href,
  linkLabel,
  children,
  testID,
}: HomeSectionProps) {
  return (
    <View style={styles.section} testID={testID}>
      <FadeUp>
        <View style={styles.titles}>
          <Heading accessibilityRole="header">{heading}</Heading>
          <Body>{standfirst}</Body>
        </View>
      </FadeUp>
      <SectionLink href={href} label={linkLabel} />
      {children}
    </View>
  );
}

function SectionLink({ href, label }: { readonly href: Href; readonly label: string }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => [styles.link, pressed && styles.linkPressed, ring]}
      >
        <Text style={styles.linkLabel}>{label}</Text>
        <Icon icon={Glyphs.ArrowRight} size={16} color={colors.textSecondary} />
      </Pressable>
    </Link>
  );
}

/** "Browse by category": tiles in two columns, each a link to its category. */
export function CategoryTiles({ categories }: { readonly categories: readonly Category[] }) {
  return (
    <View style={styles.grid}>
      {categories.map((category) => (
        <CategoryTile key={category.id ?? category.slug} category={category} />
      ))}
    </View>
  );
}

function CategoryTile({ category }: { readonly category: Category }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const slug = category.slug ?? '';
  const name = category.name ?? slug;
  return (
    <View style={styles.cell}>
      <Link href={{ pathname: '/categories/[category]', params: { category: slug } }} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={name}
          onFocus={onFocus}
          onBlur={onBlur}
          style={({ pressed }) => [styles.tile, pressed && styles.tilePressed, ring]}
        >
          <Text style={styles.tileName}>{name}</Text>
          <Icon icon={Glyphs.ArrowRight} size={16} color={colors.textTertiary} />
        </Pressable>
      </Link>
    </View>
  );
}

/** A rail before it loads: its heading, then two cards. */
export function RailSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.section}>
        <View style={styles.titles}>
          <Skeleton height={lineHeight.h2} width="60%" radius="sm" />
          <Skeleton height={lineHeight.body} width="90%" radius="sm" />
        </View>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    </SkeletonGroup>
  );
}

/** Six tiles' worth of placeholder. */
export function TilesSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={styles.cell}>
            <Skeleton height={size.touchTarget + spacing[4]} radius="md" />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** Both campaign rails came back empty: say what is true either way, and offer the feed. */
export function HomeEmpty({ onOpenFeed }: { readonly onOpenFeed: () => void }) {
  const t = useT('home.empty');
  return (
    <View style={styles.empty} testID="home-empty">
      <Text accessibilityRole="header" style={styles.emptyHeading}>
        {t('heading')}
      </Text>
      <Body style={styles.centred}>{t('body')}</Body>
      <Pill label={t('action')} onPress={onOpenFeed} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing[4], paddingTop: spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], paddingTop: spacing[2] },
  section: { gap: spacing[4] },
  titles: { gap: spacing[2] },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: size.touchTarget,
    borderRadius: radius.sm,
  },
  linkPressed: { opacity: 0.64 },
  linkLabel: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing[3] / 2, rowGap: spacing[3] },
  cell: { width: '50%', paddingHorizontal: spacing[3] / 2 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    minHeight: size.touchTarget + spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  tilePressed: { backgroundColor: colors.surface3 },
  tileName: {
    ...font.medium,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
  empty: {
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[12],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  emptyHeading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  centred: { textAlign: 'center' },
});
