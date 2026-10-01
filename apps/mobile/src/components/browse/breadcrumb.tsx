import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { useFocusRing } from '../ui';

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
 * Small and white/40, the links white/40 and the current page white/64, separated by a slash that
 * is drawn and never read. The container carries the catalogue's name (`common.breadcrumb`, or the
 * collection header's own), so a screen reader that lands on it out of context is told what it is.
 * Each link is a 44pt target; the current page is plain text, not a link to itself.
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
  return (
    <View accessibilityLabel={label} style={styles.trail} testID={testID}>
      {crumbs.map((crumb, index) => (
        <View key={`${index}-${crumb.label}`} style={styles.item}>
          {index > 0 ? (
            <Text
              style={styles.separator}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              /
            </Text>
          ) : null}
          {crumb.href === undefined ? (
            <Text style={styles.current}>{crumb.label}</Text>
          ) : (
            <CrumbLink label={crumb.label} href={crumb.href} />
          )}
        </View>
      ))}
    </View>
  );
}

function CrumbLink({ label, href }: { readonly label: string; readonly href: Href }) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => [styles.link, pressed && styles.pressed, ring]}
      >
        <Text style={styles.linkLabel}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const text = {
  ...font.regular,
  fontSize: fontSize.sm,
  lineHeight: lineHeight.small,
} as const;

const styles = StyleSheet.create({
  trail: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[2] },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  link: { minHeight: size.touchTarget, justifyContent: 'center', borderRadius: radius.sm },
  pressed: { opacity: 0.64 },
  linkLabel: { ...text, color: colors.textTertiary },
  separator: { ...text, color: colors.textTertiary },
  // The web's `text-white/64` on the current page.
  current: {
    ...text,
    color: colors.textSecondary,
    paddingVertical: (size.touchTarget - lineHeight.small) / 2,
  },
});
