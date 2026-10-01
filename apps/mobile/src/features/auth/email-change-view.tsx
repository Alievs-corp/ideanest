import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Body, InlineAlert, Pill } from '../../components/ui';
import { ACCOUNT_KEYS } from '../../lib/account';
import { confirmEmailChange } from '../../lib/auth';
import {
  describeAuthFailure,
  refusalDetailOf,
  refusalOf,
  type AuthFailure,
} from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { AuthHeader, ExplainCard, SuccessHeader } from './auth-screen';
import { AuthLinkPair } from './auth-link';
import { useSpendOnce, useStatusAnnouncement } from './link-token';
import { useAuthNavigation } from './navigation';

type Status = 'idle' | 'confirming' | 'confirmed' | 'taken' | 'refused';

/** Where "Go to your account" and "Email settings" lead; guarded, so a signed-out reader signs in first. */
const EMAIL_SETTINGS = '/settings/email';

/**
 * The confirmation link sent to a new address — the web's `EmailChangeConfirmView` (#152).
 *
 * <p>Public: the reader arrives from the new mailbox and may not be signed in on this phone. The
 * token is posted once. Sessions are not revoked by it; if this phone is signed in, the
 * account read is refreshed so Me shows the new address.
 *
 * <p>`email-already-in-use` is its own state, because the service rolls the claim back on it and
 * the link is NOT spent — worth saying, since a change that becomes possible again can still be
 * confirmed with it.
 */
export function EmailChangeView({ token }: { readonly token: string }) {
  const t = useT();
  const navigate = useAuthNavigation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(token === '' ? 'idle' : 'confirming');
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useSpendOnce(token, confirmEmailChange, {
    done: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
      setStatus('confirmed');
    },
    failed: (cause) => {
      const refusal = refusalOf(cause);
      setDetail(refusalDetailOf(cause));
      if (refusal === 'email-already-in-use') {
        setStatus('taken');
        return;
      }
      if (refusal !== 'invalid-verification-link') setFailure(describeAuthFailure(cause, t));
      setStatus('refused');
    },
  });

  useStatusAnnouncement(
    status === 'confirming'
      ? t('auth.emailChange.statusConfirming')
      : status === 'confirmed'
        ? t('auth.emailChange.statusConfirmed')
        : status === 'taken'
          ? t('auth.emailChange.statusTaken')
          : status === 'refused'
            ? t('auth.emailChange.statusRefused')
            : '',
  );

  const footer = (
    <AuthLinkPair
      first={{
        label: t('auth.emailChange.emailSettings'),
        onPress: () => navigate.leaveTo(EMAIL_SETTINGS),
      }}
      second={{ label: t('auth.emailChange.signIn'), onPress: () => navigate.toSignIn() }}
    />
  );

  switch (status) {
    case 'idle':
      return (
        <View style={styles.column} testID="email-change-idle">
          <AuthHeader title={t('auth.emailChange.idleTitle')} intro={t('auth.emailChange.idleIntro')} />
          {footer}
        </View>
      );
    case 'confirming':
      return (
        <View style={styles.column} testID="email-change-confirming">
          <AuthHeader
            title={t('auth.emailChange.confirmingTitle')}
            intro={t('auth.emailChange.confirmingIntro')}
          />
        </View>
      );
    case 'confirmed':
      return (
        <View style={styles.column} testID="email-change-confirmed">
          <SuccessHeader
            title={t('auth.emailChange.confirmedTitle')}
            intro={t('auth.emailChange.confirmedIntro')}
          />
          <Pill
            label={t('auth.emailChange.goToAccount')}
            size="lg"
            fullWidth
            onPress={() => navigate.leaveTo(EMAIL_SETTINGS)}
            testID="email-change-go-to-account"
          />
        </View>
      );
    case 'taken':
      return (
        <View style={styles.column} testID="email-change-taken">
          <AuthHeader title={t('auth.emailChange.takenTitle')} />
          <InlineAlert
            variant="warning"
            title={t('auth.emailChange.takenAlertTitle')}
            description={detail ?? t('auth.emailChange.takenFallback')}
            politeness="off"
          />
          <ExplainCard>
            <Body>{t('auth.emailChange.takenExplain')}</Body>
            <Body>{t('auth.emailChange.takenNotSpent')}</Body>
          </ExplainCard>
          {footer}
        </View>
      );
    case 'refused':
      return (
        <View style={styles.column} testID="email-change-refused">
          <AuthHeader title={t('auth.emailChange.refusedTitle')} />
          <InlineAlert
            variant="danger"
            title={failure?.title ?? t('auth.emailChange.refusedAlertTitle')}
            description={failure?.detail ?? detail ?? t('auth.emailChange.refusedFallback')}
            politeness="off"
          />
          <ExplainCard>
            <Body>{t('auth.emailChange.refusedExplain')}</Body>
          </ExplainCard>
          {footer}
        </View>
      );
  }
}

const styles = StyleSheet.create({
  column: { gap: spacing[6] },
});
