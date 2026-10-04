import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { colors, lineHeight, radius } from '../../theme';
import { RowText, rowStyles } from './checkbox';
import { useFocusRing } from './focus';
import { usePressScale } from './press-scale';
import { TONES, useSurface, type Surface } from './surface';
import { useToggleMotion } from './toggle-motion';

/**
 * An on/off setting — the native `Switch` (`docs/ui-kit.md` §7.13). It replaces React Native's
 * own `Switch`, whose platform colours are neither the web's nor each other's.
 *
 * <h2>Drawn per surface</h2>
 *
 * A 44×24 pill track and a round knob. On the dark canvas off is `surface4` with a white knob and
 * on is `lime500` with a near-black knob, so on and off differ in more than hue. On a white sheet
 * (`useSurface`) lime would have no edge against the white, so on is `surface1` and off a mid-grey,
 * both with a white knob — there the knob's side is what says on or off.
 *
 * <p>The whole row — track, label, description — is one `Pressable` with
 * `accessibilityRole="switch"` and `accessibilityState.checked`, at least 44pt tall, which is the
 * web's label-inside-the-button arrangement: "Unlock with Face ID, switch, on".
 *
 * <h2>Motion</h2>
 *
 * The knob slides 20pt on `translateX` on `spring.snappy`, and the on colours crossfade in over the
 * off ones as two layers — transform and opacity only. A press anywhere on the row gives the track
 * the press scale. Under Reduce Motion the knob is simply where it belongs, on the same frame.
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
/** The track's "on" layer, for reading the crossfade. */
export const SWITCH_ON_LAYER = 'switch-on-layer';

interface SwitchSkin {
  readonly offTrack: string;
  readonly onTrack: string;
  readonly offKnob: string;
  readonly onKnob: string;
}

const SKIN: Record<'dark' | 'light', SwitchSkin> = {
  dark: {
    offTrack: colors.surface4,
    onTrack: colors.lime500,
    offKnob: colors.whiteSurface,
    onKnob: colors.textOnLime,
  },
  light: {
    offTrack: TONES.white.tertiary,
    onTrack: colors.surface1,
    offKnob: colors.whiteSurface,
    onKnob: colors.whiteSurface,
  },
};

export function switchSkin(surface: Surface): SwitchSkin {
  return surface === 'dark' ? SKIN.dark : SKIN.light;
}

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
  const skin = switchSkin(surface);
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const { progress } = useToggleMotion(value);

  const knobSlide = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * KNOB_TRAVEL }],
  }));
  // One animated style per view, never one shared between two.
  const trackOn = useAnimatedStyle(() => ({ opacity: progress.value }));
  const knobOn = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
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
      <Animated.View style={[styles.track, press.style]}>
        <View style={[styles.fill, { backgroundColor: skin.offTrack }]} />
        <Animated.View
          testID={SWITCH_ON_LAYER}
          style={[styles.fill, { backgroundColor: skin.onTrack }, trackOn]}
        />
        <Animated.View testID={SWITCH_KNOB} style={[styles.knob, knobSlide]}>
          <View style={[styles.fill, { backgroundColor: skin.offKnob }]} />
          <Animated.View style={[styles.fill, { backgroundColor: skin.onKnob }, knobOn]} />
        </Animated.View>
      </Animated.View>
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
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.full,
  },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.full },
});
