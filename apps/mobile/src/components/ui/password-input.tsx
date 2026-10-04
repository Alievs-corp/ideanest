import { forwardRef, useState } from 'react';
import type { TextInput as RNTextInput } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { IconButton } from './icon-button';
import { TextInput, type TextInputProps } from './text-input';

/**
 * A password input with a show/hide toggle — the native `PasswordInput` (`docs/ui-kit.md` §7.13).
 *
 * <p>The toggle is an `IconButton` whose name says what pressing it DOES ("Show password" while
 * hidden, "Hide password" while shown — `auth.fields.showPassword` and `hidePassword`, the web's
 * own words) and whose `accessibilityState.selected` says what it IS: the web's `aria-pressed`.
 * A name that described the state instead ("password visible") leaves somebody guessing whether
 * pressing it will show or hide.
 *
 * <p>The password is never autocorrected or capitalised, and the platform's password manager is
 * offered it (`textContentType`, `autoComplete`) — a sign-in form that fights the keychain is
 * one people type weaker passwords into.
 */
export type PasswordInputProps = Omit<TextInputProps, 'secureTextEntry' | 'trailing'>;

export const PasswordInput = forwardRef<RNTextInput, PasswordInputProps>(function PasswordInput(
  { disabled = false, ...props },
  ref,
) {
  const t = useT('auth.fields');
  const [shown, setShown] = useState(false);

  return (
    <TextInput
      ref={ref}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="current-password"
      textContentType="password"
      {...props}
      disabled={disabled}
      secureTextEntry={!shown}
      trailing={
        <IconButton
          icon={shown ? Glyphs.EyeSlash : Glyphs.Eye}
          label={shown ? t('hidePassword') : t('showPassword')}
          variant="ghost"
          size="sm"
          selected={shown}
          disabled={disabled}
          onPress={() => setShown((current) => !current)}
        />
      }
    />
  );
});
