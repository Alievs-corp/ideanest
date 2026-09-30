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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { colors, font, fontSize, radius, size as measure, spacing, tint } from '../../theme';
import { useFocusRing } from './focus';
import { Icon, type IconComponent } from './icon';

/**
 * Filter chips — the native `Chip`, `ChipRow` and `RemovableChip` (`docs/ui-kit.md` §7.3).
 *
 * <h2>Selected is white, never lime</h2>
 *
 * A row of filters is where the reader is choosing, not where they are being hurried. Lime says
 * "act now" (CLAUDE.md §2), and a selected filter lit in lime would say it six times in one row.
 * So a selected chip is white with near-black text, exactly as on the web, and the difference
 * between selected and not is also announced (`accessibilityState.selected`) rather than left to
 * the fill.
 *
 * <h2>34 to look at, 44 to hit</h2>
 *
 * The visual height is the web's 34. A thumb needs 44 (`size.touchTarget`), so the chip extends
 * its hit area with `hitSlop` instead of growing — a row of 44pt chips is a different design.
 *
 * <p>No animation: §5.1 gives filter chips "150ms colour only", and a press on a phone is a colour
 * swap on the frame the finger lands, which is the same thing with nothing to reduce. A selected
 * chip gives that feedback too — white dims to `white-muted` — because pressing it is how a filter
 * is taken off.
 *
 * <p>Each chip sits in a wrapper that takes the place its parent gives it and hugs the chip inside
 * that place (as `Pill` does), rather than setting `alignSelf` on itself, which would override a
 * parent's `alignItems: 'center'`.
 */

const HEIGHT = 34;
const REACH = Math.max(0, (measure.touchTarget - HEIGHT) / 2);

export interface ChipProps {
  /** The visible text AND the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  /** A chosen filter. White, never lime. */
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
  const { ring, onFocus, onBlur } = useFocusRing();

  return (
    <View style={styles.hug}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected, disabled }}
        accessibilityValue={count === undefined ? undefined : { text: String(count) }}
        disabled={disabled}
        onPress={onPress}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: REACH, bottom: REACH }}
        testID={testID}
        style={({ pressed }) => [
          styles.chip,
          skinFor(selected, pressed && !disabled),
          disabled && styles.disabled,
          ring,
        ]}
      >
        {({ pressed }) => {
          const text = selected
            ? colors.textOnWhite
            : pressed && !disabled
              ? colors.textPrimary
              : colors.textSecondary;
          return (
            <>
              {icon === undefined ? null : <Icon icon={icon} size={14} color={text} />}
              <Text
                style={[styles.label, { color: text }]}
                numberOfLines={1}
                // The chip owns the announcement; its text must not be a second stop.
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {label}
              </Text>
              {count === undefined ? null : (
                <Text
                  style={[
                    styles.label,
                    styles.count,
                    { color: selected ? tint(colors.textOnWhite, 0.5) : colors.textTertiary },
                  ]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  {count}
                </Text>
              )}
            </>
          );
        }}
      </Pressable>
    </View>
  );
}

function skinFor(selected: boolean, pressed: boolean) {
  if (selected) return pressed ? styles.selectedPressed : styles.selected;
  return pressed ? styles.pressed : styles.rest;
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
 * is a switch that is on. White, as a selected chip is — an applied filter is where the reader is.
 */
export function RemovableChip({
  label,
  removeLabel,
  onRemove,
  disabled = false,
  testID,
}: RemovableChipProps) {
  const { ring, onFocus, onBlur } = useFocusRing();

  return (
    <View style={styles.hug}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onRemove}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: REACH, bottom: REACH }}
        testID={testID}
        style={({ pressed }) => [
          styles.chip,
          styles.removable,
          skinFor(true, pressed && !disabled),
          disabled && styles.disabled,
          ring,
        ]}
      >
        <Text
          style={[styles.label, { color: colors.textOnWhite }]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {label}
        </Text>
        <Icon icon={X} size={14} color={tint(colors.textOnWhite, 0.56)} />
      </Pressable>
    </View>
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
 * <p>The right edge fades into `surface-1` rather than cutting a chip in half, so "there is more"
 * is legible without a scroll bar. The web draws it as a CSS mask; React Native has none, so it is
 * a `react-native-svg` gradient from `colors.surface1` at no opacity to full, laid over the edge
 * and ignoring touches. It is drawn only while there is more to the right of what is showing — a
 * fade over the last chip, with nothing after it, would hide the one thing it is pointing at.
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
                <Stop offset="0" stopColor={colors.surface1} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.surface1} stopOpacity={1} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // A minimum, so Dynamic Type grows the chip rather than clipping its word.
    minHeight: HEIGHT,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  rest: { backgroundColor: colors.surface2, borderColor: colors.border },
  pressed: { backgroundColor: colors.surface3, borderColor: colors.border },
  selected: { backgroundColor: colors.whiteSurface, borderColor: 'transparent' },
  removable: { paddingLeft: spacing[4], paddingRight: spacing[3] },
  selectedPressed: { backgroundColor: colors.whiteMuted, borderColor: 'transparent' },
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
