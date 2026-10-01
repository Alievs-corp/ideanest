import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Field, InlineAlert, PasswordInput, Pill, TextInput } from '../../components/ui';
import { signIn } from '../../lib/auth';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { FormErrorSummary } from './form-error-summary';
import { ProviderButtons } from './provider-buttons';
import { TwoFactorStep } from './two-factor-step';
import { useSignInOutcome } from './use-sign-in-outcome';

/** The one notice a link may ask the sign-in screen to show. No text is ever taken from a link. */
export const PASSWORD_CHANGED_NOTICE = 'password-changed';

/**
 * Signing in with an address and a password — the web's `SignInForm` (issue #152).
 *
 * <h2>Refusals</h2>
 *
 * `describeAuthFailure` decides the words; this decides the controls. A suspension withdraws the
 * submit pill, because the credentials were right and no retry will change the answer. A rate
 * limit keeps it, with the wait said. Field errors from §10.4's `errors` go under their fields.
 * Nothing here ever says which half of the credentials was wrong — the service does not either.
 *
 * <h2>The two-factor step replaces the form</h2>
 *
 * From the notice down, not the header: the reader is still signing in. "Use a different account"
 * and an expired challenge both clear the password and come back here.
 */
export function SignInForm({
  returnTo,
  notice,
  footer,
}: {
  readonly returnTo: string | null;
  /** Only {@link PASSWORD_CHANGED_NOTICE} is recognised; anything else shows nothing. */
  readonly notice: string | undefined;
  /** The links under the form, which belong to the credentials step only. */
  readonly footer?: ReactNode;
}) {
  const t = useT();
  const passwordField = useRef<RNTextInput>(null);
  const { challenge, settle, finish, clearChallenge } = useSignInOutcome(returnTo);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  /*
   * `busy` is a value from the last render, so two presses in one frame — the keyboard's go key
   * and the pill — would both pass it. Two /login calls issue two challenges and the service
   * retires the first; answered out of order, the step would hold the dead one.
   */
  const inFlight = useRef(false);

  async function submit(): Promise<void> {
    if (inFlight.current || email.trim() === '' || password === '') return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    try {
      await settle(await signIn(email.trim(), password));
    } catch (cause) {
      setFailure(describeAuthFailure(cause, t));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function startOver(): void {
    clearChallenge();
    setPassword('');
    setFailure(null);
    setFieldErrors({});
  }

  if (challenge !== null) {
    return (
      <TwoFactorStep
        challenge={challenge.value}
        expiresInSeconds={challenge.expiresInSeconds}
        onSignedIn={finish}
        onStartOver={startOver}
      />
    );
  }

  const suspended = failure !== null && !failure.retryable;

  return (
    <View style={styles.form}>
      {notice === PASSWORD_CHANGED_NOTICE ? (
        <InlineAlert
          variant="success"
          title={t('auth.signIn.passwordChangedTitle')}
          description={t('auth.signIn.passwordChangedDetail')}
          testID="sign-in-password-changed"
        />
      ) : null}

      <FormErrorSummary failure={failure} testID="sign-in-failure" />

      <View style={styles.fields}>
        <Field label={t('auth.fields.email')} error={fieldErrors.email}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            placeholder={t('auth.fields.emailPlaceholder')}
            returnKeyType="next"
            textContentType="username"
            onSubmitEditing={() => passwordField.current?.focus()}
            disabled={busy}
            testID="sign-in-email"
          />
        </Field>
        <Field label={t('auth.fields.password')} error={fieldErrors.password}>
          <PasswordInput
            ref={passwordField}
            value={password}
            onChangeText={setPassword}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            disabled={busy}
            testID="sign-in-password"
          />
        </Field>
      </View>

      {/*
        White, not lime. Lime marks the one urgent action on a screen — backing a campaign — and
        signing in is not it (issue #151).
      */}
      {suspended ? null : (
        <Pill
          label={busy ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
          size="lg"
          fullWidth
          busy={busy}
          disabled={email.trim() === '' || password === ''}
          onPress={() => void submit()}
          testID="sign-in-submit"
        />
      )}

      {footer}

      {/* Below the form, as on the web: the address and password are the primary path. */}
      <ProviderButtons intent="sign-in" onOutcome={settle} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[6] },
  fields: { gap: spacing[5] },
});
