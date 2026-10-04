import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  colors,
  font,
  fontSize,
  radius,
  size as measure,
  spacing,
  tint,
  tracking,
} from '../../theme';
import { useFocusRing } from './focus';
import { Icon, type IconComponent } from './icon';
import { usePressScale } from './press-scale';
import { useSurface } from './surface';

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
 * <p>Those heights are minimums, not fixed. Dynamic Type stays on, and at the largest
 * accessibility sizes a 14pt label is over 40pt tall — a fixed-height pill would spill its own
 * text out of its background. A long Azerbaijani or Russian label shrinks and truncates instead of
 * pushing an icon out of the pill.
 *
 * <p>Hover does not exist, so the web's hover colours become the pressed state, applied on the
 * frame the finger lands. The web's `active:scale-[0.98]` becomes `usePressScale` (`mobile-design`
 * skill §6.3) on every surface, checkout included; with Reduce Motion the pill does not move.
 *
 * <h2>Primary inverts on white</h2>
 *
 * A white pill on a white `Dialog` or `FloatingPanel` has no edge and reads as a line of text
 * (issue #232). Under `SurfaceProvider surface="white"` a `primary` pill is near-black with a
 * white label instead, and `outline` swaps its white label and hairline for near-black ones —
 * the web does the same under `data-on-white`.
 *
 * <h2>Danger is near-black on red</h2>
 *
 * White on `--danger` measures about 3.4:1, under AA for a label this size (issue #229), so
 * `danger` takes `textOnDanger`, as lime takes `textOnLime`.
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

/**
 * How much of `--danger` a pressed danger control keeps. Pressing darkens, and at 0.85 over the
 * darkest surface the near-black label fell just under 4.5:1; `theme.test.ts` measures this one.
 */
export const DANGER_PRESSED_ALPHA = 0.9;

type Skin = { rest: ViewStyle; pressed: ViewStyle; text: string };

const SKIN: Record<PillVariant, Skin> = {
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
    pressed: { backgroundColor: tint(colors.danger, DANGER_PRESSED_ALPHA) },
    text: colors.textOnDanger,
  },
};

/**
 * The variants that would vanish or read as the dark system on a white surface. `primary` takes the
 * dark system's own fill; `ghost` the white sheet's muted block; `outline` the web's `border-black/16`
 * and `text-on-white`.
 */
const ON_WHITE: Partial<Record<PillVariant, Skin>> = {
  ghost: {
    rest: { backgroundColor: colors.whiteMuted },
    pressed: { backgroundColor: tint(colors.black, 0.08) },
    text: colors.textOnWhite,
  },
  primary: {
    rest: { backgroundColor: colors.surface1 },
    pressed: { backgroundColor: colors.surface3 },
    text: colors.textPrimary,
  },
  outline: {
    rest: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: tint(colors.black, 0.16),
    },
    pressed: {
      backgroundColor: tint(colors.black, 0.06),
      borderWidth: 1,
      borderColor: tint(colors.black, 0.16),
    },
    text: colors.textOnWhite,
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
  /**
   * Shows a spinner and blocks presses. The label stays beside it, so the action is still named
   * while it runs; the spinner takes the left icon's place when there is one.
   */
  readonly busy?: boolean;
  /** What happens on press, when the label alone does not say. */
  readonly accessibilityHint?: string;
  /**
   * A fuller name than the visible words, for a pill whose label only makes sense beside its
   * neighbours: "Apply range" under a goal field is "Apply the custom goal range" (#153).
   */
  readonly accessibilityLabel?: string;
  /**
   * A toggle's state — the campaign page's Save and Remind (#155). Set only on a pill that is a
   * toggle, so a screen reader says "selected" where the web says `aria-pressed`; the icon and
   * the word change too, so the state is never carried by the announcement alone.
   */
  readonly selected?: boolean;
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
  accessibilityLabel,
  selected,
  testID,
}: PillProps) {
  const blocked = disabled || busy;
  const surface = useSurface();
  const skin = (surface === 'white' ? ON_WHITE[variant] : undefined) ?? SKIN[variant];
  const height = HEIGHT[size];
  const reach = Math.max(0, (measure.touchTarget - height) / 2);
  const { ring, onFocus, onBlur } = useFocusRing();

  useAccentWarning(variant === 'accent');

  const press = usePressScale();

  return (
    <Animated.View style={[fullWidth ? styles.fill : styles.hug, press.style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: blocked, busy, ...(selected === undefined ? {} : { selected }) }}
        disabled={blocked}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: reach, bottom: reach }}
        testID={testID}
        style={({ pressed }) => [
          styles.pill,
          { minHeight: height, paddingHorizontal: PADDING[size] },
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
    paddingVertical: spacing[1],
    borderRadius: radius.full,
  },
  /*
   * The wrapper takes whatever place its parent gives it and the pill hugs its label inside that
   * place, so a pill in a centred empty state is centred and one in a row is vertically centred.
   * An `alignSelf` here would override the parent's alignment instead of following it.
   */
  hug: { alignItems: 'flex-start' },
  // `width`, not `alignSelf: 'stretch'`, so a full-width pill fills a row as well as a column.
  fill: { width: '100%' },
  blocked: { opacity: 0.4 },
  label: { ...font.medium, letterSpacing: tracking.button, flexShrink: 1 },
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
