import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  colors,
  font,
  fontSize,
  motion,
  radius,
  size as measure,
  spacing,
  tint,
  tracking,
} from '../../theme';
import { useFocusRing } from './focus';
import { Icon, type IconComponent } from './icon';
import { useMotionAllowed } from './motion-budget';

/**
 * The system's action element — the native `Pill` (`packages/ui`, `docs/ui-kit.md` §7.2).
 *
 * <h2>White is primary, lime is accent</h2>
 *
 * The web's primary pill is white with near-black text, and lime (`accent`) is reserved for the
 * one urgent action on a screen — "back this project", "confirm pledge". The app's first `Button`
 * made every primary action lime, which spent the urgency on "sign in" and "try again" and left
 * nothing to mark the action that matters (issue #151). So: `primary` white, `accent` lime, and
 * a development warning when a screen mounts two accents.
 *
 * <h2>Touch, not pointer</h2>
 *
 * The visual heights are the web's — 32, 40, 48 — because the design is the same. A thumb is not
 * a pointer, so `sm` and `md` extend their hit area to 44pt with `hitSlop` rather than growing:
 * the pill looks like the web's and is as easy to hit as the platform requires.
 *
 * <p>Hover does not exist, so the web's hover colours become the pressed state, applied on the
 * frame the finger lands. The web's `active:scale-[0.98]` survives only where the surface's
 * motion budget allows it (`moderate` and up) — on checkout a pill does not move at all.
 */

export type PillVariant = 'primary' | 'accent' | 'ghost' | 'outline' | 'danger';
export type PillSize = 'sm' | 'md' | 'lg';

const HEIGHT: Record<PillSize, number> = { sm: 32, md: 40, lg: 48 };
const PADDING: Record<PillSize, number> = { sm: 14, md: 18, lg: spacing[6] };
const LABEL: Record<PillSize, number> = {
  sm: fontSize.caption,
  md: fontSize.sm,
  lg: fontSize.base,
};
const ICON: Record<PillSize, number> = { sm: 14, md: 16, lg: 18 };

const SKIN: Record<PillVariant, { rest: ViewStyle; pressed: ViewStyle; text: string }> = {
  primary: {
    rest: { backgroundColor: colors.whiteSurface },
    pressed: { backgroundColor: colors.whiteMuted },
    text: colors.textOnWhite,
  },
  accent: {
    rest: { backgroundColor: colors.lime500 },
    pressed: { backgroundColor: colors.lime600 },
    text: colors.textOnLime,
  },
  ghost: {
    rest: { backgroundColor: colors.surface3 },
    pressed: { backgroundColor: colors.surface4 },
    text: colors.textPrimary,
  },
  outline: {
    rest: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    pressed: {
      backgroundColor: colors.surface3,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    text: colors.textPrimary,
  },
  danger: {
    rest: { backgroundColor: colors.danger },
    // The web brightens on hover. Pressed darkens instead, which is what a press looks like.
    pressed: { backgroundColor: tint(colors.danger, 0.85) },
    text: colors.textPrimary,
  },
};

export interface PillProps {
  /** The visible text AND the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: PillVariant;
  readonly size?: PillSize;
  readonly iconLeft?: IconComponent;
  readonly iconRight?: IconComponent;
  readonly fullWidth?: boolean;
  readonly disabled?: boolean;
  /** Shows a spinner and blocks presses. The label stays, so the pill does not resize. */
  readonly busy?: boolean;
  /** What happens on press, when the label alone does not say. */
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function Pill({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  disabled = false,
  busy = false,
  accessibilityHint,
  testID,
}: PillProps) {
  const blocked = disabled || busy;
  const skin = SKIN[variant];
  const height = HEIGHT[size];
  const reach = Math.max(0, (measure.touchTarget - height) / 2);
  const { ring, onFocus, onBlur } = useFocusRing();

  useAccentWarning(variant === 'accent');

  const scales = useMotionAllowed('moderate');
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const press = (to: number) => {
    if (scales) scale.value = withTiming(to, { duration: motion.fast });
  };

  /*
   * The scale lives on a wrapper and the press on the `Pressable` inside it. An animated
   * `Pressable` drops a function `style`, which is how the pressed colour is drawn, so the pill
   * rendered with no background at all; the wrapper keeps the two concerns in two elements.
   */
  return (
    <Animated.View style={[fullWidth ? styles.stretch : styles.hug, scales && pressStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: blocked, busy }}
        disabled={blocked}
        onPress={onPress}
        onPressIn={() => press(motion.pressScale)}
        onPressOut={() => press(1)}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: reach, bottom: reach }}
        testID={testID}
        style={({ pressed }) => [
          styles.pill,
          { height, paddingHorizontal: PADDING[size] },
          pressed && !blocked ? skin.pressed : skin.rest,
          blocked && styles.blocked,
          ring,
        ]}
      >
        {busy ? (
          // No accessible name: the pill carries one and `busy` says what the spinner says.
          <ActivityIndicator size="small" color={skin.text} />
        ) : iconLeft !== undefined ? (
          <Icon icon={iconLeft} size={ICON[size]} color={skin.text} />
        ) : null}
        <Text
          style={[styles.label, { fontSize: LABEL[size], color: skin.text }]}
          numberOfLines={1}
          // The pill owns the announcement; its text must not be a second stop.
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {label}
        </Text>
        {iconRight !== undefined ? (
          <Icon icon={iconRight} size={ICON[size]} color={skin.text} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: radius.full,
  },
  hug: { alignSelf: 'flex-start' },
  stretch: { alignSelf: 'stretch' },
  blocked: { opacity: 0.4 },
  label: { ...font.medium, letterSpacing: tracking.button },
});

/* -------------------------------------------------------------------------
 * "At most one accent per screen, or urgency stops meaning anything"
 * ---------------------------------------------------------------------- */

/**
 * The accent pills mounted in one screen. `Screen` provides a scope per screen; a pill outside
 * any scope is not counted, because a stack keeps the previous screen mounted and a global count
 * would warn about two accents nobody can see at once.
 */
const AccentScope = createContext<{ count: number } | null>(null);

export function AccentScopeProvider({ children }: { children: ReactNode }) {
  const scope = useRef({ count: 0 });
  return <AccentScope.Provider value={scope.current}>{children}</AccentScope.Provider>;
}

function useAccentWarning(accent: boolean): void {
  const scope = useContext(AccentScope);

  useEffect(() => {
    if (!accent || scope === null) return undefined;
    scope.count += 1;
    if (__DEV__ && scope.count > 1) {
      console.warn(
        `Pill: ${scope.count} accent pills are mounted on one screen. Lime marks the one urgent ` +
          'action (docs/ui-kit.md §7.2); make the others primary or ghost.',
      );
    }
    return () => {
      scope.count -= 1;
    };
  }, [accent, scope]);
}
