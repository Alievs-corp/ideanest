import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { colors } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { Radio, RadioGroup } from './radio';
import { Sheet } from './sheet';
import { INPUT_HEIGHT, inputFrame, inputText } from './text-input';

/**
 * Choose one from a list — the native `Select` (`docs/ui-kit.md` §7.13).
 *
 * <p>The web uses the browser's own `<select>`, because a hand-built listbox always gets one of
 * type-ahead, the announcement contract or the platform picker wrong. A phone's equivalent of
 * "the platform's own list" is a sheet of radio buttons: every row 44pt, every option announced
 * as a radio button with its selected state, and the list scrolls when it is long.
 *
 * <p>The field looks like the other inputs (the shared `inputFrame`) and is
 * `accessibilityRole="combobox"`, with the chosen option — or the placeholder — as its value, so
 * VoiceOver reads "Currency, Azerbaijani manat, combo box". Pressing it opens the `Sheet`,
 * titled with the field's plain label (without the required word); choosing closes the sheet at once and returns focus to the
 * field, so the next swipe goes on to the next field instead of starting from the top.
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
  const { ring, onFocus, onBlur } = useFocusRing();
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);

  const chosen = options.find((option) => option.value === value);
  const shown = chosen?.label ?? placeholder ?? '';
  // The PLAIN label: the sheet's visible title is the question, not its accessible name, so
  // it never reads 'Currency, required'.
  const title = field.label ?? '';

  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="combobox"
        accessibilityLabel={field.accessibilityLabel}
        accessibilityHint={field.accessibilityHint}
        accessibilityValue={shown === '' ? undefined : { text: shown }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => {
          // A keyboard left up by the previous field would cover the sheet's options.
          Keyboard.dismiss();
          setOpen(true);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={[
          ...inputFrame({ focused: ring !== undefined, invalid: field.invalid, disabled }),
          styles.trigger,
          ring,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            inputText('md'),
            styles.value,
            { color: chosen === undefined ? colors.textTertiary : colors.textPrimary },
          ]}
        >
          {shown}
        </Text>
        <View style={styles.chevron}>
          <Icon icon={Glyphs.ArrowDown2} size={16} color={colors.textTertiary} />
        </View>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title} returnFocusTo={trigger}>
        <RadioGroup
          label={title}
          value={value}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        >
          {options.map((option) => (
            <Radio
              key={option.value}
              value={option.value}
              label={option.label}
              description={option.description}
              disabled={option.disabled}
              accessibilityLanguage={option.accessibilityLanguage}
            />
          ))}
        </RadioGroup>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: INPUT_HEIGHT.md },
  value: { flex: 1 },
  chevron: { paddingRight: 14 },
});
