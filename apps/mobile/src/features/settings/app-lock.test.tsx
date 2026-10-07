import { type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { lockPhase, resetAppLockForTests } from '../../lib/app-lock';
import { setOnline } from '../../lib/connectivity';
import { checkPin, failedPinAttempts, hasPin } from '../../lib/pin';
import {
  enableLock,
  isLockOn,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { AppLockCard } from './app-lock';

/**
 * The app lock in `settings/security` (#161, #319): on needs a PIN set and confirmed first; off
 * and "Change PIN" need the owner — the prompt or the current PIN. `lib/app-lock.test.ts` owns the
 * gate; this is the card and its sheet.
 */

jest.mock('../../lib/push', () => ({ unregisterFromPush: jest.fn(async () => {}) }));

const L = en.mobile.lock;
const S = en.mobile.settings.security;
const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: {
    hardware?: boolean;
    enrolled?: boolean;
    kinds?: number[];
    succeeds?: boolean;
    level?: number;
  }) => void;
  __prompts: () => number;
  __reset: () => void;
  AuthenticationType: { FINGERPRINT: number; FACIAL_RECOGNITION: number };
};
const keychain = SecureStore as unknown as { __reset: () => void };

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await render(<AppLockCard />, { wrapper });
  await settle();
}

async function typePin(pin: string) {
  for (const digit of pin) {
    await fireEvent.press(screen.getByRole('keyboardkey', { name: digit }));
  }
  await settle();
}

const lockSwitch = (name: string = L.fingerprint) => screen.getByRole('switch', { name });

beforeEach(async () => {
  keychain.__reset();
  biometrics.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  resetAppLockForTests();
  setOnline(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  await storeRefreshToken('refresh-1');
  // The app's gate: open, as it is by the time somebody reaches settings.
  expect(lockPhase()).toBe('open');
});

afterEach(() => {
  client?.clear();
  jest.restoreAllMocks();
});

describe('the card', () => {
  it('sits under "On this phone", off, named for the scanner the phone has', async () => {
    await show();
    expect(screen.getByRole('header', { name: S.appLockTitle })).toBeTruthy();
    expect(lockSwitch().props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText(L.offDetail)).toBeTruthy();
    expect(screen.queryByRole('button', { name: S.changePin })).toBeNull();
  });

  it('says Face ID on a phone with a face scanner', async () => {
    biometrics.__setBiometrics({ kinds: [biometrics.AuthenticationType.FACIAL_RECOGNITION] });
    await show();
    expect(lockSwitch(L.face)).toBeTruthy();
  });

  it('offers a PIN-only lock on a phone with no scanner, and says why', async () => {
    biometrics.__setBiometrics({ hardware: false });
    await show();
    expect(lockSwitch(L.pinOnly)).toBeTruthy();
    expect(screen.getByText(L.noBiometrics)).toBeTruthy();
  });

  it('offers a PIN-only lock when only a weak face unlock is enrolled, and says why', async () => {
    biometrics.__setBiometrics({ level: 2 });
    await show();
    expect(lockSwitch(L.pinOnly)).toBeTruthy();
    expect(screen.getByText(L.weakBiometrics)).toBeTruthy();
  });

  it('offers a PIN-only lock with nothing enrolled, and says where to enrol', async () => {
    biometrics.__setBiometrics({ enrolled: false });
    await show();
    expect(lockSwitch(L.pinOnly)).toBeTruthy();
    expect(screen.getByText(L.enrol)).toBeTruthy();
  });

  it('on: says when it asks, and offers Change PIN', async () => {
    await enableLock('135790');
    await show();
    expect(lockSwitch().props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText(L.on)).toBeTruthy();
    expect(screen.getByRole('button', { name: S.changePin })).toBeTruthy();
  });
});

describe('turning the lock on', () => {
  it('needs a PIN chosen and confirmed first', async () => {
    await show();
    await fireEvent.press(lockSwitch());
    await settle();

    expect(screen.getByRole('header', { name: L.setPin.title })).toBeTruthy();
    expect(isLockOn()).toBe(false);

    await typePin('482913');
    expect(screen.getByRole('header', { name: L.setPin.confirmTitle })).toBeTruthy();
    expect(isLockOn()).toBe(false);

    await typePin('482913');

    expect(isLockOn()).toBe(true);
    expect(await checkPin('482913')).toBe(true);
    expect(biometrics.__prompts()).toBe(0);
  });

  it('starts over when the two PINs differ, and stays off', async () => {
    await show();
    await fireEvent.press(lockSwitch());
    await settle();

    await typePin('482913');
    await typePin('482914');

    expect(screen.getByText(L.setPin.mismatch)).toBeTruthy();
    expect(screen.getByRole('header', { name: L.setPin.title })).toBeTruthy();
    expect(isLockOn()).toBe(false);
    expect(await hasPin()).toBe(false);
  });

  it('says so when there is no session to lock, rather than blaming the device', async () => {
    await storeRefreshToken(null);
    await show();
    await fireEvent.press(lockSwitch());
    await settle();
    await typePin('482913');
    await typePin('482913');

    expect(screen.getByRole('alert')).toHaveTextContent(L.noSession);
    expect(isLockOn()).toBe(false);
  });

  it('works offline: the lock is this phone’s, not the account’s', async () => {
    setOnline(false);
    await show();
    expect(lockSwitch().props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(lockSwitch());
    await settle();
    expect(screen.getByRole('header', { name: L.setPin.title })).toBeTruthy();
  });
});

describe('turning the lock off', () => {
  it('asks the phone once, and goes off when it confirms', async () => {
    await enableLock('135790');
    await show();

    await fireEvent.press(lockSwitch());
    await settle();

    expect(biometrics.__prompts()).toBe(1);
    expect(isLockOn()).toBe(false);
    expect(await hasPin()).toBe(false);
  });

  it('a refused prompt leaves it on until the right PIN, and a wrong one is counted', async () => {
    await enableLock('135790');
    biometrics.__setBiometrics({ succeeds: false });
    await show();

    await fireEvent.press(lockSwitch());
    await settle();
    expect(biometrics.__prompts()).toBe(1);
    expect(screen.getByText(L.confirm.offIntro)).toBeTruthy();
    expect(isLockOn()).toBe(true);

    await typePin('000000');
    expect(isLockOn()).toBe(true);
    expect(await failedPinAttempts()).toBe(1);
    expect(screen.getByText('Wrong PIN. 4 attempts left before this phone signs you out.')).toBeTruthy();

    await typePin('135790');
    expect(isLockOn()).toBe(false);
    // One prompt, never repeated on its own.
    expect(biometrics.__prompts()).toBe(1);
  });
});

describe('changing the PIN', () => {
  it('needs the current PIN (or the prompt), then the new one twice', async () => {
    await enableLock('135790');
    biometrics.__setBiometrics({ succeeds: false });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: S.changePin }));
    await settle();
    expect(screen.getByText(L.confirm.changeIntro)).toBeTruthy();

    await typePin('135790');
    expect(screen.getByRole('header', { name: L.setPin.title })).toBeTruthy();

    await typePin('246802');
    await typePin('246802');

    expect(await checkPin('246802')).toBe(true);
    expect(await checkPin('135790')).toBe(false);
    expect(isLockOn()).toBe(true);
  });

  it('a wrong current PIN changes nothing', async () => {
    await enableLock('135790');
    biometrics.__setBiometrics({ succeeds: false });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: S.changePin }));
    await settle();
    await typePin('999999');

    expect(screen.queryByRole('header', { name: L.setPin.title })).toBeNull();
    expect(await checkPin('135790')).toBe(true);
  });
});
