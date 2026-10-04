import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, shadow, size as measure, spacing } from '../../theme';
import { useFocusRing } from './focus';
import { usePressScale } from './press-scale';
import { SurfaceProvider, type Surface } from './surface';

/**
 * The system's primary surface — the native `Card` (`docs/ui-kit.md` §7.1).
 *
 * <h2>Three variants, and they are state, not elevation</h2>
 *
 * <ul>
 *   <li>`default` — an ordinary item: surface-2 with a white/8 hairline.</li>
 *   <li>`active` — current, priority, **urgent**: a lime surface. Not "successful": a funded
 *       campaign is `success`, and a lime card that means "done" tells a backer the opposite of
 *       the truth (CLAUDE.md §2).</li>
 *   <li>`floating` — something above the system: white, near-black text, `shadow.float`.</li>
 * </ul>
 *
 * <h2>The card tells its children where they are</h2>
 *
 * The web marks a lime card `data-on-lime` and every descendant's colour switches under it. React
 * Native has no cascade, so `active` wraps its children in `SurfaceProvider surface="lime"` and
 * `floating` in `surface="white"`: a `Body` inside asks for `secondary` and gets on-lime/72 or
 * on-white/64 instead of a white/64 nobody can read. An `IconButton` or a `Tag` inside does the
 * same. The provider is the whole reason this component exists rather than a `View` with a
 * background colour at each call site.
 *
 * <h2>Pressed, not lifted</h2>
 *
 * With `onPress` the card is one control. The web lifts an interactive card 2px on hover; a phone
 * has no hover, and a lift under a finger is a card moving away from the thumb pressing it. So the
 * pressed state is a background swap on the frame the finger lands, and the card gives slightly
 * under the thumb (`usePressScale`, `mobile-design` skill §6.3). A caller's `style` lays out the
 * scaled wrapper.
 */

export type CardVariant = 'default' | 'active' | 'floating';
export type CardSize = 'sm' | 'md' | 'lg';

/** The web's `rounded-md p-4`, `rounded-lg p-5` and `rounded-xl p-6`. */
const SHAPE: Record<CardSize, ViewStyle> = {
  sm: { borderRadius: radius.md, padding: spacing[4] },
  md: { borderRadius: radius.lg, padding: measure.cardPaddingSmall },
  lg: { borderRadius: radius.xl, padding: measure.cardPaddingLarge },
};

const SKIN: Record<CardVariant, { rest: ViewStyle; pressed: ViewStyle; surface: Surface }> = {
  default: {
    rest: { backgroundColor: colors.surface2, borderColor: colors.border },
    pressed: { backgroundColor: colors.surface3, borderColor: colors.border },
    surface: 'dark',
  },
  active: {
    rest: { backgroundColor: colors.lime500, borderColor: 'transparent' },
    pressed: { backgroundColor: colors.lime600, borderColor: 'transparent' },
    surface: 'lime',
  },
  floating: {
    rest: {
      backgroundColor: colors.whiteSurface,
      borderColor: 'transparent',
      boxShadow: shadow.float,
    },
    pressed: {
      backgroundColor: colors.whiteMuted,
      borderColor: 'transparent',
      boxShadow: shadow.float,
    },
    surface: 'white',
  },
};

interface CardBaseProps {
  readonly variant?: CardVariant;
  readonly size?: CardSize;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * A card that is a control. The accessible name is optional because a card's own text usually is
 * one — VoiceOver and TalkBack read an accessible container's text — but a card whose text is
 * long, or starts with a figure, is better named by the caller.
 */
interface InteractiveCardProps extends CardBaseProps {
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  /** `button` by default; `link` for a card that navigates, `radio` inside a choice group. */
  readonly accessibilityRole?: Extract<AccessibilityRole, 'button' | 'link' | 'radio'>;
  /** A chosen reward, a checked option — announced, never left to the lime. */
  readonly selected?: boolean;
  readonly disabled?: boolean;
}

interface StaticCardProps extends CardBaseProps {
  readonly onPress?: undefined;
}

export type CardProps = InteractiveCardProps | StaticCardProps;

export function Card(props: CardProps) {
  const { variant = 'default', size = 'md', children, style, testID } = props;
  const skin = SKIN[variant];
  // The ring is drawn outside the card, on whatever the card sits on — so it asks the outer
  // surface, not the one the card provides to its children.
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();

  const content = <SurfaceProvider surface={skin.surface}>{children}</SurfaceProvider>;

  if (props.onPress === undefined) {
    return (
      <View style={[styles.card, SHAPE[size], skin.rest, style]} testID={testID}>
        {content}
      </View>
    );
  }

  const { onPress, accessibilityLabel, accessibilityHint, selected, disabled = false } = props;
  const role = props.accessibilityRole ?? 'button';

  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          disabled,
          ...(selected === undefined ? {} : role === 'radio' ? { checked: selected } : { selected }),
        }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [
          styles.card,
          styles.interactive,
          SHAPE[size],
          pressed && !disabled ? skin.pressed : skin.rest,
          disabled && styles.disabled,
          ring,
        ]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  // Every card is taller than a thumb once it holds a line of text; this is for the one that is
  // not, so the minimum holds whatever the caller puts in it.
  interactive: { minHeight: measure.touchTarget },
  disabled: { opacity: 0.4 },
});
