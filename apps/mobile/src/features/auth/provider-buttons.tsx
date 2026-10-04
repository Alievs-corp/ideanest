import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Meta, useSurface } from '../../components/ui';
import type { ProviderId, SignInOutcome } from '../../lib/auth';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth-failures';
import { useT } from '../../lib/i18n';
import {
  configuredProviders,
  ProviderCancelled,
  signInWithApple,
  signInWithGoogle,
} from '../../lib/providers';
import { colors, radius, spacing, tint } from '../../theme';
import { FormErrorSummary } from './form-error-summary';
import { GoogleButton, PROVIDER_BUTTON_HEIGHT } from './provider-brand';

/**
 * The provider block under the sign-in and register forms — the web's `ProviderSignIn` (#152).
 *
 * <p>Absent entirely when the build configures no provider for this platform (`lib/providers.ts`),
 * so a phone never shows a button the service would refuse. Every answer goes to the form's own
 * `settle`, so a provider account with two-factor on reaches the same step a password does.
 *
 * <p>A closed sheet or browser says nothing, as the web says nothing for a closed popup. Anything
 * else is described exactly as a password refusal is.
 */
export function ProviderButtons({
  intent,
  onOutcome,
  disabled = false,
  onBusyChange,
}: {
  /** Only the wording changes: the service decides whether an account is created. */
  readonly intent: 'sign-in' | 'register';
  readonly onOutcome: (outcome: SignInOutcome) => Promise<void>;
  /**
   * The form's own request is in flight. The two paths block each other both ways: two sign-ins
   * settling would run `finish()` twice, and the second `back()` pops the screen underneath.
   */
  readonly disabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT();
  const [offered] = useState(() => configuredProviders());
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const inFlight = useRef(false);
  // In the auth screens' white sheet: a dark hairline, and Apple's black button instead of white.
  const onWhite = useSurface() === 'white';

  const wantsApple = offered.includes('apple');
  useEffect(() => {
    if (!wantsApple) return;
    let live = true;
    void AppleAuthentication.isAvailableAsync().then(
      (available) => {
        if (live) setAppleAvailable(available);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsApple]);

  const google = offered.includes('google');
  const apple = wantsApple && appleAvailable;
  if (!google && !apple) return null;

  const blocked = busy !== null || disabled;

  async function run(provider: ProviderId): Promise<void> {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(provider);
    onBusyChange?.(true);
    setFailure(null);
    try {
      await onOutcome(await (provider === 'google' ? signInWithGoogle() : signInWithApple()));
    } catch (cause) {
      if (!(cause instanceof ProviderCancelled)) setFailure(describeAuthFailure(cause, t));
    } finally {
      inFlight.current = false;
      setBusy(null);
      onBusyChange?.(false);
    }
  }

  const appleLabel =
    intent === 'register' ? t('auth.providers.appleRegister') : t('auth.providers.appleSignIn');

  return (
    <View style={styles.block} testID="provider-buttons">
      <View
        style={styles.separator}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('auth.providers.separatorLabel')}
      >
        <View style={[styles.rule, onWhite && styles.ruleOnWhite]} />
        <Meta>{t('auth.providers.or')}</Meta>
        <View style={[styles.rule, onWhite && styles.ruleOnWhite]} />
      </View>

      <FormErrorSummary failure={failure} testID="provider-failure" />

      {google ? (
        <GoogleButton
          label={
            intent === 'register' ? t('mobile.auth.googleRegister') : t('mobile.auth.googleSignIn')
          }
          busy={busy === 'google'}
          disabled={blocked}
          onPress={() => void run('google')}
        />
      ) : null}

      {apple ? (
        /*
         * Apple's own control, for its brand rules. It names itself in the PHONE's language, so
         * the wrapper names it in the app's, and the native button underneath is hidden from the
         * screen reader rather than read twice.
         */
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={appleLabel}
          accessibilityState={{ disabled: blocked, busy: busy === 'apple' }}
          onAccessibilityTap={() => void run('apple')}
          pointerEvents={blocked ? 'none' : 'auto'}
          style={blocked ? styles.dimmed : undefined}
          testID="provider-apple"
        >
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                intent === 'register'
                  ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                  : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
              }
              buttonStyle={
                onWhite
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              }
              cornerRadius={PROVIDER_BUTTON_HEIGHT / 2}
              style={styles.apple}
              onPress={() => void run('apple')}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[4] },
  separator: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rule: { flex: 1, height: 1, backgroundColor: colors.divider, borderRadius: radius.full },
  ruleOnWhite: { backgroundColor: tint(colors.black, 0.1) },
  apple: { width: '100%', height: PROVIDER_BUTTON_HEIGHT },
  dimmed: { opacity: 0.6 },
});
