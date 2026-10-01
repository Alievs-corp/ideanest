import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextInput as RNTextInput } from 'react-native';
import { MailCheck } from 'lucide-react-native';
import { fillNodes } from '@ideanest/messages';
import { Body, Field, PasswordInput, Pill, TextInput } from '../../components/ui';
import { register } from '../../lib/auth';
import {
  describeAuthFailure,
  fieldErrorsOf,
  refusalDetailOf,
  refusalOf,
  type AuthFailure,
} from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { colors, font, spacing } from '../../theme';
import { AuthHeader, ExplainCard } from './auth-screen';
import { AuthLink } from './auth-link';
import { FormErrorSummary } from './form-error-summary';
import { useAuthNavigation } from './navigation';
import { TwoFactorStep } from './two-factor-step';
import { useSignInOutcome } from './use-sign-in-outcome';

/**
 * Creating an account — the web's `RegisterForm` (issue #152).
 *
 * <h2>Always "check your email"</h2>
 *
 * `POST /v1/auth/register` answers 202 whether or not the address already has an account, on
 * purpose, and the email says which it was. So the sent state is the same for both, and nothing on
 * this screen ever says "this address is already registered" — that sentence is what somebody
 * enumerating accounts wants, and the service went to the trouble of not saying it.
 *
 * <h2>The heading is here, not on the route</h2>
 *
 * Which heading is right — the form's, "check your email", or the second factor's after a provider
 * sign-in — depends on state only this component holds.
 *
 * <p>No terms checkbox: the web has none and the legal text is not decided. The password rule is
 * the service's; its weak-password sentence goes under the field.
 */
export function RegisterForm({ returnTo }: { readonly returnTo: string | null }) {
  const t = useT();
  const navigate = useAuthNavigation();
  const emailField = useRef<RNTextInput>(null);
  const passwordField = useRef<RNTextInput>(null);
  const { challenge, finish, clearChallenge } = useSignInOutcome(returnTo);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  // `busy` is a value from the last render; two presses in one frame would both pass it.
  const inFlight = useRef(false);

  const complete = name.trim() !== '' && email.trim() !== '' && password !== '';

  async function submit(): Promise<void> {
    if (inFlight.current || !complete) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    const address = email.trim();
    try {
      await register({ email: address, password, name: name.trim() });
      setPassword('');
      setSentTo(address);
    } catch (cause) {
      setFailure(describeAuthFailure(cause, t));
      /*
       * The password policy refuses before validation does, with `type …/weak-password` and no
       * `errors` map — so its sentence is put under the field by hand, as the reset confirm does.
       */
      const weak = refusalOf(cause) === 'weak-password' ? refusalDetailOf(cause) : null;
      setFieldErrors(
        weak === null ? fieldErrorsOf(cause) : { ...fieldErrorsOf(cause), password: weak },
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (challenge !== null) {
    return (
      <View style={styles.column}>
        <AuthHeader title={t('auth.register.twoFactorTitle')} intro={t('auth.register.twoFactorIntro')} />
        <TwoFactorStep
          challenge={challenge.value}
          expiresInSeconds={challenge.expiresInSeconds}
          onSignedIn={finish}
          onStartOver={clearChallenge}
        />
      </View>
    );
  }

  if (sentTo !== null) {
    return (
      <View style={styles.column} testID="register-sent">
        <AuthHeader title={t('auth.register.sentTitle')} />
        {/*
          The address is echoed because a typo is the most common reason nothing arrives, and it is
          the reader's own address rather than anything the service disclosed. `fillNodes`, not two
          half-sentences: where the address goes is the translation's to decide.
        */}
        <Body>
          {fillNodes(t.raw('auth.register.sentIntro') as string, {
            address: <Text style={styles.address}>{sentTo}</Text>,
          })}
        </Body>
        <ExplainCard icon={MailCheck}>
          <Body>{t('auth.register.sentLifetime')}</Body>
          <Body>{t('auth.register.sentExisting')}</Body>
        </ExplainCard>
        <AuthLink
          prompt={t('auth.register.verified')}
          label={t('auth.register.signIn')}
          onPress={() => navigate.toSignIn(returnTo)}
        />
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <AuthHeader title={t('auth.register.title')} intro={t('auth.register.intro')} />

      <FormErrorSummary failure={failure} testID="register-failure" />

      <View style={styles.fields}>
        <Field
          label={t('auth.register.name')}
          hint={t('auth.register.nameHint')}
          error={fieldErrors.name}
          required
        >
          <TextInput
            value={name}
            onChangeText={setName}
            autoComplete="name"
            maxLength={80}
            returnKeyType="next"
            textContentType="name"
            onSubmitEditing={() => emailField.current?.focus()}
            disabled={busy}
            testID="register-name"
          />
        </Field>
        <Field label={t('auth.fields.email')} error={fieldErrors.email} required>
          <TextInput
            ref={emailField}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            placeholder={t('auth.fields.emailPlaceholder')}
            returnKeyType="next"
            textContentType="emailAddress"
            onSubmitEditing={() => passwordField.current?.focus()}
            disabled={busy}
            testID="register-email"
          />
        </Field>
        <Field
          label={t('auth.fields.password')}
          hint={t('auth.fields.passwordHint')}
          error={fieldErrors.password}
          required
        >
          <PasswordInput
            ref={passwordField}
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            disabled={busy}
            testID="register-password"
          />
        </Field>
      </View>

      <Pill
        label={busy ? t('auth.register.submitting') : t('auth.register.submit')}
        size="lg"
        fullWidth
        busy={busy}
        disabled={!complete}
        onPress={() => void submit()}
        testID="register-submit"
      />

      <AuthLink
        prompt={t('auth.register.haveAccount')}
        label={t('auth.register.signIn')}
        onPress={() => navigate.toSignIn(returnTo)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[6] },
  fields: { gap: spacing[5] },
  address: { ...font.medium, color: colors.textPrimary },
});
