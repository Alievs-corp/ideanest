import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, radius, size as measure, spacing, tint } from '../../theme';
import { useFocusRing } from './focus';
import { Icon, type IconComponent } from './icon';
import { PressableScale, usePressScale } from './press-scale';
import { useSurface, type Surface } from './surface';
import { useToggleMotion } from './toggle-motion';

/**
 * Filter chips — the native `Chip`, `ChipRow` and `RemovableChip` (`docs/ui-kit.md` §7.3), as the
 * `mobile-design` skill's pills (§2, §6.3; issue #282).
 *
 * <h2>Selected is the inverted pill, never lime</h2>
 *
 * A row of filters is where the reader is choosing, not where they are being hurried. Lime says
 * "act now" (CLAUDE.md §2), and a selected filter lit in lime would say it six times in one row.
 * So a selected chip is the surface's inverted pill — white with near-black text on the dark
 * canvas, `surface1` with white text on a white sheet (`useSurface`) — and the difference between
 * selected and not is also announced (`accessibilityState.selected`) rather than left to the fill.
 *
 * <h2>34 to look at, 44 to hit</h2>
 *
 * The visual height is the web's 34. A thumb needs 44 (`size.touchTarget`), so the chip extends
 * its hit area with `hitSlop` instead of growing — a row of 44pt chips is a different design.
 *
 * <h2>Motion</h2>
 *
 * Press gives the chip's scale (`usePressScale`). Selecting crossfades the selected layer — fill
 * and words — over the resting one on `spring.snappy`: two layers and their opacity, never an
 * animated colour. Under Reduce Motion it does not scale and the new state is there at once.
 *
 * <p>Each chip sits in a wrapper that takes the place its parent gives it and hugs the chip inside
 * that place (as `Pill` does), rather than setting `alignSelf` on itself, which would override a
 * parent's `alignItems: 'center'`.
 */

const HEIGHT = 34;
const REACH = Math.max(0, (measure.touchTarget - HEIGHT) / 2);

/** Test identifiers of a chip's two fills, for reading the crossfade. */
export const CHIP_REST_LAYER = 'chip-rest-layer';
export const CHIP_SELECTED_LAYER = 'chip-selected-layer';

interface ChipSkin {
  readonly rest: string;
  readonly restPressed: string;
  readonly border: string;
  readonly restText: string;
  readonly restTextPressed: string;
  readonly restCount: string;
  readonly selected: string;
  readonly selectedPressed: string;
  readonly selectedText: string;
  readonly selectedCount: string;
  readonly removeIcon: string;
}

/** The dark canvas's chip, and the light one for a white sheet (or lime and accent cards). */
const SKIN: Record<'dark' | 'light', ChipSkin> = {
  dark: {
    rest: colors.surface2,
    restPressed: colors.surface3,
    border: colors.border,
    restText: colors.textSecondary,
    restTextPressed: colors.textPrimary,
    restCount: colors.textTertiary,
    selected: colors.whiteSurface,
    selectedPressed: colors.whiteMuted,
    selectedText: colors.textOnWhite,
    selectedCount: tint(colors.textOnWhite, 0.5),
    removeIcon: tint(colors.textOnWhite, 0.56),
  },
  light: {
    rest: colors.whiteMuted,
    restPressed: tint(colors.black, 0.08),
    border: 'transparent',
    restText: tint(colors.textOnWhite, 0.64),
    restTextPressed: colors.textOnWhite,
    restCount: tint(colors.textOnWhite, 0.5),
    selected: colors.surface1,
    selectedPressed: colors.surface3,
    selectedText: colors.textPrimary,
    selectedCount: colors.textTertiary,
    removeIcon: colors.textSecondary,
  },
};

function skinOn(surface: Surface): ChipSkin {
  return surface === 'dark' ? SKIN.dark : SKIN.light;
}

