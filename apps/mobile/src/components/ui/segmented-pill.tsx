import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, font, fontSize, motion, radius, size as measure, spacing, spring } from '../../theme';
import { useFocusRing } from './focus';
import { haptics } from './haptics';
import { useMotionAllowed } from './motion-budget';
import { TONES, useSurface } from './surface';

/**
 * "All / My accounts", "Send / Request" — issue #277, `mobile-design` skill §2.
 *
 * A full-width pill track of equal segments, with one thumb that springs (`spring.snappy`) under
 * the chosen one — `translateX` only: the segments are equal, so the thumb never changes width. On the dark
 * canvas the thumb is white with near-black text; on a white sheet it inverts to `surface1` with
 * white text. The label's colour change is a crossfade between two layers, never an animated
 * colour. To a screen reader it is a radio group: one choice, its state announced.
 */

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedPillProps<T extends string> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Names the group: "Show". */
  readonly label?: string;
  readonly testID?: string;
}

const HEIGHT = 44;
const INSET = 4;

export function SegmentedPill<T extends string>({
  options,
  value,
  onChange,
  label,
  testID,
}: SegmentedPillProps<T>) {
  const surface = useSurface();
  const moves = useMotionAllowed('minimal');
  const [inner, setInner] = useState(0);
  const x = useSharedValue(0);
  const placed = useSharedValue(0);
  const count = Math.max(1, options.length);
  const segment = inner / count;
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (inner === 0) return;
    const target = INSET + index * segment;
    x.value = moves && placed.value === 1 ? withSpring(target, spring.snappy) : target;
    placed.value = 1;
  }, [inner, index, segment, moves, x, placed]);

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: placed.value,
    transform: [{ translateX: x.value }],
  }));

  const onWhite = surface === 'white';

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
      onLayout={(event: LayoutChangeEvent) => setInner(event.nativeEvent.layout.width - INSET * 2)}
      style={[styles.track, onWhite ? styles.trackOnWhite : styles.trackOnDark]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          { width: segment },
          onWhite ? styles.thumbOnWhite : styles.thumbOnDark,
          thumbStyle,
        ]}
        testID={testID === undefined ? undefined : `${testID}-thumb`}
      />
      {options.map((option) => (
        <Segment
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onWhite={onWhite}
          moves={moves}
          onPress={() => {
            if (option.value === value) return;
            haptics.selectReward();
            onChange(option.value);
          }}
        />
      ))}
    </View>
  );
}

function Segment({
  label,
  selected,
  onWhite,
  moves,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onWhite: boolean;
  readonly moves: boolean;
  readonly onPress: () => void;
}) {
  const ring = useFocusRing();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = moves ? withTiming(selected ? 1 : 0, { duration: motion.fast }) : selected ? 1 : 0;
  }, [selected, moves, on]);
  const selectedStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));

  const rest = onWhite ? TONES.white.secondary : TONES.dark.secondary;
  const chosen = onWhite ? colors.textPrimary : colors.textOnWhite;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={[styles.segment, ring.ring]}
    >
      <Animated.View style={restStyle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[styles.label, { color: rest }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      <Animated.View
        style={[styles.overlay, selectedStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.label, { color: chosen }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    minHeight: HEIGHT,
    padding: INSET,
    borderRadius: radius.full,
  },
  trackOnDark: { backgroundColor: colors.surface2 },
  trackOnWhite: { backgroundColor: colors.whiteMuted },
  thumb: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: 0,
    borderRadius: radius.full,
  },
  thumbOnDark: { backgroundColor: colors.whiteSurface },
  thumbOnWhite: { backgroundColor: colors.surface1 },
  segment: {
    flex: 1,
    minHeight: measure.touchTarget - INSET * 2,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...font.medium, fontSize: fontSize.sm },
});
