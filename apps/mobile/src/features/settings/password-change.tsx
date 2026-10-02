import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import { Field, InlineAlert, PasswordInput, Pill } from '../../components/ui';
import {
  describeAuthFailure,
  fieldErrorsOf,
  refusalDetailOf,
  refusalOf,
  type AuthFailure,
} from '../../lib/auth-failures';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { useEndLocalSession } from '../../lib/local-sign-out';
import { spacing } from '../../theme';
import { FormErrorSummary } from '../auth/form-error-summary';
import { PASSWORD_CHANGED_NOTICE } from '../auth/sign-in-form';
import { changePassword } from './api';
import { InlineLink, SettingsCard, SettingsPage, useLeavingSettings } from './settings-page';

/**
 * `settings/password` — the web's `PasswordChangePanel` (#161). The service revokes every
 * session on success, this one included, so the phone forgets its own and lands on sign-in with
 * the password-changed notice.
 */
export function PasswordSettingsScreen() {
  const t = useT('settings.pages.password');
  return (
    <SettingsPage
      section="password"
      title={t('title')}
      intro={t.rich('intro', {
        reset: (chunks) => <InlineLink href="/reset-password">{chunks}</InlineLink>,
      })}
    >
      <PasswordChange />
    </SettingsPage>
  );
}

function PasswordChange() {
  const t = useT('settings.panels.passwordChange');
  const tAll = useT();
  const router = useRouter();
  const online = useOnline();
  const endLocalSession = useEndLocalSession();
  const leave = useLeavingSettings();
  const newField = useRef<RNTextInput>(null);
  const repeatField = useRef<RNTextInput>(null);
  const inFlight = useRef(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const complete = currentPassword !== '' && newPassword !== '' && repeated !== '';

  async function submit(): Promise<void> {
    if (inFlight.current || !online || !complete) return;
    if (newPassword !== repeated) {
      setFailure({ title: t('mismatchTitle'), detail: t('mismatchDetail'), retryable: true });
      setFieldErrors({ repeated: t('mismatchField') });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    try {
      await changePassword({ currentPassword, newPassword });
    } catch (cause) {
      const refusal = refusalOf(cause);
      const detail = refusalDetailOf(cause);
      setFailure(describeAuthFailure(cause, tAll));
      setFieldErrors({
        ...(refusal === 'incorrect-password' && detail !== null ? { currentPassword: detail } : {}),
        ...(refusal === 'weak-password' && detail !== null ? { newPassword: detail } : {}),
        ...fieldErrorsOf(cause),
      });
      inFlight.current = false;
      setBusy(false);
      return;
    }

    leave();
    try {
      await endLocalSession();
    } finally {
      router.replace({ pathname: '/sign-in', params: { notice: PASSWORD_CHANGED_NOTICE } });
    }
  }

  return (
    <SettingsCard title={t('heading')} testID="password-change">
      <View style={styles.form}>
        <FormErrorSummary failure={failure} testID="password-change-failure" />
        <InlineAlert
          variant="warning"
          title={t('alertTitle')}
          description={tAll('mobile.settings.password.alertBody')}
        />
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
            onSubmitEditing={() => newField.current?.focus()}
            disabled={busy}
            testID="password-change-current"
          />
        </Field>
        <Field
          label={t('newPassword')}
          hint={tAll('auth.fields.passwordHint')}
          error={fieldErrors.newPassword}
          required
        >
          <PasswordInput
            ref={newField}
            value={newPassword}
            onChangeText={setNewPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => repeatField.current?.focus()}
            disabled={busy}
            testID="password-change-new"
          />
        </Field>
        <Field
          label={t('repeat')}
          hint={tAll('mobile.settings.password.repeatHint')}
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
            testID="password-change-repeat"
          />
        </Field>
        <Pill
          label={busy ? t('submitting') : t('submit')}
          iconLeft={LogOut}
          busy={busy}
          disabled={!online || !complete}
          onPress={() => void submit()}
          testID="password-change-submit"
        />
      </View>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[5] },
});
