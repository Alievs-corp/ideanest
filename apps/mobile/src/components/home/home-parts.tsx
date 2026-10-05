import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { Glyphs } from '../../icons';
import type { Category } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { FadeUp } from '../motion';
import { accentFor } from '../project-card';
import { Body, CardTitle, Display, Heading } from '../text';
import {
  AccentCard,
  EmptyState,
  Icon,
  Pill,
  PressableScale,
  Skeleton,
  SkeletonCard,
  SkeletonGroup,
  TONES,
  useFocusRing,
} from '../ui';
import { BLOCK } from '../ui/surface';

/**
 * The pieces of the Home tab — the web home's inline hero and `HomeSection` (issue #153), in the
 * `mobile-design` skill's language (#281).
 *
 * <h2>No lime in the hero, and no hero figure</h2>
 *
 * §1.1 allows one lime element among a set, and Home spends it where it means something: the
 * urgency tag on a campaign closing within 48 hours, in the Ending soon rail. The hero's actions
 * are a white pill and an outline pill, as on the web. Home has no key number of its own, so it
 * draws no `HeroFigure` (skill §2: one only where there is a real figure).
 *
 * <h2>Category tiles are accent cards</h2>
 *
 * Each tile is an `AccentCard` whose accent is hashed from the category (`accentFor`), so a
 * category keeps its colour wherever it is drawn. The accent is decoration: the name and the icon
 * say what the tile is, never the hue.
 */

export interface HomeHeroProps {
  readonly onBrowse: () => void;
  readonly onStart: () => void;
}

/** A heading, the 80% rule in a sentence, and two actions. Static copy, so it draws at once. */
export function HomeHero({ onBrowse, onStart }: HomeHeroProps) {
  const t = useT('home.hero');
  return (
    <FadeUp index={0}>
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
  /** The section's place on the screen, for the entry stagger. */
  readonly index?: number;
  readonly testID?: string;
}

/** A rail: its heading and standfirst fade up once; the link and the cards below never move. */
export function HomeSection({
  heading,
  standfirst,
  href,
  linkLabel,
  children,
  index = 1,
  testID,
}: HomeSectionProps) {
  return (
    <View style={styles.section} testID={testID}>
      <FadeUp index={index}>
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

/** "See all" as a small raised pill with the press give. */
function SectionLink({ href, label }: { readonly href: Href; readonly label: string }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <View style={styles.linkRow}>
      <Link href={href} asChild>
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={label}
          onFocus={onFocus}
          onBlur={onBlur}
          contentStyle={({ pressed }) => [
            styles.link,
            { backgroundColor: pressed ? BLOCK.dark.pressed : BLOCK.dark.rest },
            ring,
          ]}
        >
          <Text style={styles.linkLabel}>{label}</Text>
          <Icon icon={Glyphs.ArrowRight} size={16} color={TONES.dark.secondary} />
        </PressableScale>
      </Link>
    </View>
  );
}

/** "Browse by category": accent tiles in two columns, each a link to its category. */
export function CategoryTiles({ categories }: { readonly categories: readonly Category[] }) {
  return (
    <View style={styles.grid}>
      {categories.map((category) => (
        <CategoryTile key={category.id ?? category.slug} category={category} />
      ))}
    </View>
  );
}

const ON_ACCENT = TONES.accent;

function CategoryTile({ category }: { readonly category: Category }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const slug = category.slug ?? '';
  const name = category.name ?? slug;
  return (
    <View style={styles.cell}>
      <Link href={{ pathname: '/categories/[category]', params: { category: slug } }} asChild>
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={name}
          onFocus={onFocus}
          onBlur={onBlur}
          contentStyle={[styles.tileTarget, ring]}
        >
          <AccentCard accent={accentFor({ id: category.id, slug, title: name })}>
            <View style={styles.tileTop}>
              <Icon icon={Glyphs.Category} variant="bulk" size={24} color={ON_ACCENT.primary} />
              <Icon icon={Glyphs.ArrowRight} size={16} color={ON_ACCENT.secondary} />
            </View>
            <CardTitle numberOfLines={2} style={styles.tileName}>
              {name}
            </CardTitle>
          </AccentCard>
        </PressableScale>
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

/** Six tiles' worth of placeholder, each the height of an accent tile. */
export function TilesSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={styles.cell}>
            <Skeleton height={TILE_HEIGHT} radius="lg" />
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
    <EmptyState
      icon={Glyphs.Discover}
      title={t('heading')}
      description={t('body')}
      action={<Pill label={t('action')} onPress={onOpenFeed} />}
      testID="home-empty"
    />
  );
}

/** An accent tile's floor: the card's own minimum, so a long name grows it rather than clips. */
const TILE_HEIGHT = 120;

const styles = StyleSheet.create({
  hero: { gap: spacing[4], paddingTop: spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], paddingTop: spacing[2] },
  section: { gap: spacing[4] },
  titles: { gap: spacing[2] },
  linkRow: { flexDirection: 'row' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: size.touchTarget,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  linkLabel: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: TONES.dark.primary,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing[3] / 2, rowGap: spacing[3] },
  cell: { width: '50%', paddingHorizontal: spacing[3] / 2 },
  tileTarget: { borderRadius: radius.xl },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexGrow: 1 },
  /*
   * One step below the card title (17 rather than 18): a category name is one or two words that
   * must fit half a phone's width, and the line height stays the card title's so a tile keeps its
   * height.
   */
  tileName: { fontSize: fontSize.reading },
});
