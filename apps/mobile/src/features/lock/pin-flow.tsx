import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce, haptics, type PinPadAction } from '../../components/ui';
import { Glyphs } from '../../icons';
import { attemptPin, confirmWithBiometrics } from '../../lib/app-lock';
import { biometricCapability, biometricsUsable, type BiometricCapability } from '../../lib/biometrics';
import { useT, type MessageKey } from '../../lib/i18n';
import { useEndLocalSession } from '../../lib/local-sign-out';
import { PinEntry } from './pin-entry';

/**
 * The two PIN conversations the app lock has (#319), shared by the lock screen and settings.
 *
 * - {@link PinCreate}: choose six digits, then the same six again. A mismatch says so and starts
 *   over; it never keeps the first entry to be confirmed against a guess.
 * - {@link IdentityCheck}: "confirm it's you" — the biometric prompt (offered once on its own when
 *   asked to) or the current PIN, counted against the same five attempts as the lock screen.
 */

/** The phone's biometric capability, asked once per mount. `null` until it answers. */
export function useBiometricCapability(): BiometricCapability | null {
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  useEffect(() => {
    let live = true;
    void biometricCapability().then((answer) => {
      if (live) setCapability(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return capability;
}

/** "Use fingerprint" / "Use Face ID", in the words of what the phone has. */
export function biometricLabelKey(capability: BiometricCapability | null): MessageKey {
  if (capability === 'face') return 'mobile.lock.screen.useFace';
  if (capability === 'fingerprint') return 'mobile.lock.screen.useFingerprint';
  return 'mobile.lock.screen.useOther';
}

/** The pad's action key for the prompt, or null on a phone that cannot show one. */
export function biometricAction(
  capability: BiometricCapability | null,
  label: string,
  onPress: () => void,
): PinPadAction | null {
  if (!biometricsUsable(capability)) return null;
  return {
    label,
    icon: capability === 'fingerprint' ? Glyphs.FingerScan : Glyphs.Scan,
    onPress,
  };
}

export function PinCreate({
  intro,
  onCreated,
  footer = null,
  testID = 'pin-create',
}: {
  readonly intro?: string | null;
  /** The confirmed PIN. A throw is reported as "could not be saved" and the flow starts over. */
  readonly onCreated: (pin: string) => Promise<void>;
  readonly footer?: ReactNode;
  readonly testID?: string;
}) {
  const t = useT('mobile.lock');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refuse = (message: string) => {
    haptics.pinRefused();
    setError(message);
    announce(message, { assertive: true });
  };

  const complete = async (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return;
    }
    setFirst(null);
    if (pin !== first) {
      refuse(t('setPin.mismatch'));
      return;
    }
    try {
      await onCreated(pin);
    } catch {
      refuse(t('setPin.failed'));
    }
  };

  return (
    <PinEntry
      key={first === null ? 'first' : 'confirm'}
      title={first === null ? t('setPin.title') : t('setPin.confirmTitle')}
      intro={first === null ? (intro ?? t('setPin.intro')) : null}
      error={error}
      busyLabel={t('screen.checkingPin')}
      onComplete={complete}
      footer={footer}
      testID={`${testID}-${first === null ? 'first' : 'confirm'}`}
    />
  );
}

export function IdentityCheck({
  intro,
  onConfirmed,
  autoPrompt = false,
  testID = 'identity-check',
}: {
  readonly intro: string;
  readonly onConfirmed: () => void;
  /** Offer the biometric prompt once on its own, as soon as the phone says it can. */
  readonly autoPrompt?: boolean;
  readonly testID?: string;
}) {
  const t = useT('mobile.lock');
  const tAll = useT();
  const wipe = useEndLocalSession();
  const capability = useBiometricCapability();
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);

  const prompt = async () => {
    prompted.current = true;
    if (await confirmWithBiometrics(t('prompt'))) onConfirmed();
  };

  useEffect(() => {
    if (!autoPrompt || prompted.current || !biometricsUsable(capability)) return;
    void prompt();
    // `prompt` is this render's; the ref is what keeps it to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, capability]);

  const complete = async (pin: string) => {
    const attempt = await attemptPin(pin, wipe);
    if (attempt.kind === 'correct') {
      setError(null);
      onConfirmed();
      return;
    }
    if (attempt.kind === 'wrong') {
      const message = t('screen.wrong', { remaining: attempt.remaining });
      haptics.pinRefused();
      setError(message);
      announce(message, { assertive: true });
    }
    // Signed out: the lock gate says so (`lock-screen.tsx`); this screen's session is gone.
  };

  return (
    <PinEntry
      title={t('confirm.title')}
      intro={intro}
      error={error}
      busyLabel={t('screen.checkingPin')}
      onComplete={complete}
      action={biometricAction(capability, tAll(biometricLabelKey(capability)), () => void prompt())}
      testID={testID}
    />
  );
}
