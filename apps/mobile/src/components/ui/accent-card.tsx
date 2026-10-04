import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { accent as accents, radius, spacing, type Accent } from '../../theme';
import { useFocusRing } from './focus';
import { AnimatedPressable, usePressScale } from './press-scale';
import { SurfaceProvider } from './surface';

/**
 * A campaign or collection card on a mobile accent — issue #277, `mobile-design` skill §2 and §4.
 *
 * The accent is the whole surface, with a soft glow of the same hue under it (the token's own
 * `glow`, never a new colour). Accents carry no meaning — not status, not urgency — so this is a
 * decoration choice, and the text inside reads in the `accent` surface's near-black tones.
 *
 * `action` sits overhanging the top-right corner: the reference app's circular translucent button
 * (`IconButton variant="translucent"`) half off the card's edge. With `onPress` the card is one
 * pressable surface with `PressableScale`'s give.
 */

export interface AccentCardProps {
  readonly accent: Accent;
  readonly children: ReactNode;
  readonly onPress?: () => void;
  /** Required with `onPress`: what the card opens. */
  readonly accessibilityLabel?: string;
  readonly action?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /**
   * False draws the card without its glow, for a parent that draws the glow itself and times it
   * (`CardStack` fades the glows in after the cards settle).
   */
  readonly glow?: boolean;
  readonly testID?: string;
}

/** The soft same-hue glow under an accent card: the accent's own `glow` token, never a new colour. */
export function accentGlow(accent: Accent): ViewStyle['boxShadow'] {
  return [
    { offsetX: 0, offsetY: 16, blurRadius: 32, spreadDistance: -12, color: accents[accent].glow },
  ];
}

export function AccentCard({
  accent,
  children,
  onPress,
  accessibilityLabel,
  action,
  style,
  glow = true,
  testID,
}: AccentCardProps) {
  const press = usePressScale();
  const ring = useFocusRing();
  const tone = accents[accent];
  const skin = [
    styles.card,
    {
      backgroundColor: tone.surface,
      boxShadow: glow ? accentGlow(accent) : undefined,
    },
  ];

  const body = (
    <SurfaceProvider surface="accent">
      {children}
    </SurfaceProvider>
  );

  return (
    <View style={[styles.frame, action === undefined ? null : styles.withAction, style]} testID={testID}>
      {onPress === undefined ? (
        <View style={skin}>{body}</View>
      ) : (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onFocus={ring.onFocus}
          onBlur={ring.onBlur}
          style={[skin, ring.ring, press.style]}
        >
          {body}
        </AnimatedPressable>
      )}
      {action === undefined ? null : (
        <View style={styles.action}>
          <SurfaceProvider surface="accent">{action}</SurfaceProvider>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative' },
  withAction: { paddingTop: spacing[3] },
  card: {
    flexGrow: 1,
    borderRadius: radius.xl,
    padding: spacing[5],
    gap: spacing[3],
    minHeight: 120,
  },
  action: { position: 'absolute', top: 0, right: spacing[4] },
});
