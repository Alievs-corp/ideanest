import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { disableLock, enableLock } from '../../lib/session';
import { AppLockCard } from './app-lock';

/**
 * The app lock, moved from the Me tab into `settings/security` (#161) with its behaviour
 * unchanged: the capability decides what is offered, both directions go through the prompt, and
 * a refusal says nothing changed. `lib/session.test.ts` and `lib/biometrics.test.ts` own the
 * keychain and the probe; this is the card.
 */

let mockSession = { signedIn: true, locked: false, unlocked: true };
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../lib/session', () => ({
  ...jest.requireActual('../../lib/session'),
  enableLock: jest.fn(async () => true),
  disableLock: jest.fn(async () => true),
}));

const L = en.mobile.lock;
const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: { hardware?: boolean; enrolled?: boolean; kinds?: number[] }) => void;
  __reset: () => void;
  AuthenticationType: { FINGERPRINT: number; FACIAL_RECOGNITION: number };
};

async function show() {
  await render(
    <IntlProvider locale="en" messages={en}>
      <AppLockCard />
    </IntlProvider>,
  );
  // The capability probe answers asynchronously, as it does on a device.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  biometrics.__reset();
  mockSession = { signedIn: true, locked: false, unlocked: true };
  setOnline(true);
});

describe('the app lock card', () => {
  it('sits under "On this phone"', async () => {
    await show();
    expect(screen.getByRole('header', { name: en.mobile.settings.security.appLockTitle })).toBeTruthy();
  });

  it('names the switch for the scanner the phone has, off while the lock is off', async () => {
    await show();
    const lock = screen.getByRole('switch', { name: L.fingerprint });
    expect(lock.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText(L.keychain)).toBeTruthy();
  });

  it('says Face ID on a phone with a face scanner', async () => {
    biometrics.__setBiometrics({ kinds: [biometrics.AuthenticationType.FACIAL_RECOGNITION] });
    await show();
    expect(screen.getByRole('switch', { name: L.face })).toBeTruthy();
  });

  it('locked and not yet unlocked: on, and says the phone will ask', async () => {
    // Moved from the Me tab's "locked, prompt dismissed" case: the lock can still be turned off.
    mockSession = { signedIn: true, locked: true, unlocked: false };
    await show();

    // The kit's switch (issue #151): the whole row is one control, named by the lock's label and
    // saying it is on — not React Native's platform switch beside a separate line of text.
    const lock = screen.getByRole('switch', { name: L.fingerprint });
    expect(lock.props.accessibilityState).toMatchObject({ checked: true });
    expect(lock).toContainElement(screen.getByText(L.fingerprint));
    expect(screen.getByText(L.armed)).toBeTruthy();
  });

  it('locked and unlocked in this session: says the session is open', async () => {
    mockSession = { signedIn: true, locked: true, unlocked: true };
    await show();
    expect(screen.getByText(L.open)).toBeTruthy();
  });

  it('offers no switch on a phone with nothing enrolled, and says where to enrol', async () => {
    biometrics.__setBiometrics({ enrolled: false });
    await show();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(L.notEnrolled)).toBeTruthy();
    expect(screen.getByText(L.enrol)).toBeTruthy();
  });

  it('offers no switch on a phone with no scanner', async () => {
    biometrics.__setBiometrics({ hardware: false });
    await show();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(L.unavailable)).toBeTruthy();
  });

  it('turns the lock on through the keychain', async () => {
    await show();
    await fireEvent.press(screen.getByRole('switch', { name: L.fingerprint }));
    await act(async () => {});
    expect(enableLock).toHaveBeenCalledTimes(1);
    expect(disableLock).not.toHaveBeenCalled();
    expect(screen.queryByText(L.refused)).toBeNull();
  });

  it('says nothing changed when the device does not confirm it was you, turning it on', async () => {
    jest.mocked(enableLock).mockResolvedValueOnce(false);
    await show();
    await fireEvent.press(screen.getByRole('switch', { name: L.fingerprint }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent(L.refused);
  });

  it('turning it off still needs the prompt, and a refusal says nothing changed', async () => {
    mockSession = { signedIn: true, locked: true, unlocked: false };
    jest.mocked(disableLock).mockResolvedValueOnce(false);
    await show();
    await fireEvent.press(screen.getByRole('switch', { name: L.fingerprint }));
    await act(async () => {});
    expect(disableLock).toHaveBeenCalledTimes(1);
    expect(enableLock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(L.refused);
  });

  it('works offline: the lock is this phone’s, not the account’s', async () => {
    setOnline(false);
    await show();
    const lock = screen.getByRole('switch', { name: L.fingerprint });
    expect(lock.props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(lock);
    await act(async () => {});
    expect(enableLock).toHaveBeenCalledTimes(1);
  });
});
