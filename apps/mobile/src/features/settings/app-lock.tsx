import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Body, Meta, Switch } from '../../components/ui';
import { biometricCapability, canLock, type BiometricCapability } from '../../lib/biometrics';
import { useT, type MessageKey } from '../../lib/i18n';
import { disableLock, enableLock } from '../../lib/session';
import { useSession } from '../../lib/use-session';
import { colors, size, spacing } from '../../theme';
import { SettingsCard } from './settings-page';

/**
 * The biometric app lock (§4.12 MB-03), "On this phone" under two-factor in `settings/security`
 * (#161). Moved from the Me tab with its behaviour unchanged: the switch is offered only when the
 * device can honour it, both directions go through the prompt, and a refusal says nothing
 * changed.
 *
 * <p>A property of this phone rather than of the account, so it needs no connection and is never
 * disabled offline.
 */
export function AppLockCard() {
  const t = useT();
  const { locked, unlocked } = useSession();
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let live = true;
    void biometricCapability().then((answer) => {
      if (live) setCapability(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggleLock = useCallback(
    async (next: boolean): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setRefused(false);
      try {
        // Both directions can be refused, and for the same reason: turning the
        // lock off has to read the token, which is what presents the prompt.
        const moved = next ? await enableLock() : await disableLock();
        if (!moved) setRefused(true);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const label = t(lockLabelKey(capability));
  const detail = t(lockDetailKey(capability, locked, unlocked));

  return (
    <SettingsCard
      title={t('mobile.settings.security.appLockTitle')}
      intro={t('mobile.settings.security.appLockIntro')}
      testID="app-lock"
    >
      {capability !== null && canLock(capability) ? (
        /*
         * The whole row is the switch: label, the line under it, and the track are one
         * control, announced as "Require Face ID, switch, on" with the line as its hint.
         */
        <Switch
          label={label}
          description={detail}
          value={locked}
          onValueChange={(next) => void toggleLock(next)}
          disabled={busy}
          testID="app-lock-switch"
        />
      ) : (
        <View style={styles.row}>
          <Body tone="primary">{label}</Body>
          <Meta>{detail}</Meta>
        </View>
      )}
      {refused ? (
        <Body accessibilityRole="alert" style={styles.refused} testID="app-lock-refused">
          {t('mobile.lock.refused')}
        </Body>
      ) : null}
    </SettingsCard>
  );
}

/** What to call the control, in the words of whatever the device actually has. */
export function lockLabelKey(capability: BiometricCapability | null): MessageKey {
  switch (capability) {
    case 'face':
      return 'mobile.lock.face';
    case 'fingerprint':
      return 'mobile.lock.fingerprint';
    case 'other':
      return 'mobile.lock.other';
    case 'not-enrolled':
      return 'mobile.lock.notEnrolled';
    case 'unavailable':
      return 'mobile.lock.unavailable';
    case null:
      return 'mobile.lock.checking';
  }
}

export function lockDetailKey(
  capability: BiometricCapability | null,
  locked: boolean,
  unlocked: boolean,
): MessageKey {
  if (capability === null) return 'mobile.lock.wait';
  if (capability === 'unavailable') return 'mobile.lock.keychain';
  if (capability === 'not-enrolled') return 'mobile.lock.enrol';
  if (!locked) return 'mobile.lock.keychain';
  return unlocked ? 'mobile.lock.open' : 'mobile.lock.armed';
}

const styles = StyleSheet.create({
  row: { gap: spacing[1], minHeight: size.touchTarget, justifyContent: 'center' },
  refused: { color: colors.danger },
});
