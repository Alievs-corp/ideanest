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
import { useBiometricsInUse } from '../../lib/app-lock';
import { biometricsUsable, type BiometricCapability } from '../../lib/biometrics';
import { useT, type MessageKey } from '../../lib/i18n';
import { savePin } from '../../lib/pin';
import { disableLock, enableLock, setBiometricsAllowed } from '../../lib/session';
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
 *   <li><strong>Unlock with fingerprint</strong> (or face), while on and only where the phone
 *       has strong biometrics: on by default. Off keeps the lock and the PIN and never shows the
 *       prompt — the owner's choice, without deleting fingerprints from the phone. Turning it
 *       back on takes the current PIN, and only the PIN: a prompt could be passed by another
 *       finger enrolled on the phone, which is what switching it off may have been about.
 *       Turning it off needs nothing, because it only takes a way in away.</li>
 * </ul>
 *
 * <p>Every phone can have the lock. Biometrics are the quick way through it where the phone has
 * them; a phone without them — or with nothing enrolled — has a PIN-only lock, and the line under
 * the switch says which. A property of this phone rather than of the account, so it needs no
 * connection and is never disabled offline.
 */
type Flow = 'enable' | 'disable' | 'change-verify' | 'change-new' | 'biometrics-on' | null;

export function AppLockCard() {
  const t = useT();
  const { locked } = useSession();
  const capability = useBiometricCapability();
  const biometricsOn = useBiometricsInUse();
  // The second switch: only with the lock on and a phone that can do strong biometrics.
  const offersBiometrics = locked && biometricsUsable(capability);
  const [flow, setFlow] = useState<Flow>(null);
  const [refused, setRefused] = useState(false);

  const close = () => setFlow(null);

  const toggleLock = (next: boolean) => {
    setRefused(false);
    setFlow(next ? 'enable' : 'disable');
  };

  // With the fingerprint/face turned off, the lock is a PIN lock, and says so.
  const pinLock = offersBiometrics && !biometricsOn;
  const label = t(pinLock ? 'mobile.lock.pinOnly' : lockLabelKey(capability));
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
      {offersBiometrics ? (
        <Switch
          label={t(biometricsSwitchKey(capability))}
          description={t(
            biometricsOn ? biometricsOnDetailKey(capability) : 'mobile.lock.biometrics.offDetail',
          )}
          value={biometricsOn}
          onValueChange={(next) => {
            if (next) setFlow('biometrics-on');
            else setBiometricsAllowed(false);
          }}
          disabled={flow !== null}
          testID="app-lock-biometrics-switch"
        />
      ) : null}
      {locked ? (
        <Pill
          label={t('mobile.settings.security.changePin')}
          onPress={() => setFlow('change-verify')}
          variant="ghost"
          iconLeft={Glyphs.Key}
          testID="app-lock-change-pin"
        />
      ) : null}
      {refused ? <Refused text={t('mobile.lock.noSession')} /> : null}

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
        {flow === 'biometrics-on' ? (
          // PIN only: the prompt stays off until the PIN has turned it on.
          <IdentityCheck
            intro={t(biometricsIntroKey(capability))}
            onConfirmed={() => {
              setBiometricsAllowed(true);
              close();
            }}
            testID="app-lock-confirm-biometrics"
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
 * Nothing changed — there was no session on this phone to lock. A `Warning2` and a sentence, as a field's error is drawn: `--danger` text is
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
    case 'weak':
      return 'mobile.lock.pinOnly';
    case null:
      return 'mobile.lock.checking';
  }
}

/** The fingerprint/face switch's name, in the words of what the phone has. */
export function biometricsSwitchKey(capability: BiometricCapability | null): MessageKey {
  if (capability === 'face') return 'mobile.lock.biometrics.face';
  if (capability === 'fingerprint') return 'mobile.lock.biometrics.fingerprint';
  return 'mobile.lock.biometrics.other';
}

/** The line under the switch while it is on, naming what the app asks for first. */
export function biometricsOnDetailKey(capability: BiometricCapability | null): MessageKey {
  if (capability === 'face') return 'mobile.lock.biometrics.onDetail.face';
  if (capability === 'fingerprint') return 'mobile.lock.biometrics.onDetail.fingerprint';
  return 'mobile.lock.biometrics.onDetail.other';
}

/** "Enter your PIN to turn on unlocking with …", in the words of what the phone has. */
export function biometricsIntroKey(capability: BiometricCapability | null): MessageKey {
  if (capability === 'face') return 'mobile.lock.confirm.biometricsOn.face';
  if (capability === 'fingerprint') return 'mobile.lock.confirm.biometricsOn.fingerprint';
  return 'mobile.lock.confirm.biometricsOn.other';
}

export function lockDetailKey(capability: BiometricCapability | null, locked: boolean): MessageKey {
  if (capability === null) return 'mobile.lock.wait';
  if (locked) return 'mobile.lock.on';
  if (capability === 'unavailable') return 'mobile.lock.noBiometrics';
  if (capability === 'not-enrolled') return 'mobile.lock.enrol';
  if (capability === 'weak') return 'mobile.lock.weakBiometrics';
  return biometricsUsable(capability) ? 'mobile.lock.offDetail' : 'mobile.lock.enrol';
}

const styles = StyleSheet.create({
  row: { gap: spacing[1], minHeight: size.touchTarget, justifyContent: 'center' },
  refused: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  refusedText: { flex: 1 },
});
