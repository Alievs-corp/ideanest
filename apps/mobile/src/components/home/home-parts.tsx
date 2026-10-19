import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { Glyphs } from '../../icons';
import type { Category } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { FadeUp } from '../motion';
import { categoryLook } from '@ideanest/discovery/category-look';
import { categoryGlyph } from '../browse/category-look';
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
import { HeroLoopCard } from './hero-loop';

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
 * Each tile is an `AccentCard` in the category's accent, with the category's icon, both from
 * `@ideanest/discovery/category-look` (#335) — the table the web reads too — so a
 * category keeps its colour wherever it is drawn. The accent is decoration: the name and the icon
 * say what the tile is, never the hue.
 */

export interface HomeHeroProps {
  readonly onBrowse: () => void;
  readonly onStart: () => void;
}

/**
 * The web home's hero at phone width (#490): the heading, the scene card with the standfirst's
 * facts playing over it, and the two actions side by side. The standfirst is the card's accessible
 * name rather than a paragraph on screen. Static copy, so it draws at once.
 */
export function HomeHero({ onBrowse, onStart }: HomeHeroProps) {
  const t = useT('home.hero');
  return (
    <FadeUp index={0}>
      <View style={styles.hero}>
        {/*
          Two lines, as on the web: at a large system font the heading shrinks to fit them rather
          than taking a third, and its name stays whole for a screen reader.
        */}
        <Display
          accessibilityRole="header"
          accessibilityLabel={t('title')}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.title}
        >
          {t('title')}
        </Display>
        <HeroLoopCard
          label={t('standfirst')}
          lines={[t('phoneLines.creator'), t('phoneLines.backers'), t('phoneLines.success'), t('sceneCaption')]}
        />
        <View style={styles.actions}>
          <View style={styles.action}>
            <Pill label={t('browse')} size="lg" fullWidth fit onPress={onBrowse} />
          </View>
          <View style={styles.action}>
            <Pill label={t('start')} variant="outline" size="lg" fullWidth fit onPress={onStart} />
          </View>
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
      {children}
      {/*
        THE WAY ON IS A BUTTON UNDER THE CARD, as on the web's phone layout: the section shows
        one campaign and the reader decides whether to see the rest after looking at it.
      */}
      <SectionLink href={href} label={linkLabel} />
    </View>
  );
}

/** "See all" as a small raised pill with the press give. */
function SectionLink({ href, label }: { readonly href: Href; readonly label: string }) {
  const t = useT('home');
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <View>
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
          <Text style={styles.linkLabel}>{t('seeAll')}</Text>
          <Icon icon={Glyphs.ArrowRight} size={16} color={TONES.dark.secondary} />
        </PressableScale>
      </Link>
    </View>
  );
}

/** "Browse by category": accent tiles in two columns, each a link to its category. */
/** One page a creator reads before starting: its title, its own description, and where it is. */
export interface CreatorPage {
  readonly href: Href;
  readonly title: string;
  readonly body: string;
}

/**
 * "For creators" — the web's editorial band (`app/[locale]/(site)/page.tsx`): how it works,
 * pricing, and trust and safety, one under another. Each row is a raised dark block (§2: never a
 * border-only box) and the whole row is the link, so there is no "Learn more" saying nothing.
 * The words are each page's own `metaTitle` and `metaDescription`, so the row cannot promise
 * what the page does not say.
 */
export function CreatorPages({ pages }: { readonly pages: readonly CreatorPage[] }) {
  return (
    <View style={styles.pages}>
      {pages.map((page) => (
        <CreatorPageRow key={page.title} page={page} />
      ))}
    </View>
  );
}

function CreatorPageRow({ page }: { readonly page: CreatorPage }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Link href={page.href} asChild>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={page.title}
        accessibilityHint={page.body}
        onFocus={onFocus}
        onBlur={onBlur}
        contentStyle={({ pressed }) => [
          styles.page,
          { backgroundColor: pressed ? BLOCK.dark.pressed : BLOCK.dark.rest },
          ring,
        ]}
      >
        <View style={styles.pageText}>
          <CardTitle>{page.title}</CardTitle>
          <Body>{page.body}</Body>
        </View>
        <Icon icon={Glyphs.ArrowRight} size={18} color={TONES.dark.secondary} />
      </PressableScale>
    </Link>
  );
}

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
          <AccentCard accent={categoryLook(slug).accent}>
            <View style={styles.tileTop}>
              <Icon icon={categoryGlyph(slug)} variant="bulk" size={26} color={ON_ACCENT.primary} />
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

/** The web hero's phone heading is `text-3xl`, 30px: three quarters of the display size. */
const PHONE_TITLE = 0.75;

/** An accent tile's floor: the card's own minimum, so a long name grows it rather than clips. */
const TILE_HEIGHT = 120;

const styles = StyleSheet.create({
  hero: { gap: spacing[6], paddingTop: spacing[4] },
  /* The web's phone heading: the display style at three quarters, 30px, so it takes two lines. */
  title: {
    fontSize: fontSize.display * PHONE_TITLE,
    lineHeight: Math.round(lineHeight.display * PHONE_TITLE),
    letterSpacing: tracking.display * PHONE_TITLE,
  },
  actions: { flexDirection: 'row', gap: spacing[2] },
  action: { flex: 1 },
  section: { gap: spacing[4] },
  titles: { gap: spacing[2] },
  /* Full width under the card, the web phone layout's button. */
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: size.touchTarget,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  linkLabel: {
    flexShrink: 1,
    textAlign: 'center',
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: TONES.dark.primary,
  },
  pages: { gap: spacing[3] },
  page: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    padding: spacing[5],
    borderRadius: radius.xl,
  },
  pageText: { flex: 1, gap: spacing[2] },
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
