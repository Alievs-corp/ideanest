import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, lineHeight, radius, spacing } from '../../theme';
import { CONTROL_SIZE, RowText, rowStyles } from './checkbox';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { TONES, useSurface } from './surface';

/**
 * A set of mutually exclusive choices — the native `RadioGroup` and `Radio` (`docs/ui-kit.md`
 * §7.13).
 *
 * <p>The group is `accessibilityRole="radiogroup"` and is named — by its own `label`, or by the
 * surrounding `Field` with `grouped`. TalkBack reads that name; VoiceOver on the new architecture
 * does not read a container that is not itself accessible, and making it accessible would swallow
 * the radios. So the question a screen reader hears first is the grouped `Field`'s label, which
 * is a header for exactly this reason (see `field.tsx`): put a radio group in a grouped `Field`.
 * Each `Radio` is one row, one `Pressable`, at least 44pt tall, announced as "radio button,
 * selected".
 *
 * <p>Selected is a lime circle with an 8pt near-black dot: an active choice, like a ticked box,
 * and never `--success`. The dot is what says "selected" to somebody who cannot tell the fill
 * from the ring.
 *
 * <p>Controlled only. Which option is chosen is form state, and a group that owned it privately
 * could not be reset by the form it sits in.
 */

interface RadioGroupValue {
  readonly value: string | null;
  readonly select: (value: string) => void;
  readonly disabled: boolean;
}

const RadioGroupContext = createContext<RadioGroupValue | null>(null);

export interface RadioGroupProps {
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  /** The group's accessible name. Optional inside a `Field`, which provides it. */
  readonly label?: string;
  readonly disabled?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}

export function RadioGroup({
  value,
  onChange,
  label,
  disabled = false,
  children,
  testID,
}: RadioGroupProps) {
  const field = useFieldControl({ accessibilityLabel: label });

  return (
    <RadioGroupContext.Provider value={{ value, select: onChange, disabled }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={field.accessibilityLabel}
        accessibilityHint={field.accessibilityHint}
        accessibilityState={{ disabled }}
        testID={testID}
        style={styles.group}
      >
        {children}
      </View>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  /**
   * The language the label is written in, when it is not the interface's — the language picker
   * lists "Русский" and "Türkçe" in their own languages, and VoiceOver should pronounce them so.
   */
  readonly accessibilityLanguage?: string;
  readonly testID?: string;
}

export const Radio = forwardRef<View, RadioProps>(function Radio(
  { value, label, description, disabled = false, accessibilityLanguage, testID },
  ref,
) {
  const group = useContext(RadioGroupContext);
  const surface = useSurface();
  const tones = TONES[surface];
  const { ring, onFocus, onBlur } = useFocusRing();

  const selected = group?.value === value;
  const blocked = disabled || (group?.disabled ?? false);

  return (
    <Pressable
      ref={ref}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityLanguage={accessibilityLanguage}
      accessibilityState={{ checked: selected, disabled: blocked }}
      disabled={blocked}
      onPress={() => group?.select(value)}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      style={[rowStyles.row, blocked && rowStyles.disabled, ring]}
    >
      <View style={[styles.circle, selected ? styles.selected : styles.unselected]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <RowText
        label={label}
        description={description}
        primary={tones.primary}
        secondary={tones.secondary}
      />
    </Pressable>
  );
});

const DOT = 8;

const styles = StyleSheet.create({
  // The web's `gap-2.5`, less the rows' own padding: the rows are already 44pt apart.
  group: { gap: spacing[1] / 2 },
  circle: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    marginTop: (lineHeight.small - CONTROL_SIZE) / 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unselected: {
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  selected: { backgroundColor: colors.lime500 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    // Near-black on lime: the on-lime text colour, used as a fill.
    backgroundColor: colors.textOnLime,
  },
});
