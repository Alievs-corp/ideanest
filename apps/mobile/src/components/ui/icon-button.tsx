import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, size as measure, tint } from '../../theme';
import { useFocusRing } from './focus';
import { Icon, type IconComponent } from './icon';
import { usePressScale } from './press-scale';
import { DANGER_PRESSED_ALPHA } from './pill';
import { TONES, useSurface } from './surface';

/**
 * A circular icon-only control — the native `IconButton` (`docs/ui-kit.md` §7.4).
 *
 * <p>`label` is REQUIRED, at the type level, for the web's reason: an icon-only control with no
 * name is announced as "button" and nothing else. It becomes the `accessibilityLabel`; there is
 * no tooltip on a phone, so the web's `title` has nowhere to go.
 *
 * <p>The visual sizes are the web's (32, 40, 48) and the hit area is never under 44pt, through
 * `hitSlop`. `ghost` reads its colour from the surface it sits on, so an X on a lime card or a
 * white dialog is on-lime or on-white rather than an invisible `white/64`. `light` inverts on a
 * white surface and `danger` draws a near-black glyph, for `Pill`'s reasons (issues #229, #232).
 */

export type IconButtonVariant = 'default' | 'light' | 'accent' | 'danger' | 'ghost';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const DIAMETER: Record<IconButtonSize, number> = { sm: 32, md: 40, lg: 48 };
const GLYPH: Record<IconButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export interface IconButtonProps {
  readonly icon: IconComponent;
  /** The accessible name. Required: this control has no visible text. */
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  readonly disabled?: boolean;
  /** A toggle's state — the password reveal, a saved heart. */
  readonly selected?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function IconButton({
  icon,
  label,
  onPress,
  variant = 'default',
  size = 'md',
  disabled = false,
  selected,
  accessibilityHint,
  testID,
}: IconButtonProps) {
  const surface = useSurface();
  const { ring, onFocus, onBlur } = useFocusRing();
  const diameter = DIAMETER[size];
  const reach = Math.max(0, (measure.touchTarget - diameter) / 2);
  const skin = skinFor(variant, surface);
  const press = usePressScale();

  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          disabled,
          ...(selected === undefined ? {} : { selected }),
        }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={reach}
        testID={testID}
        style={({ pressed }) => [
          styles.button,
          { width: diameter, height: diameter },
          pressed && !disabled ? skin.pressed : skin.rest,
          disabled && styles.disabled,
          ring,
        ]}
      >
        <Icon icon={icon} variant="bulk" size={GLYPH[size]} color={skin.glyph} />
      </Pressable>
    </Animated.View>
  );
}

function skinFor(
  variant: IconButtonVariant,
  surface: ReturnType<typeof useSurface>,
): { rest: ViewStyle; pressed: ViewStyle; glyph: string } {
  switch (variant) {
    case 'light':
      if (surface === 'white') {
        return {
          rest: { backgroundColor: colors.surface1 },
          pressed: { backgroundColor: colors.surface3 },
          glyph: colors.textPrimary,
        };
      }
      return {
        rest: { backgroundColor: colors.whiteSurface },
        pressed: { backgroundColor: colors.whiteMuted },
        glyph: colors.textOnWhite,
      };
    case 'accent':
      return {
        rest: { backgroundColor: colors.lime500 },
        pressed: { backgroundColor: colors.lime600 },
        glyph: colors.textOnLime,
      };
    case 'danger':
      return {
        rest: { backgroundColor: colors.danger },
        pressed: { backgroundColor: tint(colors.danger, DANGER_PRESSED_ALPHA) },
        glyph: colors.textOnDanger,
      };
    case 'ghost':
      return {
        rest: { backgroundColor: 'transparent' },
        // A darkening of whatever is underneath, so the press shows on lime and white as well.
        pressed: {
          backgroundColor: surface === 'dark' ? colors.surface3 : tint(colors.black, 0.08),
        },
        glyph: TONES[surface].secondary,
      };
    default:
      return {
        rest: { backgroundColor: colors.surface3 },
        pressed: { backgroundColor: colors.surface4 },
        glyph: colors.textPrimary,
      };
  }
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  disabled: { opacity: 0.4 },
});
