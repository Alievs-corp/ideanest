import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { fillNodes } from '@ideanest/messages/placeholders';
import { Glyphs } from '../../icons';
import {
  Body,
  Field,
  Icon,
  InlineAlert,
  PasswordInput,
  Pill,
  TextInput,
  TONES,
  useSurface,
} from '../../components/ui';
import { useMe } from '../../lib/account';
import {
  describeAuthFailure,
  fieldErrorsOf,
  refusalDetailOf,
  refusalOf,
  type AuthFailure,
} from '../../lib/auth-failures';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { FormErrorSummary } from '../auth/form-error-summary';
import { requestEmailChange } from './api';
import { InlineLink, SettingsCard, SettingsPage, Strong } from './settings-page';

/**
 * `settings/email` — the web's `EmailChangePanel` (#161). The success state says what was sent and
 * never that the address changed: the account moves only when the new address opens its link.
 */
export function EmailSettingsScreen() {
  const t = useT('settings.pages.email');
  return (
    <SettingsPage
      section="email"
      title={t('title')}
      intro={t.rich('intro', {
        password: (chunks) => <InlineLink href="/settings/password">{chunks}</InlineLink>,
      })}
    >
      <EmailChange />
    </SettingsPage>
  );
}

function EmailChange() {
  const t = useT('settings.panels.emailChange');
  const tAll = useT();
  const surface = useSurface();
  const online = useOnline();
  const me = useMe().data ?? null;
  const emailField = useRef<RNTextInput>(null);
  const inFlight = useRef(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [requestedFor, setRequestedFor] = useState<string | null>(null);

  const current = me?.email ?? null;

  async function submit(): Promise<void> {
    if (inFlight.current || !online || currentPassword === '' || newEmail.trim() === '') return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    const address = newEmail.trim();
    try {
      await requestEmailChange({ currentPassword, newEmail: address });
      setCurrentPassword('');
      setNewEmail('');
      setRequestedFor(address);
    } catch (cause) {
      const refusal = refusalOf(cause);
      const detail = refusalDetailOf(cause);
      setFailure(describeAuthFailure(cause, tAll));
      setFieldErrors({
        ...(refusal === 'incorrect-password' && detail !== null ? { currentPassword: detail } : {}),
        ...(refusal === 'email-already-in-use' && detail !== null ? { newEmail: detail } : {}),
        ...fieldErrorsOf(cause),
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title={t('heading')}
      intro={
        current === null
          ? undefined
          : fillNodes(String(t.raw(me?.emailVerified === false ? 'signInWithUnverified' : 'signInWith')), {
              address: <Strong>{current}</Strong>,
            })
      }
      testID="email-change"
    >
      {requestedFor !== null ? (
        <View style={styles.sent} testID="email-change-sent">
          <View style={styles.sentCard}>
            <Icon icon={Glyphs.SmsTracking} size={20} color={TONES[surface].tertiary} />
            <View style={styles.sentWords} accessible>
              <Body>{fillNodes(String(t.raw('sentIntro')), { address: <Strong>{requestedFor}</Strong> })}</Body>
              <Body>
                <Strong>{t('nothingChanged')}</Strong>{' '}
                {current === null
                  ? t('stillSignInUnknown')
                  : t('stillSignIn', { address: current })}
              </Body>
              <Body>{t('alsoWrote')}</Body>
            </View>
          </View>
          <Pill
            label={t('askDifferent')}
            variant="ghost"
            onPress={() => setRequestedFor(null)}
            testID="email-change-again"
          />
        </View>
      ) : (
        <View style={styles.form}>
          <FormErrorSummary failure={failure} testID="email-change-failure" />
          <InlineAlert variant="info" title={t('alertTitle')} description={t('alertBody')} />
          <Field
            label={t('currentPassword')}
            hint={t('currentPasswordHint')}
            error={fieldErrors.currentPassword}
            required
          >
            <PasswordInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="next"
              onSubmitEditing={() => emailField.current?.focus()}
              disabled={busy}
              testID="email-change-password"
            />
          </Field>
          <Field label={t('newEmail')} error={fieldErrors.newEmail} required>
            <TextInput
              ref={emailField}
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={tAll('auth.fields.emailPlaceholder')}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              disabled={busy}
              testID="email-change-address"
            />
          </Field>
          <Pill
            label={busy ? t('submitting') : t('submit')}
            busy={busy}
            disabled={!online || currentPassword === '' || newEmail.trim() === ''}
            onPress={() => void submit()}
            testID="email-change-submit"
          />
        </View>
      )}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[5] },
  sent: { gap: spacing[5], alignItems: 'flex-start' },
  sentCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  sentWords: { flex: 1, minWidth: 0, gap: spacing[3] },
});
