import { StyleSheet, Text, View } from 'react-native';
import { getLocales } from 'expo-localization';
import { parseAmount, toWireAmount, type AmountOptions, type AmountRejection } from '@ideanest/money';
import { TONES, TextInput, useSurface } from '../../components/ui';
import { font, fontSize, spacing } from '../../theme';

/**
 * An amount of money, typed on a phone — the goal now, and the reward price and shipping rates
 * after it (#162).
 *
 * <h2>Text in, text out, never a number</h2>
 *
 * The field holds the string the creator typed. It becomes a `Decimal` only through
 * `@ideanest/money`'s `parseAmount` (see {@link readAmount}), and goes on the wire as
 * `toWireAmount`'s two-decimal string. Prefill it with `amountFieldValue(money)`. `Number()` and
 * `parseFloat()` are never applied to it: `0.1 + 0.2` is somebody's pledge.
 *
 * <h2>The comma, exactly as #162 specifies</h2>
 *
 * iOS and Android `decimal-pad` show the DEVICE locale's separator, a comma in az, ru and tr, and
 * `parseAmount` refuses commas on purpose. So as the creator types, {@link normaliseAmountInput}
 * turns the comma into a point — only when the device's separator is a comma, the text has no
 * point, and it has exactly one comma — and the field shows the normalised text. The keypad has
 * no grouping key, so a lone comma is a decimal mark; a pasted `1,500` becomes `1.500`, which
 * `parseAmount` refuses as too many decimals rather than misreading as one and a half thousand.
 * `parseAmount` itself is not changed.
 *
 * <h2>Contract</h2>
 *
 * Put it inside a `Field`, which names it and carries the error. Props: `value` and
 * `onChangeText` (the normalised text), `currency` (drawn as a suffix, decorative: the field's
 * hint or label says what it is), `onBlur` (flush the autosave here), `disabled`, `testID`.
 * `decimalSeparator` overrides the device's, for tests.
 */
export interface MoneyFieldProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly currency: string;
  readonly onBlur?: () => void;
  readonly disabled?: boolean;
  readonly decimalSeparator?: string | null;
  /**
   * Its own name, for an amount that is not alone in its `Field` — a shipping rate row, where the
   * name says which destination ("Shipping rate to TR"). Inside a `Field` of its own, leave it out.
   */
  readonly accessibilityLabel?: string;
  readonly placeholder?: string;
  readonly testID?: string;
}

/** The phone's decimal separator (`expo-localization`), or null when the platform does not say. */
export function deviceDecimalSeparator(): string | null {
  try {
    return getLocales()[0]?.decimalSeparator ?? null;
  } catch {
    return null;
  }
}

/**
 * #162's comma rule. On a comma-separator device, text with no `.` and exactly one `,` has the
 * comma replaced with `.`; anything else is returned as typed, for `parseAmount` to judge.
 */
export function normaliseAmountInput(text: string, decimalSeparator: string | null): string {
  if (decimalSeparator !== ',') return text;
  if (text.includes('.')) return text;
  if (text.split(',').length !== 2) return text;
  return text.replace(',', '.');
}

export type AmountReading =
  | { readonly ok: true; readonly wire: string }
  | { readonly ok: false; readonly reason: AmountRejection };

/** The field's text as the API's amount string, or the reason it is refused. */
export function readAmount(text: string, options: AmountOptions = {}): AmountReading {
  const parsed = parseAmount(text, options);
  return parsed.ok ? { ok: true, wire: toWireAmount(parsed.value) } : { ok: false, reason: parsed.reason };
}

export function MoneyField({
  value,
  onChangeText,
  currency,
  onBlur,
  disabled = false,
  decimalSeparator,
  accessibilityLabel,
  placeholder,
  testID,
}: MoneyFieldProps) {
  const surface = useSurface();
  const separator = decimalSeparator === undefined ? deviceDecimalSeparator() : decimalSeparator;
  return (
    <TextInput
      value={value}
      keyboardType="decimal-pad"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect={false}
      disabled={disabled}
      onChangeText={(text) => onChangeText(normaliseAmountInput(text, separator))}
      onBlur={onBlur}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...(placeholder === undefined ? {} : { placeholder })}
      testID={testID}
      trailing={
        <View style={styles.suffix} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.currency, { color: TONES[surface].tertiary }]}>{currency}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  suffix: { paddingRight: spacing[4], justifyContent: 'center' },
  currency: { ...font.medium, fontSize: fontSize.sm },
});
