import * as LocalAuthentication from 'expo-local-authentication';
import { translate } from './i18n';

/**
 * The device's own answer to "is the owner here?" — §4.12 MB-03, issue #319.
 *
 * <h2>This is a LOCAL GATE, and it is not an authentication factor</h2>
 *
 * Face ID succeeding proves that whoever is holding the phone can unlock the phone. It proves
 * nothing to the service, which never hears about it: the refresh token in `lib/session.ts` is
 * what authenticates. Treating a successful prompt as a second factor would be a mistake that is
 * hard to undo — the platform's real second factor is §17.1's TOTP, which the service verifies,
 * and `lib/auth.ts` carries the challenge for it.
 *
 * The practical consequence is the shape of every function here: none of them returns a
 * credential, a token or a claim. They return whether the operating system said yes, and the
 * caller decides what to do about it.
 *
 * <h2>One of two ways through the app lock</h2>
 *
 * Since #319 the lock is a gate in front of the interface (`lib/app-lock.ts`), and this prompt is
 * one way through it; the six-digit PIN (`lib/pin.ts`) is the other, and it always exists while
 * the lock is on. The prompt used to be the keychain's own — the refresh token was stored with
 * `requireAuthentication` — which is what made it appear twice at every launch and at every token
 * refresh, with nothing to fall back on when the sensor refused. `lib/session.ts` has that
 * history; what remains of it here is that the gate calls {@link unlock} exactly once per locking,
 * and a refusal lands on the PIN pad instead of on a second prompt.
 *
 * <p>{@link biometricCapability} still tells the interface the truth before anybody commits to
 * it: which word to use ("fingerprint", "Face ID"), and whether the prompt can be offered at all.
 * A phone without biometrics can still have the lock — with the PIN alone.
 *
 * <h2>Why the failure reasons are not passed through</h2>
 *
 * `authenticateAsync` distinguishes `user_cancel`, `system_cancel`, `user_fallback`, `lockout`,
 * `not_enrolled` and more. Every one of them means the same thing to the gate — use the PIN — so
 * {@link unlock} answers a boolean, and the screens have one case rather than seven.
 */

/** What this device can actually do, as a screen needs to say it. */
export type BiometricCapability =
  /** There is no scanner. The lock cannot be offered at all. */
  | 'unavailable'
  /** There is a scanner and nothing enrolled. The lock is offerable once they enrol. */
  | 'not-enrolled'
  /** A fingerprint reader, and that is what the prompt will show. */
  | 'fingerprint'
  /** Face unlock. */
  | 'face'
  /**
   * Something is enrolled and it is neither of the two above — an iris scanner,
   * or a device whose passcode is the strongest thing enrolled.
   *
   * Worth its own value rather than being folded into `fingerprint`, because
   * the difference is a word in a label: a screen that says "Use fingerprint"
   * to somebody whose phone will show an iris prompt has told them something
   * false about the next second of their life.
   */
  | 'other';

/**
 * What the device can do, in one call.
 *
 * <p>The three questions are asked in the order that makes the answers
 * meaningful: hardware first, because {@code isEnrolledAsync} on a device with
 * no scanner is a question with no useful answer; enrolment second, because
 * that is the difference between "cannot" and "not yet"; and the kind last,
 * because it only matters once there is something to name.
 */
export async function biometricCapability(): Promise<BiometricCapability> {
  if (!(await LocalAuthentication.hasHardwareAsync())) return 'unavailable';
  if (!(await LocalAuthentication.isEnrolledAsync())) return 'not-enrolled';

  const kinds = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (kinds.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
  if (kinds.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  return 'other';
}

/**
 * Whether the biometric prompt can be offered: there is a scanner and something is enrolled. The
 * lock itself does not depend on it — without biometrics it opens with the PIN alone.
 */
export function biometricsUsable(capability: BiometricCapability | null): boolean {
  return capability !== null && capability !== 'unavailable' && capability !== 'not-enrolled';
}

/**
 * Asks the operating system whether the device owner is present. One call, one prompt.
 *
 * <p><strong>The device passcode is deliberately NOT the fallback</strong> —
 * `disableDeviceFallback` is on, and the prompt's other button says "Use PIN" (Android's
 * negative button, iOS's fallback after a failed match). The app's own PIN is the fallback the
 * owner chose (#319), and it has an attempt limit the device passcode does not have here; a
 * prompt that offered both would make the PIN pad the third way in rather than the second.
 *
 * @param reason shown in the system prompt, so it says why rather than merely appearing
 * @returns whether the prompt succeeded. Never throws: a native failure is a locked app, which is
 *     the same outcome as a refusal — the PIN pad
 */
export async function unlock(reason: string): Promise<boolean> {
  try {
    const usePin = translate()('mobile.lock.usePin');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: usePin,
      fallbackLabel: usePin,
      disableDeviceFallback: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
