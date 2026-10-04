import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { fillNodes } from '@ideanest/messages';
import { Body, Field, Pill, TextInput } from '../../components/ui';
import { requestPasswordReset } from '../../lib/auth';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { colors, font, spacing } from '../../theme';
import { AuthHeader, ExplainCard } from './auth-screen';
import { AuthLink } from './auth-link';
import { FormErrorSummary } from './form-error-summary';
import { useAuthNavigation } from './navigation';

/**
 * Asking for a reset link — the web's `PasswordResetRequestForm` (issue #152).
 *
 * <p>`POST /v1/auth/forgot-password` answers 202 for every address, so "if {address} has an
 * account" is not hedging: it is the only sentence this screen is entitled to write. The control
 * stays on every refusal, the rate limit included — none of this endpoint's refusals is a
 * suspension, and a 429 says how long is left.
 */
export function ResetRequestForm() {
  const t = useT();
  const navigate = useAuthNavigation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [askedFor, setAskedFor] = useState<string | null>(null);
  // `busy` is a value from the last render; two presses in one frame would both pass it.
  const inFlight = useRef(false);

  async function submit(): Promise<void> {
    const address = email.trim();
    if (inFlight.current || address === '') return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    try {
      await requestPasswordReset(address);
      setAskedFor(address);
    } catch (cause) {
      setFailure(describeAuthFailure(cause, t));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (askedFor !== null) {
    return (
      <View style={styles.column} testID="reset-sent">
        <AuthHeader title={t('auth.reset.sentTitle')} />
        <Body>
          {fillNodes(t.raw('auth.reset.sentIntro') as string, {
            address: <Text style={styles.address}>{askedFor}</Text>,
          })}
        </Body>
        <ExplainCard icon={Glyphs.SmsSearch}>
          <Body>{t('auth.reset.sentLifetime', { lifetime: t('auth.reset.lifetime') })}</Body>
          <Body>
            {fillNodes(t.raw('auth.reset.sentRetry') as string, {
              retry: <TryAnother label={t('auth.reset.tryAnother')} onPress={() => setAskedFor(null)} />,
            })}
          </Body>
        </ExplainCard>
        <AuthLink label={t('auth.reset.backToSignIn')} onPress={() => navigate.toSignIn()} />
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <AuthHeader title={t('auth.reset.title')} intro={t('auth.reset.intro')} />
      <FormErrorSummary failure={failure} testID="reset-failure" />
      <Field label={t('auth.fields.email')} error={fieldErrors.email} required>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
          placeholder={t('auth.fields.emailPlaceholder')}
          returnKeyType="go"
          textContentType="username"
          onSubmitEditing={() => void submit()}
          disabled={busy}
          testID="reset-email"
        />
      </Field>
      <Pill
        label={busy ? t('auth.reset.submitting') : t('auth.reset.submit')}
        size="lg"
        fullWidth
        busy={busy}
        disabled={email.trim() === ''}
        onPress={() => void submit()}
        testID="reset-submit"
      />
      <AuthLink
        prompt={t('auth.reset.remembered')}
        label={t('auth.reset.signIn')}
        onPress={() => navigate.toSignIn()}
      />
    </View>
  );
}

/**
 * "try another address", inside the sentence that offers it: a nested `Text` with a press handler,
 * which is what React Native has for a link in running text and which both platforms expose to the
 * screen reader as a link. It brings the form back with the address still in it.
 */
function TryAnother({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Text
      accessibilityRole="link"
      onPress={onPress}
      suppressHighlighting={false}
      style={styles.inlineLink}
      testID="reset-try-another"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[6] },
  address: { ...font.medium, color: colors.textPrimary },
  inlineLink: { ...font.medium, color: colors.textPrimary, textDecorationLine: 'underline' },
});
