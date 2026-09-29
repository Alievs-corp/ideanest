import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { Button, TextField } from '../components/form';
import { Body, Heading, Meta } from '../components/text';
import { signIn, verifyTwoFactor } from '../lib/auth';
import { safeNext } from '../lib/guard';
import { colors, size, spacing } from '../theme';

/**
 * Signing in on a phone — issue #29's prerequisite, and part of the same change.
 *
 * <h2>Why this screen exists in the biometric-unlock issue</h2>
 *
 * #29 is a gate on a session, and nothing on this platform created one on a
 * phone: the backend has had registration, rotation, social sign-in and
 * two-factor since #23–#26, and no client drove any of it. The issue's own
 * comment says so — "biometric unlock re-opens an existing session; it does not
 * create one" — and names it a prerequisite belonging to no issue. Shipping the
 * gate without it would have been a feature that cannot fire.
 *
 * <p>It is deliberately the smallest sign-in that is honest: an address, a
 * password, and §17.1's second factor when the account has one. Registration,
 * password reset and the provider buttons stay on the web, which is where a
 * verification email lands anyway.
 *
 * <h2>The two-factor challenge never reaches a URL</h2>
 *
 * It is a credential for the next few minutes. `apps/web`'s `TwoFactorChallenge`
 * carries the full argument for why the challenge is a state of this form rather
 * than a route: a query string is written to logs, kept in history, and
 * forwarded in a `Referer`. Here there is no history and no referer, and the
 * reason still holds — a deep link is a URL, and #114 will happily route one.
 *
 * <h2>Motion: none</h2>
 *
 * `docs/motion-system.md` §5 gives authentication no entry animation. Nothing on
 * this screen fades, and `FadeUp` is not imported.
 */

const styles = StyleSheet.create({
  content: {
    padding: size.cardPaddingLarge,
    gap: spacing[6],
    flexGrow: 1,
    justifyContent: 'center',
  },
  intro: { gap: spacing[2] },
  fields: { gap: spacing[5] },
  failure: {
    borderRadius: spacing[3],
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    backgroundColor: colors.surface2,
    padding: spacing[4],
  },
});

type Step = 'credentials' | 'two-factor';

export default function SignInScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const passwordField = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function done(): void {
    /*
     * `back` and not `replace`. This screen is pushed from wherever somebody
     * was — a Saved tab, a Pledges tab, the account screen — and returning them
     * there is what they expect. `use-session.ts` publishes the change, so the
     * screen underneath has already redrawn by the time it is visible.
     */
    // A guarded route sent somebody here with `next`; validated by the same rules as
    // the web's redirect, so a crafted link cannot steer past sign-in to anywhere.
    const destination = safeNext(next);
    if (destination !== null) router.replace(destination as never);
    else router.back();
  }

  async function submitCredentials(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      const outcome = await signIn(email.trim(), password);
      if (outcome.kind === 'two-factor') {
        setChallenge(outcome.challenge);
        setStep('two-factor');
        return;
      }
      done();
    } catch (cause) {
      setFailure(readable(cause, 'credentials'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      await verifyTwoFactor(challenge, code.trim());
      done();
    } catch (cause) {
      setFailure(readable(cause, 'two-factor'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      // iOS moves the whole view; Android resizes the window itself and a second
      // adjustment there pushes the form off the top of the screen.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.intro}>
          <Heading>{step === 'credentials' ? 'Sign in' : 'One more step'}</Heading>
          <Body>
            {step === 'credentials'
              ? 'Your saved campaigns and your pledges belong to your account, not to this phone.'
              : 'Enter the six-digit code from your authenticator app, or one of your recovery codes.'}
          </Body>
        </View>

        {failure === null ? null : (
          <View style={styles.failure} accessibilityRole="alert">
            <Body>{failure}</Body>
          </View>
        )}

        {step === 'credentials' ? (
          <View style={styles.fields}>
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              inputMode="email"
              keyboardType="email-address"
              returnKeyType="next"
              textContentType="username"
              onSubmitEditing={() => passwordField.current?.focus()}
              editable={!busy}
            />
            <TextField
              ref={passwordField}
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              secureTextEntry
              returnKeyType="go"
              textContentType="password"
              onSubmitEditing={() => void submitCredentials()}
              editable={!busy}
            />
            <Button
              label="Sign in"
              busy={busy}
              disabled={email.trim() === '' || password === ''}
              onPress={() => void submitCredentials()}
            />
          </View>
        ) : (
          <View style={styles.fields}>
            <TextField
              label="Authentication code"
              value={code}
              onChangeText={setCode}
              autoComplete="one-time-code"
              autoCorrect={false}
              inputMode="numeric"
              keyboardType="number-pad"
              returnKeyType="go"
              textContentType="oneTimeCode"
              onSubmitEditing={() => void submitCode()}
              editable={!busy}
              hint="A recovery code works here too."
            />
            <Button
              label="Verify"
              busy={busy}
              disabled={code.trim() === ''}
              onPress={() => void submitCode()}
            />
          </View>
        )}

        <Meta>
          Registration, password reset and provider sign-in are on ideanest.az. A new account
          needs an email to be verified, which is a link rather than a screen.
        </Meta>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * What to put on screen for a refusal.
 *
 * <p>Branching on §10.4's `code` and on the status, never on `detail` — that
 * field is prose the service may reword or localise, and a client that keyed off
 * it would break on a copy change. The three cases that get their own sentence
 * are the three somebody can act on; everything else is one message, because a
 * network fault, an outage and an unexpected refusal are answered by the same
 * thing.
 */
function readable(cause: unknown, step: Step): string {
  if (!(cause instanceof ApiError)) {
    return 'Could not reach IdeyaNest. Check your connection and try again.';
  }
  if (cause.status === 429) {
    const seconds = cause.problem?.retryAfterSeconds;
    return seconds === undefined
      ? 'Too many attempts. Wait a little and try again.'
      : `Too many attempts. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  if (cause.status === 401 || cause.status === 400) {
    /*
     * The same two statuses mean different things at the two steps, and the
     * sentence has to follow: "that address and password do not match" under a
     * field holding six digits is a message about a form the reader has already
     * left. The challenge is single-use and short-lived, so an expired one is
     * named — it is the case where trying the same code again cannot work.
     */
    if (step === 'two-factor') {
      return 'That code was not accepted. It may have expired — sign in again to get a new challenge.';
    }
    // Deliberately not "that address is unknown". Which half was wrong is what
    // an attacker enumerating accounts wants to be told, and the service does
    // not distinguish them either.
    return 'That email address and password do not match an account.';
  }
  return 'Something went wrong signing in. Try again.';
}
