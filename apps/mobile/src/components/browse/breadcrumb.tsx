import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Link, type Href } from 'expo-router';
import { Glyphs } from '../../icons';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { Icon, TONES, useFocusRing, usePressScale, useSurface } from '../ui';
import { BLOCK, blockSurface } from '../ui/surface';

/**
 * The trail above a browse page's heading — the web's `<nav aria-label="Breadcrumb">` on the
 * category and collection landings (issue #154).
 *
 * <h2>Why a phone keeps it, under a header with a back button</h2>
 *
 * A link opens these screens with no back stack: somebody taps a shared
 * `/categories/games/tabletop` and lands on it cold, where Back leaves the app. The web's own
 * comment on `CategoryLanding` says a page must never leave the reader "with no way up", and the
 * trail is that way up — on a phone exactly as in a browser.
 *
 * <h2>What it says</h2>
 *
 * Each step up is a small raised pill (`mobile-design` skill §2) with the press give, inside a
 * 44pt target; the current page is plain text, not a link to itself. A chevron between steps is
 * drawn and never read. The container carries the catalogue's name (`common.breadcrumb`, or the
 * collection header's own), so a screen reader that lands on it out of context is told what it is.
 */

export interface Crumb {
  readonly label: string;
  /** Absent for the current page, which is the last crumb and not a link. */
  readonly href?: Href;
}

export interface BreadcrumbProps {
  readonly label: string;
  readonly crumbs: readonly Crumb[];
  readonly testID?: string;
}

export function Breadcrumb({ label, crumbs, testID }: BreadcrumbProps) {
  const tones = TONES[useSurface()];
  return (
    <View accessibilityLabel={label} style={styles.trail} testID={testID}>
      {crumbs.map((crumb, index) => (
        <View key={`${index}-${crumb.label}`} style={styles.item}>
          {index > 0 ? <Icon icon={Glyphs.ArrowRight2} size={14} color={tones.tertiary} /> : null}
          {crumb.href === undefined ? (
            <Text style={[styles.text, styles.current, { color: tones.secondary }]}>
              {crumb.label}
            </Text>
          ) : (
            <LinkPill label={crumb.label} href={crumb.href} dense />
          )}
        </View>
      ))}
    </View>
  );
}

export interface LinkPillProps {
  readonly label: string;
  readonly href: Href;
  /** The trail's smaller pill; the chips under a heading take the full one. */
  readonly dense?: boolean;
}

/**
 * A link drawn as a small raised pill — a step up the trail, a subcategory under its category.
 * The press gives (`usePressScale`) and the pressed fill swaps; the hit area is always 44pt.
 */
export function LinkPill({ label, href, dense = false }: LinkPillProps) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const surface = useSurface();
  const block = BLOCK[blockSurface(surface)];
  return (
    <Animated.View style={press.style}>
      <Link href={href} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={label}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onFocus={onFocus}
          onBlur={onBlur}
          style={styles.target}
        >
          <View
            style={[
              styles.pill,
              { minHeight: dense ? DENSE_HEIGHT : PILL_HEIGHT },
              { backgroundColor: press.pressed ? block.pressed : block.rest },
              ring,
            ]}
          >
            <Text style={[styles.text, { color: TONES[surface].primary }]}>{label}</Text>
          </View>
        </Pressable>
      </Link>
    </Animated.View>
  );
}

/** The pills' own heights; the target around them is `size.touchTarget`. */
export const PILL_HEIGHT = size.touchTarget - spacing[2];
const DENSE_HEIGHT = spacing[8];

const styles = StyleSheet.create({
  trail: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[2] },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  target: { minHeight: size.touchTarget, justifyContent: 'center' },
  pill: {
    // The height is a floor, so a larger text size grows the pill instead of clipping it.
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
  },
  text: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  current: { paddingVertical: (size.touchTarget - lineHeight.small) / 2 },
});
