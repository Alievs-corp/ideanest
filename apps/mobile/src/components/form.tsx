import { forwardRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, fontSize, fontWeight, radius, size, spacing, tracking } from '../theme';
import { Body, Meta } from './text';

/**
 * The three controls a form on this platform needs — §17.1.
 *
 * <h2>Why these are here rather than in `@ideanest/ui`</h2>
 *
 * That package is React DOM: its `Field` renders a `<label>` and wires
 * `aria-describedby`, neither of which exists in React Native. The tokens are
 * shared and the markup cannot be, which is the split `src/theme/index.ts`
 * already describes — so this file is the native half of the same design, and
 * the values in it all come from `../theme`.
 *
 * <h2>Accessibility, and where it differs from the web</h2>
 *
 * React Native has no `<label for>`. What it has is `accessibilityLabel` on the
 * input itself and `accessibilityLabelledBy` on Android only, so the label text
 * is passed to the field AND set on the input — a visible label a sighted reader
 * uses, and the same words announced to a screen reader. A field whose label
 * exists only as a `Text` above it is announced as "text field", which is the
 * native equivalent of the unlabelled input `docs/ui-kit.md` §7.13 refuses.
 *
 * <p>An error is announced as well as coloured. `accessibilityRole="alert"` on
 * the message and `aria-invalid` on the input, because CLAUDE.md §2 forbids
 * colour carrying meaning on its own and a red border is exactly that.
 *
 * <h2>Motion: none</h2>
 *
 * `docs/motion-system.md` §5 gives authentication and account settings no
 * entry animation and 150ms of colour on controls. The pressed state below is
 * an immediate colour swap for that reason — React Native applies it on the
 * same frame — and there is no `FadeUp` on any screen that uses this file.
 */

const styles = StyleSheet.create({
  field: { gap: spacing[2] },
  input: {
    minHeight: size.touchTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
    letterSpacing: tracking.body,
  },
  /**
   * The focused border is lime, and the text on it never is.
   *
   * CLAUDE.md §2: lime is a surface with near-black text on it, or it is
   * nothing. A border is neither — it carries no text — so it is the one place
   * lime is legible against a dark card, and it is what makes focus visible on
   * a hardware keyboard.
   */
  inputFocused: { borderColor: colors.lime500 },
  inputInvalid: { borderColor: colors.danger },
  button: {
    minHeight: size.touchTarget,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[6],
  },
  primary: { backgroundColor: colors.lime500 },
  primaryPressed: { backgroundColor: colors.lime600 },
  secondary: {
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryPressed: { backgroundColor: colors.surface3 },
  disabled: { opacity: 0.5 },
  label: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    letterSpacing: tracking.button,
  },
});

export interface TextFieldProps extends TextInputProps {
  readonly label: string;
  /** Shown under the control, and announced with it. */
  readonly hint?: string;
  /** What is wrong. Present means invalid; there is no separate boolean to disagree with it. */
  readonly error?: string;
}

/**
 * A labelled text input.
 *
 * <p>`forwardRef` so a form can move focus to the next field on submit — which
 * is what `returnKeyType="next"` promises, and a promise a keyboard makes and
 * the application does not keep is worse than not making it.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, style, onBlur, onFocus, ...rest },
  ref,
) {
  const invalid = error !== undefined && error !== '';
  /*
   * React Native has no `:focus-visible`, and no focus ring of its own on
   * Android. CLAUDE.md §2 requires focus to be visible on every interactive
   * element, so the border is drawn from state rather than from a pseudo-class
   * that does not exist here.
   */
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Meta tone="secondary">{label}</Meta>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        aria-invalid={invalid}
        placeholderTextColor={colors.textTertiary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          // Invalid last: a field that is both focused and wrong is wrong.
          invalid && styles.inputInvalid,
          style,
        ]}
        {...rest}
      />
      {hint !== undefined && !invalid ? <Meta>{hint}</Meta> : null}
      {invalid ? (
        <Body accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Body>
      ) : null}
    </View>
  );
});

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Shows a spinner and blocks presses. The label stays, so the button does not resize. */
  readonly busy?: boolean;
  readonly variant?: 'primary' | 'secondary';
}

/**
 * The one button shape this application has.
 *
 * <p>Lime for the primary action, because §8.1's lime means "act now" and a
 * sign-in button is the only thing on its screen. Near-black text on it, which
 * is the only readable pairing — `text-white/64` on lime measures 1.3:1 and
 * CLAUDE.md §2 rejects it by name.
 */
export function Button({
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
}: ButtonProps) {
  const blocked = disabled || busy;
  const primary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
        blocked && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={primary ? colors.textOnLime : colors.textPrimary}
          /*
           * No accessible name. The button already carries one and
           * `accessibilityState.busy` says what the spinner says, so naming it
           * would announce the control twice.
           */
        />
      ) : null}
      <Body
        tone={primary ? 'onLime' : 'primary'}
        style={styles.label}
        /* The button owns the announcement; its text must not be a second stop. */
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Body>
    </Pressable>
  );
}
