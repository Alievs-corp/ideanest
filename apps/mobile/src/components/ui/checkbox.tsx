import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, lineHeight, radius, size as measure, spacing } from '../../theme';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { TONES, useSurface } from './surface';

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
 * <h2>Checked is lime, and that is not a contradiction</h2>
 *
 * §7.13: a ticked box is an active choice, the same gesture as a selected reward tier, so it is
 * `--lime-500` with a near-black mark. It is still not `--success` — nothing has been achieved by
 * ticking a box — and the mark is a glyph, so the state is never carried by colour alone.
 * Indeterminate is a dash and announces `mixed`.
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
  const { ring, onFocus, onBlur } = useFocusRing();
  const marked = checked || indeterminate;

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
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      style={[rowStyles.row, disabled && rowStyles.disabled, ring]}
    >
      <View style={[styles.box, marked ? styles.marked : styles.unmarked]}>
        {marked ? (
          <Icon icon={indeterminate ? Glyphs.Minus : Glyphs.Tick} size={14} color={colors.textOnLime} />
        ) : null}
      </View>
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
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unmarked: {
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  marked: { backgroundColor: colors.lime500 },
});
