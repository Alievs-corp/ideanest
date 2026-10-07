import { type ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { notificationAsync } from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { lockPhase, resetAppLockForTests, startAppLock } from '../../lib/app-lock';
import { refreshAccessToken } from '../../lib/auth';
import { checkPin, failedPinAttempts } from '../../lib/pin';
import {
  enableLock,
  hasStoredSession,
  isLockOn,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from '../../lib/session';
import { memoryStore, type KeyValueStore } from '../../lib/storage';
import { LockGate } from './lock-screen';

/**
 * The lock screen over the app (#319), drawn and driven as the owner meets it: one prompt at
 * launch, the PIN pad when it is refused, the countdown announced, and the sign-out at five.
 */

jest.mock('../../lib/push', () => ({ unregisterFromPush: jest.fn(async () => {}) }));

const L = en.mobile.lock;
const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: { succeeds?: boolean; hardware?: boolean }) => void;
  __prompts: () => number;
  __reset: () => void;
};
const keychain = SecureStore as unknown as {
  __put: (key: string, value: string, service?: string) => void;
  __reads: () => { key: string; options?: Record<string, unknown> }[];
  __reset: () => void;
};

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let flags: KeyValueStore;
let client: QueryClient;
let stop: () => void = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  keychain.__reset();
  biometrics.__reset();
  flags = memoryStore();
  useFlagStore(flags);
  rememberAccessToken(null);
  resetAppLockForTests();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
});

afterEach(() => {
  stop();
  client?.clear();
  jest.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The root layout's part: the gate started, and the app under it. */
async function launch() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stop = startAppLock();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(
    <LockGate>
      <Text testID="behind">Pledges</Text>
    </LockGate>,
    { wrapper },
  );
  await settle();
  return view;
}

async function lockedPhone() {
  await storeRefreshToken('refresh-1');
  await enableLock('135790');
  resetAppLockForTests();
}

async function typePin(pin: string) {
  for (const digit of pin) {
    await fireEvent.press(screen.getByRole('keyboardkey', { name: digit }));
  }
  await settle();
}

const announcedAssertively = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.filter(([, options]) => options?.queue === false)
    .map(([message]) => message);

describe('a phone without the lock', () => {
  it('shows the app and nothing in front of it', async () => {
    await storeRefreshToken('refresh-1');
    await launch();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('behind')).toBeTruthy();
    expect(biometrics.__prompts()).toBe(0);
  });
});

describe('a cold start with the lock on', () => {
  it('asks exactly once, and a refusal leaves the PIN pad rather than another prompt', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });

    const view = await launch();

    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(biometrics.__prompts()).toBe(1);
    expect(screen.getByRole('header', { name: L.screen.enterPin })).toBeTruthy();
    // The app behind is out of reach of a screen reader while the gate is shut.
    expect(screen.queryByTestId('behind')).toBeNull();

    // Re-rendering, the requests behind the gate and their token refreshes ask for nothing.
    await view.rerender(
      <LockGate>
        <Text testID="behind">Saved</Text>
      </LockGate>,
    );
    await settle();
    global.fetch = jest.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    await refreshAccessToken().catch(() => null);
    await settle();
    expect(biometrics.__prompts()).toBe(1);
    expect(keychain.__reads().some((read) => read.options?.['requireAuthentication'] === true)).toBe(false);
  });

  it('opens on a passed prompt', async () => {
    await lockedPhone();
    await launch();
    expect(biometrics.__prompts()).toBe(1);
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('behind')).toBeTruthy();
  });

  it('opens with the right PIN', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });
    await launch();

    await typePin('135790');

    expect(lockPhase()).toBe('open');
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('behind')).toBeTruthy();
  });

  it('says what a wrong PIN costs, and says it to a screen reader', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });
    await launch();

    await typePin('000000');

    const message = 'Wrong PIN. 4 attempts left before this phone signs you out.';
    expect(screen.getByTestId('lock-pin-error')).toHaveTextContent(message);
    expect(announcedAssertively()).toContain(message);
    expect(notificationAsync).toHaveBeenCalledWith('error');
    expect(await failedPinAttempts()).toBe(1);
    expect(screen.getByLabelText('0 of 6 entered')).toBeTruthy();
  });

  it('"Use fingerprint" asks again, once, because the owner asked', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });
    await launch();
    expect(biometrics.__prompts()).toBe(1);

    biometrics.__setBiometrics({ succeeds: true });
    await fireEvent.press(screen.getByRole('button', { name: L.screen.useFingerprint }));
    await settle();

    expect(biometrics.__prompts()).toBe(2);
    expect(screen.queryByTestId('lock-screen')).toBeNull();
  });

  it('signs out on this phone at the fifth wrong PIN, and says so', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });
    await launch();

    for (let attempt = 0; attempt < 5; attempt += 1) await typePin('999999');

    expect(hasStoredSession()).toBe(false);
    expect(isLockOn()).toBe(false);
    expect(screen.getByRole('header', { name: L.screen.signedOutTitle })).toBeTruthy();
    expect(screen.getByText(L.screen.signedOutBody)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: L.screen.continue }));
    await settle();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
  });
});

describe('a pre-#319 locked install', () => {
  function legacy() {
    keychain.__put('ideanest.refresh-token.locked', 'refresh-old', 'az.ideanest.app.locked');
    flags.set('session.present', 'true');
    flags.set('session.locked', 'true');
    resetAppLockForTests();
  }

  it('moves the session with one prompt, then has a PIN chosen and confirmed', async () => {
    legacy();
    // `startAppLock` runs the migration it finds owed; its one prompt is the old item's.
    await launch();

    expect(biometrics.__prompts()).toBe(0);
    expect(keychain.__reads().filter((read) => read.options?.['requireAuthentication'] === true)).toHaveLength(1);
    expect(screen.getByText(L.setPin.migrationIntro)).toBeTruthy();

    await typePin('112233');
    expect(screen.getByRole('header', { name: L.setPin.confirmTitle })).toBeTruthy();
    await typePin('445566');
    expect(screen.getByText(L.setPin.mismatch)).toBeTruthy();
    expect(screen.getByRole('header', { name: L.setPin.title })).toBeTruthy();

    await typePin('112233');
    await typePin('112233');

    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(await checkPin('112233')).toBe(true);
    expect(hasStoredSession()).toBe(true);
  });

  it('may turn the lock off instead', async () => {
    legacy();
    // `startAppLock` runs the migration it finds owed; its one prompt is the old item's.
    await launch();

    await fireEvent.press(screen.getByRole('button', { name: L.setPin.turnOff }));
    await settle();

    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(isLockOn()).toBe(false);
    expect(hasStoredSession()).toBe(true);
  });
});