export interface ChipProps {
  /** The visible text AND the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  /** A chosen filter. The inverted pill, never lime. */
  readonly selected?: boolean;
  /** How many results the filter would show, after the label. Announced as the chip's value. */
  readonly count?: number;
  readonly icon?: IconComponent;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function Chip({
  label,
  onPress,
  selected = false,
  count,
  icon,
  disabled = false,
  accessibilityHint,
  testID,
}: ChipProps) {
  const skin = skinOn(useSurface());
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const { progress } = useToggleMotion(selected);
  const pressed = press.pressed && !disabled;

  // One animated style per view, never one shared between two.
  const selectedFill = useAnimatedStyle(() => ({ opacity: progress.value }));
  const selectedWords = useAnimatedStyle(() => ({ opacity: progress.value }));
  const restFill = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const restWords = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  const words = (text: string, countColour: string) => (
    <>
      {icon === undefined ? null : <Icon icon={icon} size={14} color={text} />}
      <Text style={[styles.label, { color: text }]} numberOfLines={1}>
        {label}
      </Text>
      {count === undefined ? null : (
        <Text style={[styles.label, styles.count, { color: countColour }]}>{count}</Text>
      )}
    </>
  );

  return (
    <Animated.View style={[styles.hug, press.style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected, disabled }}
        accessibilityValue={count === undefined ? undefined : { text: String(count) }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: REACH, bottom: REACH }}
        testID={testID}
        style={[styles.chip, disabled && styles.disabled, ring]}
      >
        <Animated.View
          pointerEvents="none"
          testID={CHIP_REST_LAYER}
          style={[
            styles.layer,
            styles.restLayer,
            { backgroundColor: pressed ? skin.restPressed : skin.rest, borderColor: skin.border },
            restFill,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          testID={CHIP_SELECTED_LAYER}
          style={[
            styles.layer,
            { backgroundColor: pressed ? skin.selectedPressed : skin.selected },
            selectedFill,
          ]}
        />
        {/* The chip owns the announcement; its words must not be a second stop. */}
        <Animated.View
          style={[styles.content, restWords]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {words(pressed ? skin.restTextPressed : skin.restText, skin.restCount)}
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.content, styles.overlay, selectedWords]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {words(skin.selectedText, skin.selectedCount)}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export interface RemovableChipProps {
  /** The visible text: the choice already made ("Live"). */
  readonly label: string;
  /**
   * What pressing it does, as a sentence — the accessible name. REQUIRED, at the type level: a row
   * of chips announced as "Live", "Games", "Handmade" says what each one is about and not that
   * pressing it deletes it. It must contain `label`, so speech input reaches the chip by the words
   * on it (WCAG 2.5.3). The web's is `discovery.feed.removeChip`.
   */
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * A choice already made, removed by pressing it.
 *
 * <p>Not a `Chip` with an X in it: a `Chip` is a toggle and says so with `selected`; this is a
 * button that deletes something, and announcing it as "selected" would tell a screen-reader user it
 * is a switch that is on. Drawn as a selected chip is — an applied filter is where the reader is —
 * and pressed with the same scale.
 */
export function RemovableChip({
  label,
  removeLabel,
  onRemove,
  disabled = false,
  testID,
}: RemovableChipProps) {
  const skin = skinOn(useSurface());
  const { ring, onFocus, onBlur } = useFocusRing();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={removeLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onRemove}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={{ top: REACH, bottom: REACH }}
      testID={testID}
      style={styles.hug}
      contentStyle={({ pressed }) => [
        styles.chip,
        styles.content,
        styles.removable,
        { backgroundColor: pressed && !disabled ? skin.selectedPressed : skin.selected },
        disabled && styles.disabled,
        ring,
      ]}
    >
      <Text
        style={[styles.label, { color: skin.selectedText }]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
      <Icon icon={Glyphs.Close} size={14} color={skin.removeIcon} />
    </PressableScale>
  );
}

export interface ChipRowProps {
  readonly children: ReactNode;
  /** The right-edge fade that says "there is more". Drawn only while there is more. */
  readonly fadeEdge?: boolean;
  readonly testID?: string;
}

/** The fade's share of the row's width — the web's `fade-edge-r` mask, 88% to 100%. */
const FADE_SHARE = 0.12;

/**
 * A horizontally scrolling row of chips.
 *
 * <p>The right edge fades into the surface underneath — `surface1` on the canvas, `whiteSurface`
 * in a white sheet — rather than cutting a chip in half, so "there is more" is legible without a
 * scroll bar. The web draws it as a CSS mask; React Native has none, so it is a
 * `react-native-svg` gradient from that colour at no opacity to full, laid over the edge and
 * ignoring touches. It is drawn only while there is more to the right of what is showing — a fade
 * over the last chip, with nothing after it, would hide the one thing it is pointing at.
 *
 * <p>"More to the right" is recomputed whenever any of its three inputs changes: the scroll
 * offset, the row's width (a rotation) and the chips' width (a filter added or removed). Asking only
 * on scroll left a fade over a row that had just shrunk to fit.
 */
export function ChipRow({ children, fadeEdge = true, testID }: ChipRowProps) {
  const offset = useRef(0);
  const viewport = useRef(0);
  const content = useRef(0);
  const [more, setMore] = useState(false);
  const ground = useSurface() === 'white' ? colors.whiteSurface : colors.surface1;

  // Refs for the measurements, one piece of state for the answer: a scroll event re-renders the
  // row only when the answer changes, not on every frame of the scroll.
  const recompute = () => {
    setMore(
      content.current > viewport.current + 1 &&
        offset.current + viewport.current < content.current - 1,
    );
  };

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = nativeEvent.contentOffset.x;
    viewport.current = nativeEvent.layoutMeasurement.width;
    content.current = nativeEvent.contentSize.width;
    recompute();
  };

  return (
    <View
      style={styles.row}
      testID={testID}
      onLayout={({ nativeEvent }: LayoutChangeEvent) => {
        viewport.current = nativeEvent.layout.width;
        recompute();
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        onContentSizeChange={(width) => {
          content.current = width;
          recompute();
        }}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {fadeEdge && more ? (
        <View
          pointerEvents="none"
          style={styles.fade}
          testID="chip-row-fade"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="chip-row-fade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={ground} stopOpacity={0} />
                <Stop offset="1" stopColor={ground} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#chip-row-fade)" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hug: { alignItems: 'flex-start' },
  chip: {
    // A minimum, so Dynamic Type grows the chip rather than clipping its word.
    minHeight: HEIGHT,
    justifyContent: 'center',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.full,
  },
  restLayer: { borderWidth: 1 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing[4],
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  removable: { paddingLeft: spacing[4], paddingRight: spacing[3] },
  disabled: { opacity: 0.4 },
  label: { ...font.medium, fontSize: fontSize.caption },
  count: { fontVariant: ['tabular-nums'] },
  row: { position: 'relative' },
  // The chips' hit slop, as padding: a scroll view clips touches at its own edge.
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: REACH,
  },
  fade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: `${FADE_SHARE * 100}%`,
  },
});
