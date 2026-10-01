import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Field, InlineAlert, Pill, TextInput } from '../../components/ui';
import { verifyTwoFactor } from '../../lib/auth';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { AuthLink, Disclosure } from './auth-link';
import { FormErrorSummary } from './form-error-summary';

/**
 * The second factor — the web's `TwoFactorChallenge`, a state of sign-in and register rather
 * than a route (issue #152).
 *
 * <h2>The challenge lives in this component's state and nowhere else</h2>
 *
 * It is a credential for the next five minutes (`auth.two-factor.challenge-ttl: PT5M`). A route
 * param is a URL, and a URL is what a deep link, a log and an analytics event all carry — so it is
 * never one, and it is never written to MMKV or the keychain either.
 *
 * <h2>Two fields, because the service reads two fields</h2>
 *
 * `SecondFactors.accepts` treats a non-blank `code` as a TOTP and never falls back to the recovery
 * code, and `code` is at most 16 characters. The old single field promised "a recovery code works
 * here too" and always refused one. The recovery code has its own field behind "I cannot reach my
 * authenticator", and when both are filled the recovery code wins, as on the web — but only while
 * that field is showing: a recovery code left behind a collapsed disclosure is not what somebody
 * who then typed a code meant to send.
 *
 * <h2>Expiry</h2>
 *
 * One timer from `expiresInSeconds`, and no countdown on screen — a ticking number is pressure,
 * and the reader only needs to know when it is over. After it, submitting cannot work, so the
 * step says so and offers to start again.
 */
export function TwoFactorStep({
  challenge,
  expiresInSeconds,
  onSignedIn,
  onStartOver,
}: {
  readonly challenge: string;
  readonly expiresInSeconds: number;
  readonly onSignedIn: () => void | Promise<void>;
  /** Clears the password and returns to the credentials. */
  readonly onStartOver: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [expired, setExpired] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // `busy` is a value from the last render; two presses in one frame (the keyboard's go key and
  // the pill) would both pass it. A second /2fa/verify after the first succeeded is a refusal.
  const inFlight = useRef(false);

  useEffect(() => {
    if (expiresInSeconds <= 0) return;
    const timer = setTimeout(() => setExpired(true), expiresInSeconds * 1000);
    return () => clearTimeout(timer);
  }, [expiresInSeconds]);

  const typedCode = code.trim();
  const typedRecovery = recoveryOpen ? recoveryCode.trim() : '';

  async function submit(): Promise<void> {
    if (inFlight.current || expired || (typedCode === '' && typedRecovery === '')) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await verifyTwoFactor(
        challenge,
        typedRecovery === ''
          ? { kind: 'code', code: typedCode }
          : { kind: 'recovery-code', recoveryCode: typedRecovery },
      );
      await onSignedIn();
    } catch (cause) {
      setFailure(describeAuthFailure(cause, t));
      // A refused code is spent either way; leaving it in the field invites resubmitting it.
      setCode('');
      setRecoveryCode('');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <View style={styles.step}>
        <InlineAlert
          variant="warning"
          title={t('auth.twoFactor.expiredTitle')}
          description={t('auth.twoFactor.expiredDetail')}
        />
        <Pill label={t('auth.twoFactor.signInAgain')} size="lg" fullWidth onPress={onStartOver} />
      </View>
    );
  }

  return (
    <View style={styles.step}>
      <InlineAlert
        variant="info"
        title={t('auth.twoFactor.acceptedTitle')}
        description={t('auth.twoFactor.acceptedDetail')}
      />

      <FormErrorSummary failure={failure} />

      <Field label={t('auth.twoFactor.codeLabel')}>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoFocus
          autoComplete="one-time-code"
          autoCorrect={false}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={16}
          placeholder={t('auth.twoFactor.codePlaceholder')}
          returnKeyType="go"
          textContentType="oneTimeCode"
          onSubmitEditing={() => void submit()}
          disabled={busy}
          testID="two-factor-code"
        />
      </Field>

      <Disclosure
        label={t('auth.twoFactor.cannotReach')}
        open={recoveryOpen}
        onToggle={setRecoveryOpen}
        testID="two-factor-cannot-reach"
      >
        <Field label={t('auth.twoFactor.recoveryLabel')} hint={t('auth.twoFactor.recoveryHint')}>
          <TextInput
            value={recoveryCode}
            onChangeText={setRecoveryCode}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            disabled={busy}
            testID="two-factor-recovery"
          />
        </Field>
      </Disclosure>

      <Pill
        label={busy ? t('auth.twoFactor.submitting') : t('auth.twoFactor.submit')}
        size="lg"
        fullWidth
        busy={busy}
        disabled={typedCode === '' && typedRecovery === ''}
        onPress={() => void submit()}
        testID="two-factor-submit"
      />

      <AuthLink
        role="button"
        label={t('auth.twoFactor.differentAccount')}
        onPress={onStartOver}
        testID="two-factor-different-account"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: spacing[5] },
});
