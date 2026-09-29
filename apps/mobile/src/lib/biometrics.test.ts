import * as LocalAuthentication from 'expo-local-authentication';
import { biometricCapability, canLock, unlock } from './biometrics';

/**
 * What the device can do, and what the account screen is therefore allowed to
 * offer — issue #29.
 *
 * <p>The distinction worth testing is between "cannot" and "not yet". A phone
 * with a scanner and nothing enrolled is the case where the honest answer sends
 * somebody to their own settings, and where offering the switch would create a
 * keychain entry nobody can ever read.
 */

const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: {
    hardware?: boolean;
    enrolled?: boolean;
    kinds?: number[];
    succeeds?: boolean;
  }) => void;
  __reset: () => void;
};

beforeEach(() => {
  biometrics.__reset();
});

describe('what this device can do', () => {
  it('is unavailable with no scanner', async () => {
    biometrics.__setBiometrics({ hardware: false });

    const capability = await biometricCapability();

    expect(capability).toBe('unavailable');
    expect(canLock(capability)).toBe(false);
  });

  it('is not-enrolled with a scanner and nothing enrolled', async () => {
    biometrics.__setBiometrics({ enrolled: false });

    const capability = await biometricCapability();

    // Actionable, unlike "unavailable": there is something the reader can do,
    // and it is not in this application.
    expect(capability).toBe('not-enrolled');
    expect(canLock(capability)).toBe(false);
  });

  it('prefers the face when the device has both', async () => {
    biometrics.__setBiometrics({
      kinds: [
        LocalAuthentication.AuthenticationType.FINGERPRINT,
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      ],
    });

    // The label is what the reader is about to see, and a phone that can do both
    // shows the face prompt. "Use fingerprint" over a Face ID sheet is a
    // sentence about the wrong second.
    expect(await biometricCapability()).toBe('face');
  });

  it('names an iris scanner as neither of the two it can label', async () => {
    biometrics.__setBiometrics({ kinds: [LocalAuthentication.AuthenticationType.IRIS] });

    const capability = await biometricCapability();

    expect(capability).toBe('other');
    expect(canLock(capability)).toBe(true);
  });
});

describe('the prompt', () => {
  it('reports success and refusal as a boolean', async () => {
    expect(await unlock('Unlock IdeyaNest')).toBe(true);

    biometrics.__setBiometrics({ succeeds: false });
    expect(await unlock('Unlock IdeyaNest')).toBe(false);
  });
});
