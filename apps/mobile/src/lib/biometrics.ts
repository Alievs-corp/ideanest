import * as LocalAuthentication from 'expo-local-authentication';
import { translate } from './i18n';

/**
 * The device's own answer to "is the owner here?" — issue #29.
 *
 * <h2>This is a LOCAL GATE, and it is not an authentication factor</h2>
 *
 * Face ID succeeding proves that whoever is holding the phone can unlock the
 * phone. It proves nothing to the service, which never hears about it: the
 * refresh token in `lib/session.ts` is what authenticates, and biometry only
 * decides whether this application is allowed to read it back out. Treating a
 * successful prompt as a second factor would be a mistake that is hard to undo —
 * the platform's real second factor is §17.1's TOTP, which the service verifies,
 * and `lib/auth.ts` carries the challenge for it.
 *
 * The practical consequence is the shape of every function here: none of them
 * returns a credential, a token or a claim. They return whether the operating
 * system said yes, and the caller decides what to do about it.
 *
 * <h2>Two layers, and only one of them is this file</h2>
 *
 * The stronger gate is the keychain's own: `lib/session.ts` writes the refresh
 * token with `requireAuthentication`, so the operating system refuses to hand
 * the bytes over without a successful prompt whether or not this application
 * asks for one. That gate cannot be bypassed by anything running in JavaScript,
 * which is what makes it worth having.
 *
 * What this file adds is the part the keychain cannot do: **telling the truth
 * in the interface before anybody commits to it.** A settings screen offering
 * "require Face ID" on a device with no enrolled biometry would produce a
 * keychain item nobody can ever read, and the failure would arrive as a lost
 * session rather than as a refused setting. {@link biometricCapability} is what
 * that screen asks first.
 *
 * <h2>Why the failure reasons are not passed through</h2>
 *
 * `authenticateAsync` distinguishes `user_cancel`, `system_cancel`,
 * `app_cancel`, `lockout`, `not_enrolled` and more. Every one of them means the
 * same thing to the caller — the session stays locked — and the ones that differ
 * are already covered: {@link biometricCapability} answers "not enrolled" before
 * a prompt is ever shown, and a lockout is the platform telling somebody to use
 * their passcode, which the prompt itself offers. So {@link unlock} answers a
 * boolean, and the screens have one case rather than seven.
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

/** Whether the lock can be turned on at all right now. */
export function canLock(capability: BiometricCapability): boolean {
  return capability !== 'unavailable' && capability !== 'not-enrolled';
}

/**
 * Asks the operating system whether the device owner is present.
 *
 * <p><strong>The device passcode is deliberately allowed as a fallback</strong> —
 * `disableDeviceFallback` is left at its default of `false`. The alternative
 * locks somebody out of their own pledges because their finger is wet, and the
 * threat being defended against is a phone in somebody else's hand, which a
 * passcode answers just as well. It also matches what the keychain item does:
 * `requireAuthentication` on iOS accepts the passcode too, so refusing it here
 * would only make the in-app prompt stricter than the gate underneath it.
 *
 * @param reason shown in the system prompt, so it says why rather than merely
 *     appearing
 * @returns whether the prompt succeeded. Never throws: a native failure is a
 *     locked session, which is the same outcome as a refusal
 */
export async function unlock(reason: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // Not "Cancel". The button ends the attempt and leaves the session
      // locked, and a reader who has just been asked to prove they are present
      // reads "Cancel" as "cancel what?".
      cancelLabel: translate()('mobile.lock.stayLocked'),
    });
    return result.success;
  } catch {
    return false;
  }
}
