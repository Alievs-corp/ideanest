import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, lineHeight, motion, radius } from '../../theme';
import { RowText, rowStyles } from './checkbox';
import { useFocusRing } from './focus';
import { useMotionAllowed } from './motion-budget';
import { TONES, useSurface } from './surface';

/**
 * An on/off setting — the native `Switch` (`docs/ui-kit.md` §7.13). It replaces React Native's
 * own `Switch`, whose platform colours are neither the web's nor each other's.
 *
 * <h2>The web's switch, drawn</h2>
 *
 * 44×24. Off is `--surface-4` with a white knob; on is `--lime-500` with a near-black knob. The
 * knob's colour and position both change, so on and off differ in more than hue.
 *
 * <p>The whole row — track, label, description — is one `Pressable` with
 * `accessibilityRole="switch"` and `accessibilityState.checked`, at least 44pt tall, which is the
 * web's label-inside-the-button arrangement: "Unlock with Face ID, switch, on".
 *
 * <h2>Motion</h2>
 *
 * The knob travels 20pt on `translateX` — transform only — over `motion.fast` (the mobile 120ms
 * step, ~20% under the web's 150ms per `docs/motion-system.md` §7), and only when
 * `useMotionAllowed('minimal')` says so. With Reduce Motion on, or on a surface whose budget is
 * `none` (settings is one), the knob is simply where it belongs: a state change, not a fast
 * animation.
 */

export interface SwitchProps {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 24;
const KNOB = 20;
const INSET = (TRACK_HEIGHT - KNOB) / 2;
/** How far the knob travels: the track, less the knob, less an inset at each end. */
export const KNOB_TRAVEL = TRACK_WIDTH - KNOB - 2 * INSET;

/** The knob's test identifier, for reading its position. */
export const SWITCH_KNOB = 'switch-knob';

export function Switch({
  label,
  value,
  onValueChange,
  description,
  disabled = false,
  testID,
}: SwitchProps) {
  const surface = useSurface();
  const tones = TONES[surface];
  const { ring, onFocus, onBlur } = useFocusRing();
  const moves = useMotionAllowed('minimal');

  const target = value ? KNOB_TRAVEL : 0;
  const offset = useSharedValue(target);

  useEffect(() => {
    offset.value = moves ? withTiming(target, { duration: motion.fast }) : target;
  }, [moves, offset, target]);

  const knobMotion = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      style={[rowStyles.row, styles.row, disabled && rowStyles.disabled, ring]}
    >
      <RowText
        label={label}
        description={description}
        primary={tones.primary}
        secondary={tones.secondary}
      />
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        {moves ? (
          <Animated.View
            testID={SWITCH_KNOB}
            style={[styles.knob, value ? styles.knobOn : styles.knobOff, knobMotion]}
          />
        ) : (
          // No animated style at all: the knob is drawn at its place, not moved there quickly.
          <View
            testID={SWITCH_KNOB}
            style={[
              styles.knob,
              value ? styles.knobOn : styles.knobOff,
              { transform: [{ translateX: target }] },
            ]}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A setting reads label first and the switch at the end of the row, as both platforms do.
  row: { alignItems: 'flex-start' },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    marginTop: (lineHeight.small - TRACK_HEIGHT) / 2,
    borderRadius: radius.full,
    padding: INSET,
  },
  trackOff: { backgroundColor: colors.surface4 },
  trackOn: { backgroundColor: colors.lime500 },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.full },
  knobOff: { backgroundColor: colors.whiteSurface },
  knobOn: { backgroundColor: colors.textOnLime },
});
