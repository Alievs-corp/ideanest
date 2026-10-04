import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, lineHeight, radius, size as measure, spacing } from '../../theme';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { usePressScale } from './press-scale';
import { TONES, useSurface, type Surface } from './surface';
import { useToggleMotion } from './toggle-motion';

/**
 * A checkbox with its label — the native `Checkbox` (`docs/ui-kit.md` §7.13).
 *
 * <h2>The whole row is the control</h2>
 *
 * On the web the `<label>` wraps the box, so clicking the words ticks it. On a phone the 20pt
 * box alone is a target nobody hits first time, so the row — box, label and description — is one
 * `Pressable`, at least 44pt tall, and one stop for a screen reader: "Email me updates,
 * checkbox, checked". The label is the name and the description is read after it as the hint.
 *
 * <h2>Checked is lime on the canvas, and that is not a contradiction</h2>
 *
 * §7.13: a ticked box is an active choice, the same gesture as a selected reward tier, so on the
 * dark canvas it is `--lime-500` with a near-black mark. It is still not `--success` — nothing has
 * been achieved by ticking a box — and the mark is a glyph, so the state is never carried by
 * colour alone. On a white sheet (`useSurface`) lime has no edge against the white, so the box
 * inverts to `surface1` with a white mark. Indeterminate is a dash and announces `mixed`.
 *
 * <h2>Shape and motion</h2>
 *
 * A rounded square, not a pill: a 20pt pill is a circle, and a circle is a radio button. A press
 * on the row gives the box the press scale; ticking crossfades the checked fill over the empty one
 * and the mark grows in on `spring.snappy` — transform and opacity only. Under Reduce Motion the
 * new state is drawn at once.
 */

export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Neither all nor none — a "select all" over a partial selection. Announced as mixed. */
  readonly indeterminate?: boolean;
  readonly description?: string;
  readonly disabled?: boolean;
  /**
   * A figure on the right of the row — a facet count, or "None" (#153). Tertiary and in tabular
   * figures, and announced as the checkbox's value, so it is heard as well as seen.
   */
  readonly count?: string;
  readonly testID?: string;
}

export const CONTROL_SIZE = 20;
/** The box's corner: half the smallest radius token, so 20pt stays a square and not a circle. */
const BOX_RADIUS = radius.sm / 2;
/** How small a mark (a tick, a dash or a radio's dot) starts as it grows in. */
export const MARK_ENTRY_SCALE = 0.5;

/** Test identifiers of the checked fill and the mark, for reading the crossfade. */
export const CHECKBOX_FILL = 'checkbox-fill';
export const CHECKBOX_MARK = 'checkbox-mark';

interface MarkSkin {
  /** The empty control's fill and edge. */
  readonly empty: string;
  readonly edge: string;
  /** The marked control's fill and its mark. */
  readonly marked: string;
  readonly mark: string;
}

const SKIN: Record<'dark' | 'light', MarkSkin> = {
  dark: {
    empty: colors.surface3,
    edge: colors.borderStrong,
    marked: colors.lime500,
    mark: colors.textOnLime,
  },
  light: {
    empty: colors.whiteSurface,
    edge: TONES.white.tertiary,
    marked: colors.surface1,
    mark: colors.whiteSurface,
  },
};

/** A checkbox's or a radio's colours where it sits. Shared with Radio. */
export function markSkin(surface: Surface): MarkSkin {
  return surface === 'dark' ? SKIN.dark : SKIN.light;
}

export function Checkbox({
  label,
  checked,
  onChange,
  indeterminate = false,
  description,
  disabled = false,
  count,
  testID,
}: CheckboxProps) {
  const surface = useSurface();
  const tones = TONES[surface];
  const skin = markSkin(surface);
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const marked = checked || indeterminate;
  const { progress } = useToggleMotion(marked);

  const fillFade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const markGrow = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: MARK_ENTRY_SCALE + (1 - MARK_ENTRY_SCALE) * progress.value }],
  }));

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      accessibilityValue={count === undefined || count === '' ? undefined : { text: count }}
      disabled={disabled}
      // From indeterminate, a press selects everything — what the web's native checkbox does.
      onPress={() => onChange(indeterminate ? true : !checked)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      style={[rowStyles.row, disabled && rowStyles.disabled, ring]}
    >
      <Animated.View style={[styles.box, press.style]}>
        <View
          style={[styles.fill, styles.empty, { backgroundColor: skin.empty, borderColor: skin.edge }]}
        />
        <Animated.View
          testID={CHECKBOX_FILL}
          style={[styles.fill, { backgroundColor: skin.marked }, fillFade]}
        />
        <Animated.View testID={CHECKBOX_MARK} style={markGrow}>
          <Icon icon={indeterminate ? Glyphs.Minus : Glyphs.Tick} size={14} color={skin.mark} />
        </Animated.View>
      </Animated.View>
      <RowText
        label={label}
        description={description}
        primary={tones.primary}
        secondary={tones.secondary}
      />
      {count === undefined ? null : (
        <Text style={[rowStyles.count, { color: tones.tertiary }]}>{count}</Text>
      )}
    </Pressable>
  );
}

/** A row control's words: the label, and the description under it. Shared with Radio and Switch. */
export function RowText({
  label,
  description,
  primary,
  secondary,
}: {
  label: string;
  description: string | undefined;
  primary: string;
  secondary: string;
}) {
  return (
    <View style={rowStyles.words}>
      <Text style={[rowStyles.label, { color: primary }]}>{label}</Text>
      {description !== undefined && description !== '' ? (
        <Text style={[rowStyles.description, { color: secondary }]}>{description}</Text>
      ) : null}
    </View>
  );
}

/**
 * The row every toggle shares: 44pt tall at least, the control centred on the label's first line
 * by the vertical padding, the words wrapping rather than truncating.
 */
export const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    minHeight: measure.touchTarget,
    paddingVertical: (measure.touchTarget - lineHeight.small) / 2,
    borderRadius: radius.sm,
  },
  disabled: { opacity: 0.4 },
  words: { flex: 1, gap: 2 },
  label: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  description: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small },
  count: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    fontVariant: ['tabular-nums'],
  },
});

const styles = StyleSheet.create({
  box: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    marginTop: (lineHeight.small - CONTROL_SIZE) / 2,
    borderRadius: BOX_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: BOX_RADIUS,
  },
  empty: { borderWidth: 1 },
});
