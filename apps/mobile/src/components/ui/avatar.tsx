import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, font, fontSize, radius, size as measure } from '../../theme';
import { TONES, blockSurface, useSurface, type BlockSurface } from './surface';

/**
 * A person's face, or their initials — the native `Avatar` (`docs/ui-kit.md` §7.6).
 *
 * <p>The web's sizes — xs 24, sm 28, md 40, lg 56 — the last three being `size.avatarInGroup`,
 * `size.avatarInCard` and `size.avatarOnProfile`. A 2pt ring in the colour of the surface beneath
 * (`surface-1` on the canvas, `whiteSurface` in a white sheet) separates a face from whatever it
 * overlaps, drawn as an outline so it takes no layout — the same ring `AvatarStack`'s `+N` pill
 * wears, so a stack reads as one row.
 *
 * <p>The picture is `expo-image`, which caches to disk and decodes off the main thread. Without a
 * picture — or when the one given fails to load — it draws the first letter of the first two
 * words: on `surface-3` in white/64 on the canvas, on `whiteMuted` in on-white/64 in a white sheet
 * (`mobile-design` skill §2: dark text tokens are never used on white).
 *
 * <h2>Decorative beside a name, labelled alone</h2>
 *
 * Inside a row that already says "Aysel Məmmədova", the avatar announcing the same name is the
 * name read twice — so `decorative` hides it. Standing alone it is an image named by the person,
 * which is what the web's `alt` and `aria-label` do.
 *
 * <p>It replaced the app's first `components/avatar.tsx`, which drew only the initials; the Me
 * tab's identity row uses this one.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIDE: Record<AvatarSize, number> = {
  xs: 24,
  sm: measure.avatarInGroup,
  md: measure.avatarInCard,
  lg: measure.avatarOnProfile,
};

/** The web's `text-[10px]`, `text-[11px]`, `text-sm` and `text-lg`. */
const INITIALS: Record<AvatarSize, number> = {
  xs: 10,
  sm: fontSize.xxs,
  md: fontSize.sm,
  lg: fontSize.lg,
};

export interface AvatarProps {
  /** The person's name: the accessible name, and where the initials come from. */
  readonly name: string;
  /** A picture URL. Absent, empty or failing, the initials are drawn instead. */
  readonly src?: string | null;
  readonly size?: AvatarSize;
  /** True when the name is already written beside the avatar. */
  readonly decorative?: boolean;
  readonly testID?: string;
}

export function Avatar({ name, src, size = 'md', decorative = false, testID }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const block = blockSurface(useSurface());
  const side = SIDE[size];
  const picture = src !== undefined && src !== null && src !== '' && failed !== src ? src : null;

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : name}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      testID={testID}
      style={[styles.circle, SKIN[block], { width: side, height: side }]}
    >
      {picture === null ? (
        <Text
          style={[styles.initials, { fontSize: INITIALS[size], color: TONES[block].secondary }]}
          // The circle carries the name; two letters of it are not a second announcement.
          accessibilityElementsHidden
          importantForAccessibility="no"
          // Decorative and inside a circle of fixed size, so Dynamic Type growing them only pushes
          // them past the edge; the name the circle announces is what a larger text setting needs.
          maxFontSizeMultiplier={1}
        >
          {initials(name)}
        </Text>
      ) : (
        <Image
          source={{ uri: picture }}
          style={styles.fill}
          contentFit="cover"
          // A face swapping in over initials is a change of content, not a motion to smooth.
          transition={0}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
          // Remembered per URL, so a new picture gets its own chance to load.
          onError={() => setFailed(picture)}
        />
      )}
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

/** The circle's fill and ring per surface — `AvatarStack`'s `+N` pill uses the same pair. */
const SKIN: Record<BlockSurface, { backgroundColor: string; outlineColor: string }> = {
  dark: { backgroundColor: colors.surface3, outlineColor: colors.surface1 },
  white: { backgroundColor: colors.whiteMuted, outlineColor: colors.whiteSurface },
};

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    outlineWidth: 2,
    outlineStyle: 'solid',
  },
  fill: { width: '100%', height: '100%' },
  initials: { ...font.medium },
});
