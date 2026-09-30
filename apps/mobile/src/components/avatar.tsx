import { StyleSheet, View } from 'react-native';
import { colors, fontWeight, radius, size as sizes } from '../theme';
import { Meta } from './text';

/**
 * A person's face, or their initials when there is no picture — issue #150.
 *
 * The native half of `@ideanest/ui`'s `Avatar`: the same circle on `--surface-3`, the same
 * two-initial fallback, the same `text-white/64`. `GET /v1/me` carries no picture yet, so the
 * fallback is the whole component for now; the image branch arrives with the profile issue,
 * which is where a picture URL first exists.
 *
 * <p>`decorative` for the places the name is already written beside it. `Avatar` labels itself
 * with the name when it stands alone, and inside a row that already says the name that is the
 * name announced twice — the reason the web's `AccountMenu` hides it as well.
 */
export function Avatar({
  name,
  size = sizes.avatarInCard,
  decorative = false,
}: {
  readonly name: string;
  readonly size?: number;
  readonly decorative?: boolean;
}) {
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : name}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[styles.circle, { width: size, height: size }]}
    >
      <Meta tone="secondary" style={styles.initials}>
        {initials(name)}
      </Meta>
    </View>
  );
}

/** "Aysel Məmmədova" → "AM", as the web draws it: the first letter of the first two words. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.full,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontWeight: fontWeight.medium },
});
