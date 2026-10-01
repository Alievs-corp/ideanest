import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Body, InlineAlert, Pill } from '../../components/ui';
import { verifyEmail } from '../../lib/auth';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { AuthHeader, ExplainCard, SuccessHeader } from './auth-screen';
import { AuthLinkPair } from './auth-link';
import { useSpendOnce, useStatusAnnouncement } from './link-token';
import { useAuthNavigation } from './navigation';

type Status = 'idle' | 'verifying' | 'verified' | 'failed';

/**
 * The verification link from the registration email — the web's `VerifyEmailView` (#152).
 *
 * <p>The token is posted once and never again (`useSpendOnce`): a second request after a success
 * is a refusal the reader would see. Verifying creates no session — the account was
 * made at registration, and signing in is the next step either way.
 */
export function VerifyEmailView({ token }: { readonly token: string }) {
  const t = useT();
  const navigate = useAuthNavigation();
  const [status, setStatus] = useState<Status>(token === '' ? 'idle' : 'verifying');
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  useSpendOnce(token, verifyEmail, {
    done: () => setStatus('verified'),
    failed: (cause) => {
      setFailure(describeAuthFailure(cause, t));
      setStatus('failed');
    },
  });

  useStatusAnnouncement(
    status === 'verifying'
      ? t('auth.verifyEmail.statusVerifying')
      : status === 'verified'
        ? t('auth.verifyEmail.statusVerified')
        : status === 'failed'
          ? t('auth.verifyEmail.statusFailed')
          : '',
  );

  const footer = (
    <AuthLinkPair
      first={{ label: t('auth.verifyEmail.createAccount'), onPress: () => navigate.toRegister() }}
      second={{ label: t('auth.verifyEmail.home'), onPress: () => navigate.home() }}
    />
  );
  const signIn = (
    <Pill
      label={t('auth.verifyEmail.signIn')}
      size="lg"
      fullWidth
      onPress={() => navigate.toSignIn()}
      testID="verify-email-sign-in"
    />
  );

  if (status === 'idle') {
    return (
      <View style={styles.column} testID="verify-email-idle">
        <AuthHeader title={t('auth.verifyEmail.idleTitle')} intro={t('auth.verifyEmail.idleIntro')} />
        {footer}
      </View>
    );
  }

  if (status === 'verifying') {
    return (
      <View style={styles.column} testID="verify-email-verifying">
        <AuthHeader
          title={t('auth.verifyEmail.verifyingTitle')}
          intro={t('auth.verifyEmail.verifyingIntro')}
        />
      </View>
    );
  }

  if (status === 'verified') {
    return (
      <View style={styles.column} testID="verify-email-verified">
        <SuccessHeader
          title={t('auth.verifyEmail.verifiedTitle')}
          intro={t('auth.verifyEmail.verifiedIntro')}
        />
        {signIn}
      </View>
    );
  }

  return (
    <View style={styles.column} testID="verify-email-failed">
      <AuthHeader title={t('auth.verifyEmail.failedTitle')} />
      {failure === null ? null : (
        // Not announced by the alert itself: the status above has already been said.
        <InlineAlert
          variant="danger"
          title={failure.title}
          description={failure.detail}
          politeness="off"
        />
      )}
      <ExplainCard>
        <Body>{t('auth.verifyEmail.failedExplain')}</Body>
      </ExplainCard>
      {signIn}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[6] },
});
