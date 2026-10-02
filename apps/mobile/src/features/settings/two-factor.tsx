import { useEffect, useReducer, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { fillNodes } from '@ideanest/messages/placeholders';
import {
  Body,
  Caption,
  Checkbox,
  Field,
  InlineAlert,
  PasswordInput,
  Pill,
  Subheading,
  TextInput,
  announce,
} from '../../components/ui';
import { focusOn } from '../../components/ui/overlay';
import { describeAuthFailure } from '../../lib/auth-failures';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { colors, fontSize, lineHeight, radius, spacing } from '../../theme';
import { FormErrorSummary } from '../auth/form-error-summary';
import { AuthenticatorQr } from './authenticator-qr';
import {
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  startTwoFactorEnrolment,
  type TwoFactorEnrolment,
} from './two-factor-api';
import {
  INITIAL_TWO_FACTOR,
  canFinish,
  isAlreadyEnabled,
  twoFactorReducer,
  type TwoFactorNotice,
  type TwoFactorStep,
} from './two-factor-flow';
import { SettingsCard, Strong } from './settings-page';

/**
 * The two-factor card of `settings/security` — the web's `TwoFactorPanel` (#161), one step at a
 * time (`two-factor-flow.ts`), with what only a phone adds to the scan step: opening the
 * authenticator on this phone, a QR code for one on another device, and a Copy button for the key.
 *
 * <p>`GET /v1/me` cannot say whether two-factor is on, so idle offers both "Set it up" and "Turn
 * it off", exactly as the web does; the service's refusal of the first is what moves the reader to
 * the second.
 */
export function TwoFactorCard() {
  const t = useT('settings.panels.twoFactor');
  const tAll = useT();
  const online = useOnline();
  const [state, dispatch] = useReducer(twoFactorReducer, INITIAL_TWO_FACTOR);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const heading = useRef<View>(null);
  const inFlight = useRef(false);
  const { step, busy } = state;

  /*
   * On every step change: the one-time fields start empty, and screen-reader focus moves to the
   * new step's heading — otherwise a reader who pressed a button is left on a control that is no
   * longer there. Not on mount, where nobody asked for focus.
   */
  useEffect(() => {
    if (state.moves === 0) return;
    setCode('');
    setRecoveryCode('');
    focusOn(heading.current);
  }, [state.moves]);

  async function attempt(request: () => Promise<void>, onRefusal?: (cause: unknown) => boolean) {
    if (inFlight.current || !online) return;
    inFlight.current = true;
    dispatch({ type: 'submitted' });
    try {
      await request();
    } catch (cause) {
      if (onRefusal?.(cause) !== true) {
        dispatch({ type: 'refused', failure: describeAuthFailure(cause, tAll) });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function begin(): void {
    if (password === '') return;
    void attempt(
      async () => {
        const enrolment = await startTwoFactorEnrolment(password);
        setPassword('');
        dispatch({ type: 'enrolled', enrolment });
      },
      (cause) => {
        if (!isAlreadyEnabled(cause)) return false;
        // The password just proved is the one the off-path asks for, so it stays in the field.
        dispatch({ type: 'alreadyEnabled' });
        return true;
      },
    );
  }

  function confirm(): void {
    const typed = code.trim();
    if (typed === '') return;
    void attempt(async () => {
      const codes = await confirmTwoFactorEnrolment(typed);
      dispatch({ type: 'confirmed', codes });
    });
  }

  function turnOff(): void {
    const typedCode = code.trim();
    const typedRecovery = recoveryCode.trim();
    if (password === '' || (typedCode === '' && typedRecovery === '')) return;
    void attempt(async () => {
      await disableTwoFactor(
        password,
        typedRecovery === ''
          ? { kind: 'code', code: typedCode }
          : { kind: 'recovery-code', recoveryCode: typedRecovery },
      );
      setPassword('');
      dispatch({ type: 'disabled' });
    });
  }

  function cancel(): void {
    setPassword('');
    dispatch({ type: 'cancel' });
  }

  const cancelPill = (
    <Pill
      label={t('cancel')}
      variant="ghost"
      onPress={cancel}
      disabled={busy}
      testID="two-factor-cancel"
    />
  );

  return (
    <SettingsCard testID="two-factor">
      <View ref={heading} accessible accessibilityRole="header" testID="two-factor-heading">
        <Subheading>{t(headingKey(step))}</Subheading>
      </View>

      {state.notice !== null && step.kind !== 'codes' ? (
        <InlineAlert
          variant="info"
          politeness="polite"
          title={t('fromService')}
          description={t(noticeKey(state.notice))}
          onDismiss={() => dispatch({ type: 'dismissNotice' })}
          testID="two-factor-notice"
        />
      ) : null}

      <FormErrorSummary failure={state.failure} testID="two-factor-failure" />

      {step.kind === 'idle' ? (
        <View style={styles.step}>
          <Body>
            {fillNodes(String(t.raw('intro')), {
              emphasis: <Strong>{t('introEmphasis')}</Strong>,
            })}
          </Body>
          <View style={styles.actions}>
            <Pill
              label={t('setUp')}
              onPress={() => dispatch({ type: 'setUp' })}
              testID="two-factor-set-up"
            />
            <Pill
              label={t('turnOff')}
              variant="ghost"
              onPress={() => dispatch({ type: 'turnOff' })}
              testID="two-factor-turn-off"
            />
          </View>
          <Caption>{t('bothOffered')}</Caption>
        </View>
      ) : null}

      {step.kind === 'password' ? (
        <View style={styles.step}>
          <Body>{t('passwordIntro')}</Body>
          <Field label={t('currentPassword')} required>
            <PasswordInput
              value={password}
              onChangeText={setPassword}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={begin}
              disabled={busy}
              testID="two-factor-password"
            />
          </Field>
          <View style={styles.actions}>
            <Pill
              label={busy ? t('checking') : t('continue')}
              busy={busy}
              disabled={!online || password === ''}
              onPress={begin}
              testID="two-factor-continue"
            />
            {cancelPill}
          </View>
        </View>
      ) : null}

      {step.kind === 'scan' ? (
        <View style={styles.step}>
          <Body>
            {fillNodes(String(t.raw('scanIntro')), {
              emphasis: <Strong>{t('scanIntroEmphasis')}</Strong>,
            })}
          </Body>
          <EnrolmentDetails enrolment={step.enrolment} />
          <Field label={t('codeLabel')} required>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={16}
              placeholder={t('codePlaceholder')}
              returnKeyType="go"
              onSubmitEditing={confirm}
              disabled={busy}
              testID="two-factor-code"
            />
          </Field>
          <View style={styles.actions}>
            <Pill
              label={busy ? t('confirming') : t('switchOn')}
              busy={busy}
              disabled={!online || code.trim() === ''}
              onPress={confirm}
              testID="two-factor-switch-on"
            />
            {cancelPill}
          </View>
        </View>
      ) : null}

      {step.kind === 'codes' ? (
        <View style={styles.step}>
          <InlineAlert
            variant="warning"
            title={t('codesWarningTitle')}
            description={t('codesWarningBody')}
          />
          <View style={[styles.panel, styles.codes]} testID="two-factor-codes">
            {step.codes.map((recovery) => (
              <Text key={recovery} selectable style={[styles.mono, styles.code]}>
                {recovery}
              </Text>
            ))}
          </View>
          <CopyButton
            text={step.codes.join('\n')}
            label={tAll('mobile.settings.security.copyAll')}
            accessibilityLabel={tAll('mobile.settings.security.copyCodes')}
            copiedAnnouncement={tAll('mobile.settings.security.codesCopied')}
            testID="two-factor-copy-codes"
          />
          {/* The only way off this step: there is no endpoint that shows the codes again. */}
          <Checkbox
            label={t('acknowledge')}
            checked={step.acknowledged}
            onChange={(acknowledged) => dispatch({ type: 'acknowledge', acknowledged })}
            testID="two-factor-acknowledge"
          />
          <View style={styles.actions}>
            <Pill
              label={t('done')}
              disabled={!canFinish(state)}
              onPress={() => dispatch({ type: 'done' })}
              testID="two-factor-done"
            />
          </View>
        </View>
      ) : null}

      {step.kind === 'disable' ? (
        <View style={styles.step}>
          <Body>
            {fillNodes(String(t.raw('disableIntro')), {
              emphasis: <Strong>{t('disableIntroEmphasis')}</Strong>,
            })}
          </Body>
          <Field label={t('currentPassword')} required>
            <PasswordInput
              value={password}
              onChangeText={setPassword}
              autoComplete="current-password"
              textContentType="password"
              disabled={busy}
              testID="two-factor-disable-password"
            />
          </Field>
          <Field label={t('codeLabel')}>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={16}
              placeholder={t('codePlaceholder')}
              disabled={busy}
              testID="two-factor-disable-code"
            />
          </Field>
          <Field label={t('recoveryLabel')} hint={t('recoveryHint')}>
            <TextInput
              value={recoveryCode}
              onChangeText={setRecoveryCode}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              disabled={busy}
              testID="two-factor-recovery"
            />
          </Field>
          <View style={styles.actions}>
            <Pill
              label={busy ? t('turningOff') : t('turnOff')}
              variant="danger"
              busy={busy}
              disabled={
                !online || password === '' || (code.trim() === '' && recoveryCode.trim() === '')
              }
              onPress={turnOff}
              testID="two-factor-disable-submit"
            />
            {cancelPill}
          </View>
        </View>
      ) : null}
    </SettingsCard>
  );
}

/**
 * The scan step's three ways to the same secret: the authenticator on this phone, a QR code for
 * one elsewhere, and the key by hand.
 */
function EnrolmentDetails({ enrolment }: { readonly enrolment: TwoFactorEnrolment }) {
  const t = useT('settings.panels.twoFactor');
  const tAll = useT();
  const [canOpen, setCanOpen] = useState<boolean | null>(null);

  // Asked up front, so a phone with no authenticator is not offered a button that does nothing.
  useEffect(() => {
    let live = true;
    Linking.canOpenURL(enrolment.otpauthUri).then(
      (answer) => {
        if (live) setCanOpen(answer);
      },
      () => {
        if (live) setCanOpen(false);
      },
    );
    return () => {
      live = false;
    };
  }, [enrolment.otpauthUri]);

  async function open(): Promise<void> {
    try {
      await Linking.openURL(enrolment.otpauthUri);
    } catch {
      setCanOpen(false);
    }
  }

  return (
    <View style={[styles.panel, styles.details]}>
      <View style={styles.group}>
        <Caption>{t('onThisDevice')}</Caption>
        {canOpen === false ? (
          <Body testID="two-factor-no-authenticator">
            {tAll('mobile.settings.security.noAuthenticator')}
          </Body>
        ) : (
          <Pill
            label={t('openApp')}
            variant="outline"
            disabled={canOpen === null}
            onPress={() => void open()}
            testID="two-factor-open-app"
          />
        )}
      </View>

      <View style={styles.group}>
        <Caption>{tAll('mobile.settings.security.scanElsewhere')}</Caption>
        <AuthenticatorQr
          uri={enrolment.otpauthUri}
          label={tAll('mobile.settings.security.qrLabel')}
          testID="two-factor-qr"
        />
      </View>

      <View style={styles.group}>
        <Caption>{t('byHand')}</Caption>
        <Text selectable style={styles.mono} testID="two-factor-secret">
          {enrolment.secret}
        </Text>
        <Caption>
          {t('parameters', {
            digits: enrolment.digits,
            seconds: enrolment.periodSeconds,
            algorithm: enrolment.algorithm,
          })}
        </Caption>
        <CopyButton
          text={enrolment.secret}
          label={tAll('mobile.settings.security.copy')}
          accessibilityLabel={tAll('mobile.settings.security.copyKey')}
          copiedAnnouncement={tAll('mobile.settings.security.keyCopied')}
          testID="two-factor-copy-key"
        />
      </View>
    </View>
  );
}

/** A Copy pill that says "Copied" once it has, and says so to a screen reader too. */
function CopyButton({
  text,
  label,
  accessibilityLabel,
  copiedAnnouncement,
  testID,
}: {
  readonly text: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly copiedAnnouncement: string;
  readonly testID?: string;
}) {
  const tAll = useT();
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(): Promise<void> {
    let copied = false;
    try {
      copied = await Clipboard.setStringAsync(text);
    } catch {
      copied = false;
    }
    setOutcome(copied ? 'copied' : 'failed');
    if (copied) announce(copiedAnnouncement);
  }

  return (
    <View style={styles.group}>
      <View style={styles.actions}>
        <Pill
          label={outcome === 'copied' ? tAll('mobile.settings.security.copied') : label}
          accessibilityLabel={accessibilityLabel}
          variant="outline"
          size="sm"
          onPress={() => void copy()}
          testID={testID}
        />
      </View>
      {outcome === 'failed' ? (
        <Body accessibilityRole="alert" tone="primary">
          {tAll('mobile.settings.security.copyFailed')}
        </Body>
      ) : null}
    </View>
  );
}

function headingKey(step: TwoFactorStep) {
  switch (step.kind) {
    case 'idle':
      return 'heading' as const;
    case 'password':
      return 'passwordHeading' as const;
    case 'scan':
      return 'scanHeading' as const;
    case 'codes':
      return 'codesHeading' as const;
    case 'disable':
      return 'disableHeading' as const;
  }
}

function noticeKey(notice: TwoFactorNotice) {
  switch (notice) {
    case 'enabled':
      return 'enabledNotice' as const;
    case 'disabled':
      return 'disabledNotice' as const;
    case 'alreadyEnabled':
      return 'alreadyEnabled' as const;
  }
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  step: { gap: spacing[5] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  panel: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing[5],
  },
  details: { gap: spacing[6] },
  group: { gap: spacing[2] },
  codes: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[2] },
  code: { width: '50%' },
  mono: {
    fontFamily: MONO,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
});
