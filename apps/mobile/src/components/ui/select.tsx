import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, lineHeight, radius, size as measure, spacing, tint } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { haptics } from './haptics';
import { Icon } from './icon';
import { PressableScale, usePressScale } from './press-scale';
import { Sheet } from './sheet';
import { TONES, useSurface } from './surface';
import { INPUT_HEIGHT, inputFrame, inputText } from './text-input';

/**
 * Choose one from a list — the native `Select` (`docs/ui-kit.md` §7.13), in the `mobile-design`
 * skill's white sheet (§2, §6.3; issue #282).
 *
 * <p>The web uses the browser's own `<select>`, because a hand-built listbox always gets one of
 * type-ahead, the announcement contract or the platform picker wrong. A phone's equivalent of
 * "the platform's own list" is a sheet of options: every row at least 44pt, every option announced
 * as a radio button with its selected state, and the list scrolls when it is long.
 *
 * <p>The field looks like the other inputs (the shared `inputFrame`) and is
 * `accessibilityRole="combobox"`, with the chosen option — or the placeholder — as its value, so
 * VoiceOver reads "Currency, Azerbaijani manat, combo box". Pressing it opens the white `Sheet`,
 * titled with the field's plain label (without the required word); choosing closes the sheet at
 * once and returns focus to the field, so the next swipe goes on to the next field instead of
 * starting from the top.
 *
 * <p>Each option is a `PressableScale` row. The chosen one is marked by a Bold `TickCircle` and a
 * heavier label on a muted row — shape and weight, never the fill alone. A new choice gives the
 * selection haptic.
 *
 * <p>An option may carry `accessibilityLanguage` — the language picker lists each language in
 * its own language, and VoiceOver should pronounce "Русский" in Russian.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly accessibilityLanguage?: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  /** The field's name and the sheet's title. Optional inside a `Field`, which provides it. */
  readonly label?: string;
  /** Shown, and announced as the value, while nothing is chosen. */
  readonly placeholder?: string;
  readonly accessibilityHint?: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function Select({
  options,
  value,
  onChange,
  label,
  placeholder,
  accessibilityHint,
  invalid,
  disabled = false,
  testID,
}: SelectProps) {
  const field = useFieldControl({ accessibilityLabel: label, accessibilityHint, invalid });
  const surface = useSurface();
  const tones = TONES[surface];
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);

  const chosen = options.find((option) => option.value === value);
  const shown = chosen?.label ?? placeholder ?? '';
  // The PLAIN label: the sheet's visible title is the question, not its accessible name, so
  // it never reads 'Currency, required'.
  const title = field.label ?? '';

  return (
    <>
      <Animated.View style={press.style}>
        <Pressable
          ref={trigger}
          accessibilityRole="combobox"
          accessibilityLabel={field.accessibilityLabel}
          accessibilityHint={field.accessibilityHint}
          accessibilityValue={shown === '' ? undefined : { text: shown }}
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={() => {
            // A keyboard left up by the previous field would cover the sheet's options.
            Keyboard.dismiss();
            setOpen(true);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          testID={testID}
          style={[
            ...inputFrame({ focused: ring !== undefined, invalid: field.invalid, disabled, surface }),
            styles.trigger,
            ring,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              inputText('md', surface),
              styles.value,
              { color: chosen === undefined ? tones.tertiary : tones.primary },
            ]}
          >
            {shown}
          </Text>
          <View style={styles.chevron}>
            <Icon icon={Glyphs.ArrowDown2} size={16} color={tones.tertiary} />
          </View>
        </Pressable>
      </Animated.View>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title} returnFocusTo={trigger}>
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.options}>
          {options.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              selected={option.value === value}
              onChoose={() => {
                if (option.value !== value) {
                  haptics.selectReward();
                  onChange(option.value);
                }
                setOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>
    </>
  );
}

/** One option in the sheet: on white, always — the sheet is white. */
function OptionRow({
  option,
  selected,
  onChoose,
}: {
  readonly option: SelectOption;
  readonly selected: boolean;
  readonly onChoose: () => void;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const disabled = option.disabled ?? false;
  const tones = TONES.white;

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      accessibilityHint={option.description}
      accessibilityLanguage={option.accessibilityLanguage}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onChoose}
      onFocus={onFocus}
      onBlur={onBlur}
      contentStyle={({ pressed }) => [
        styles.option,
        selected ? styles.optionChosen : null,
        pressed && !disabled ? styles.optionPressed : null,
        disabled ? styles.optionDisabled : null,
        ring,
      ]}
    >
      <View style={styles.words}>
        <Text style={[styles.optionLabel, selected && styles.optionLabelChosen, { color: tones.primary }]}>
          {option.label}
        </Text>
        {option.description !== undefined && option.description !== '' ? (
          <Text style={[styles.optionDescription, { color: tones.secondary }]}>{option.description}</Text>
        ) : null}
      </View>
      {selected ? (
        <Icon icon={Glyphs.TickCircle} variant="bold" size={20} color={tones.primary} />
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: INPUT_HEIGHT.md },
  value: { flex: 1 },
  chevron: { paddingRight: 14 },
  options: { gap: spacing[1] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: measure.touchTarget,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
  },
  optionChosen: { backgroundColor: colors.whiteMuted },
  optionPressed: { backgroundColor: tint(colors.black, 0.08) },
  optionDisabled: { opacity: 0.4 },
  words: { flex: 1, gap: 2 },
  optionLabel: { ...font.regular, fontSize: fontSize.row, lineHeight: lineHeight.small },
  optionLabelChosen: { ...font.semibold },
  optionDescription: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small },
});
