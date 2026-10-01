import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Body, Field, InlineAlert, PasswordInput, Pill } from '../../components/ui';
import { resetPassword } from '../../lib/auth';
import {
  describeAuthFailure,
  fieldErrorsOf,
  refusalDetailOf,
  refusalOf,
  type AuthFailure,
} from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { AuthHeader, ExplainCard, SuccessHeader } from './auth-screen';
import { AuthLinkPair } from './auth-link';
import { FormErrorSummary } from './form-error-summary';
import { useAuthNavigation } from './navigation';

/**
 * Choosing a new password from an emailed link — the web's `PasswordResetConfirmForm` (#152).
 *
 * <h2>Compared here, and nothing sent on a mismatch</h2>
 *
 * The link is spent by the request, so a typo in the second box would cost the link. The two
 * passwords are compared on the phone and a mismatch sends nothing.
 *
 * <h2>Weak password keeps the link; a dead link is a state</h2>
 *
 * `weak-password` leaves the token unspent, so the form stays with the service's sentence under
 * the field. `invalid-verification-link` — expired, used, or never one — is its own screen with
 * the service's exact sentence, because only the service knows which of the three it was.
 *
 * <h2>After it</h2>
 *
 * The service has revoked every session of that account. Nothing here signs anybody out: the
 * account this phone holds may be a different one, and if it is the same one the next refresh
 * answers 401, which `lib/auth.ts` already turns into a sign-out.
 */
export function ResetConfirmForm({ token }: { readonly token: string }) {
  const t = useT();
  const navigate = useAuthNavigation();
  const repeatField = useRef<RNTextInput>(null);
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [deadLink, setDeadLink] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // `busy` is a value from the last render; a second request after the first spent the link is a
  // dead-link refusal the reader would see over a success.
  const inFlight = useRef(false);

  const lifetime = t('auth.reset.lifetime');
  const askAgain = (label: string) => (
    <AuthLinkPair
      first={{ label, onPress: () => navigate.toResetRequest() }}
      second={{ label: t('auth.resetConfirm.signIn'), onPress: () => navigate.toSignIn() }}
    />
  );

  async function submit(): Promise<void> {
    if (inFlight.current || password === '' || repeated === '') return;
    if (password !== repeated) {
      setFailure({
        title: t('auth.resetConfirm.mismatchTitle'),
        detail: t('auth.resetConfirm.mismatchDetail'),
        retryable: true,
      });
      setFieldErrors({ repeated: t('auth.resetConfirm.mismatchField') });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    try {
      await resetPassword(token, password);
      setPassword('');
      setRepeated('');
      setDone(true);
    } catch (cause) {
      const refusal = refusalOf(cause);
      if (refusal === 'invalid-verification-link') {
        setDeadLink(refusalDetailOf(cause) ?? t('auth.resetConfirm.deadFallback'));
        return;
      }
      setFailure(describeAuthFailure(cause, t));
      setFieldErrors(
        refusal === 'weak-password'
          ? {
              ...fieldErrorsOf(cause),
              password: refusalDetailOf(cause) ?? t('auth.resetConfirm.refusedPassword'),
            }
          : fieldErrorsOf(cause),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (token === '') {
    return (
      <View style={styles.column} testID="reset-confirm-no-token">
        <AuthHeader
          title={t('auth.resetConfirm.noTokenTitle')}
          intro={t('auth.resetConfirm.noTokenIntro')}
        />
        {askAgain(t('auth.resetConfirm.askForLink'))}
      </View>
    );
  }

  if (deadLink !== null) {
    return (
      <View style={styles.column} testID="reset-confirm-dead">
        <AuthHeader title={t('auth.resetConfirm.deadTitle')} />
        <InlineAlert
          variant="danger"
          title={t('auth.resetConfirm.deadAlertTitle')}
          description={deadLink}
        />
        <ExplainCard>
          <Body>{t('auth.resetConfirm.deadExplain', { lifetime })}</Body>
        </ExplainCard>
        {askAgain(t('auth.resetConfirm.askNewLink'))}
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.column} testID="reset-confirm-done">
        <SuccessHeader
          title={t('auth.resetConfirm.doneTitle')}
          intro={t('auth.resetConfirm.doneIntro')}
        />
        <Pill
          label={t('auth.resetConfirm.signIn')}
          size="lg"
          fullWidth
          onPress={() => navigate.toSignIn()}
        />
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <AuthHeader
        title={t('auth.resetConfirm.title')}
        intro={t('auth.resetConfirm.intro', { lifetime })}
      />
      <FormErrorSummary failure={failure} testID="reset-confirm-failure" />
      <View style={styles.fields}>
        <Field
          label={t('auth.resetConfirm.newPassword')}
          hint={t('auth.fields.passwordHint')}
          error={fieldErrors.password}
          required
        >
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => repeatField.current?.focus()}
            disabled={busy}
            testID="reset-confirm-password"
          />
        </Field>
        <Field
          label={t('auth.resetConfirm.repeat')}
          hint={t('auth.resetConfirm.repeatHint')}
          error={fieldErrors.repeated}
          required
        >
          <PasswordInput
            ref={repeatField}
            value={repeated}
            onChangeText={setRepeated}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            disabled={busy}
            testID="reset-confirm-repeat"
          />
        </Field>
      </View>
      <Pill
        label={busy ? t('auth.resetConfirm.submitting') : t('auth.resetConfirm.submit')}
        size="lg"
        fullWidth
        busy={busy}
        disabled={password === '' || repeated === ''}
        onPress={() => void submit()}
        testID="reset-confirm-submit"
      />
      {askAgain(t('auth.resetConfirm.askNewInstead'))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[6] },
  fields: { gap: spacing[5] },
});
