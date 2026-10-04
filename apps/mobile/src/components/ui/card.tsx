import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, shadow, size as measure, spacing } from '../../theme';
import { useFocusRing } from './focus';
import { AnimatedPressable, usePressScale } from './press-scale';
import { BLOCK, SurfaceProvider, blockSurface, useSurface, type Surface } from './surface';

/**
 * The system's primary surface — the native `Card` (`docs/ui-kit.md` §7.1), in the `mobile-design`
 * skill's language (§2): a filled, generously rounded block, never a border-only box.
 *
 * <h2>Three variants, and they are state, not elevation</h2>
 *
 * <ul>
 *   <li>`default` — an ordinary item: a raised block. `surface2` on the dark canvas; inside a white
 *       sheet (`useSurface() === 'white'`) the sheet's nested `whiteMuted` block, with on-white
 *       text.</li>
 *   <li>`active` — current, priority, **urgent**: a lime surface. Not "successful": a funded
 *       campaign is `success`, and a lime card that means "done" tells a backer the opposite of
 *       the truth (CLAUDE.md §2).</li>
 *   <li>`floating` — something above the system: white, near-black text, `shadow.float`.</li>
 * </ul>
 *
 * <h2>The card tells its children where they are</h2>
 *
 * React Native has no cascade, so the card wraps its children in the `SurfaceProvider` of its own
 * fill — `lime`, `white`, or the default block's `dark`/`white` — and a `Body` inside asks for
 * `secondary` and gets the tone that is legible on it. An `IconButton` or a `Tag` inside does the
 * same.
 *
 * <h2>Pressed, not lifted</h2>
 *
 * With `onPress` the card is one control: the background swaps on the frame the finger lands and the
 * card gives slightly under the thumb (`usePressScale`, `mobile-design` skill §6.3). Under Reduce
 * Motion the swap is the whole response.
 */

export type CardVariant = 'default' | 'active' | 'floating';
export type CardSize = 'sm' | 'md' | 'lg';

/** Generous corners (skill §2): `radius.lg` for the dense `sm`, `radius.xl` from `md` up. */
const SHAPE: Record<CardSize, ViewStyle> = {
  sm: { borderRadius: radius.lg, padding: spacing[4] },
  md: { borderRadius: radius.xl, padding: measure.cardPaddingSmall },
  lg: { borderRadius: radius.xl, padding: measure.cardPaddingLarge },
};

interface Skin {
  readonly rest: ViewStyle;
  readonly pressed: ViewStyle;
  readonly surface: Surface;
}

function skinOf(variant: CardVariant, outer: Surface): Skin {
  if (variant === 'active') {
    return {
      rest: { backgroundColor: colors.lime500 },
      pressed: { backgroundColor: colors.lime600 },
      surface: 'lime',
    };
  }
  if (variant === 'floating') {
    return {
      rest: { backgroundColor: colors.whiteSurface, boxShadow: shadow.float },
      pressed: { backgroundColor: colors.whiteMuted, boxShadow: shadow.float },
      surface: 'white',
    };
  }
  const block = blockSurface(outer);
  return {
    rest: { backgroundColor: BLOCK[block].rest },
    pressed: { backgroundColor: BLOCK[block].pressed },
    surface: block,
  };
}

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
  const skin = skinOf(variant, useSurface());
  // The ring is drawn outside the card, on whatever the card sits on — so it asks the outer
  // surface, not the one the card provides to its children.
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();

  const content = <SurfaceProvider surface={skin.surface}>{children}</SurfaceProvider>;

  if (props.onPress === undefined) {
    return (
      <View style={[SHAPE[size], skin.rest, style]} testID={testID}>
        {content}
      </View>
    );
  }

  const { onPress, accessibilityLabel, accessibilityHint, selected, disabled = false } = props;
  const role = props.accessibilityRole ?? 'button';

  return (
    <AnimatedPressable
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
      style={[
        styles.interactive,
        SHAPE[size],
        press.pressed && !disabled ? skin.pressed : skin.rest,
        disabled && styles.disabled,
        ring,
        style,
        press.style,
      ]}
    >
      {content}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // Every card is taller than a thumb once it holds a line of text; this is for the one that is
  // not, so the minimum holds whatever the caller puts in it.
  interactive: { minHeight: measure.touchTarget },
  disabled: { opacity: 0.4 },
});
