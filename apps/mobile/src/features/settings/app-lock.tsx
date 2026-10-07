import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Body,
  Icon,
  Meta,
  Pill,
  Sheet,
  Switch,
  TONES,
  announce,
  useSurface,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import { IdentityCheck, PinCreate, useBiometricCapability } from '../lock/pin-flow';
import { biometricsUsable, type BiometricCapability } from '../../lib/biometrics';
import { useT, type MessageKey } from '../../lib/i18n';
import { savePin } from '../../lib/pin';
import { disableLock, enableLock } from '../../lib/session';
import { useSession } from '../../lib/use-session';
import { colors, size, spacing } from '../../theme';
import { SettingsCard } from './settings-page';

/**
 * The app lock (§4.12 MB-03, issue #319), "On this phone" under two-factor in `settings/security`.
 *
 * <ul>
 *   <li><strong>On</strong> needs a PIN first: six digits, then the same six again, in a sheet.
 *       The lock is never on without one.</li>
 *   <li><strong>Off</strong> needs the owner: the biometric prompt (offered once on its own) or
 *       the current PIN, counted against the lock's five attempts.</li>
 *   <li><strong>Change PIN</strong>, while on: the same check, then a new PIN twice.</li>
 * </ul>
 *
 * <p>Every phone can have the lock. Biometrics are the quick way through it where the phone has
 * them; a phone without them — or with nothing enrolled — has a PIN-only lock, and the line under
 * the switch says which. A property of this phone rather than of the account, so it needs no
 * connection and is never disabled offline.
 */
type Flow = 'enable' | 'disable' | 'change-verify' | 'change-new' | null;

export function AppLockCard() {
  const t = useT();
  const { locked } = useSession();
  const capability = useBiometricCapability();
  const [flow, setFlow] = useState<Flow>(null);
  const [refused, setRefused] = useState(false);

  const close = () => setFlow(null);

  const toggleLock = (next: boolean) => {
    setRefused(false);
    setFlow(next ? 'enable' : 'disable');
  };

  const label = t(lockLabelKey(capability));
  const detail = t(lockDetailKey(capability, locked));

  return (
    <SettingsCard
      title={t('mobile.settings.security.appLockTitle')}
      intro={t('mobile.settings.security.appLockIntro')}
      testID="app-lock"
    >
      {capability === null ? (
        <View style={styles.row}>
          <Body tone="primary">{label}</Body>
          <Meta>{detail}</Meta>
        </View>
      ) : (
        /*
         * The whole row is the switch: label, the line under it, and the track are one control,
         * announced as "Require your fingerprint or PIN, switch, on" with the line as its hint.
         */
        <Switch
          label={label}
          description={detail}
          value={locked}
          onValueChange={toggleLock}
          disabled={flow !== null}
          testID="app-lock-switch"
        />
      )}
      {locked ? (
        <Pill
          label={t('mobile.settings.security.changePin')}
          onPress={() => setFlow('change-verify')}
          variant="ghost"
          iconLeft={Glyphs.Key}
          testID="app-lock-change-pin"
        />
      ) : null}
      {refused ? <Refused text={t('mobile.lock.refused')} /> : null}

      <Sheet
        visible={flow !== null}
        onClose={close}
        title={t('mobile.settings.security.appLockLink')}
        testID="app-lock-sheet"
      >
        {flow === 'enable' ? (
          <PinCreate
            onCreated={async (pin) => {
              const on = await enableLock(pin);
              if (!on) setRefused(true);
              else announce(t('mobile.lock.setPin.saved'));
              close();
            }}
            testID="app-lock-create"
          />
        ) : null}
        {flow === 'disable' ? (
          <IdentityCheck
            intro={t('mobile.lock.confirm.offIntro')}
            autoPrompt
            onConfirmed={() => {
              void disableLock().finally(close);
            }}
            testID="app-lock-confirm-off"
          />
        ) : null}
        {flow === 'change-verify' ? (
          <IdentityCheck
            intro={t('mobile.lock.confirm.changeIntro')}
            autoPrompt
            onConfirmed={() => setFlow('change-new')}
            testID="app-lock-confirm-change"
          />
        ) : null}
        {flow === 'change-new' ? (
          <PinCreate
            onCreated={async (pin) => {
              await savePin(pin);
              announce(t('mobile.settings.security.pinChanged'));
              close();
            }}
            testID="app-lock-new-pin"
          />
        ) : null}
      </Sheet>
    </SettingsCard>
  );
}

/**
 * Nothing changed. A `Warning2` and a sentence, as a field's error is drawn: `--danger` text is
 * under AA on the white sheet, so the words take the surface's primary ink and the icon the danger.
 */
function Refused({ text }: { readonly text: string }) {
  const surface = useSurface();
  return (
    <View style={styles.refused}>
      <Icon icon={Glyphs.Warning2} size={18} color={colors.danger} />
      <Body
        accessibilityRole="alert"
        style={[styles.refusedText, { color: TONES[surface].primary }]}
        testID="app-lock-refused"
      >
        {text}
      </Body>
    </View>
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
    case 'unavailable':
      return 'mobile.lock.pinOnly';
    case null:
      return 'mobile.lock.checking';
  }
}

export function lockDetailKey(capability: BiometricCapability | null, locked: boolean): MessageKey {
  if (capability === null) return 'mobile.lock.wait';
  if (locked) return 'mobile.lock.on';
  if (capability === 'unavailable') return 'mobile.lock.noBiometrics';
  if (capability === 'not-enrolled') return 'mobile.lock.enrol';
  return biometricsUsable(capability) ? 'mobile.lock.offDetail' : 'mobile.lock.enrol';
}

const styles = StyleSheet.create({
  row: { gap: spacing[1], minHeight: size.touchTarget, justifyContent: 'center' },
  refused: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  refusedText: { flex: 1 },
});
