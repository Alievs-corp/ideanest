import * as LocalAuthentication from 'expo-local-authentication';
import { biometricCapability, biometricsUsable, unlock } from './biometrics';

/**
 * What the device can do, and what the account screen is therefore allowed to
 * offer — §4.12 MB-03.
 *
 * <p>The distinction worth testing is between "cannot" and "not yet". A phone
 * with a scanner and nothing enrolled is the case where the honest answer sends
 * somebody to their own settings; until then the lock opens with the PIN alone.
 */

const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: {
    hardware?: boolean;
    enrolled?: boolean;
    kinds?: number[];
    succeeds?: boolean;
    level?: number;
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
    expect(biometricsUsable(capability)).toBe(false);
  });

  it('is not-enrolled with a scanner and nothing enrolled', async () => {
    biometrics.__setBiometrics({ enrolled: false });

    const capability = await biometricCapability();

    // Actionable, unlike "unavailable": there is something the reader can do,
    // and it is not in this application.
    expect(capability).toBe('not-enrolled');
    expect(biometricsUsable(capability)).toBe(false);
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
    expect(biometricsUsable(capability)).toBe(true);
  });
});

describe('#319 review: strong biometrics only', () => {
  it('treats a phone whose only enrolment is weak (a 2D face unlock) as PIN-only', async () => {
    biometrics.__setBiometrics({
      kinds: [LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION],
      level: LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK,
    });
    const capability = await biometricCapability();
    expect(capability).toBe('weak');
    expect(biometricsUsable(capability)).toBe(false);
  });

  it('asks the prompt for class 3 only', async () => {
    const spy = jest.spyOn(LocalAuthentication, 'authenticateAsync');
    await unlock('Unlock IdeyaNest');
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ biometricsSecurityLevel: 'strong' });
    spy.mockRestore();
  });
});

describe('the prompt', () => {
  it('reports success and refusal as a boolean', async () => {
    expect(await unlock('Unlock IdeyaNest')).toBe(true);

    biometrics.__setBiometrics({ succeeds: false });
    expect(await unlock('Unlock IdeyaNest')).toBe(false);
  });

  it('offers the app PIN, not the device passcode, as its other button (#319)', async () => {
    const spy = jest.spyOn(LocalAuthentication, 'authenticateAsync');
    await unlock('Unlock IdeyaNest');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      promptMessage: 'Unlock IdeyaNest',
      disableDeviceFallback: true,
    });
    spy.mockRestore();
  });

  it('says nothing is usable before the probe answers', () => {
    expect(biometricsUsable(null)).toBe(false);
  });
});
