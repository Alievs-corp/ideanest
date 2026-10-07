import { type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { lockPhase, resetAppLockForTests } from '../../lib/app-lock';
import { enableLock, rememberAccessToken, storeRefreshToken, useFlagStore } from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { spacing } from '../../theme';
import { LockGate, LockScreen } from './lock-screen';

/**
 * The lock screen's last control stays above the navigation bar and the home indicator (#319
 * device finding: a Xiaomi with three-button navigation showed "Turn the lock off instead" half
 * under the bar). The lock covers the whole window, so its bottom edge is never less than the
 * window's own inset, whatever the nearest provider reports.
 */

/**
 * The launch reading of the window, as `react-native-safe-area-context` exports it: a phone with a
 * three-button navigation bar, 48dp at the bottom.
 */
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 392, height: 873 },
    insets: { top: 30, left: 0, right: 0, bottom: 48 },
  },
}));

const FRAME = { x: 0, y: 0, width: 392, height: 873 };
const NAV_BAR = 48; // three-button navigation on a 1080x2400 phone, in dp

function metrics(bottom: number) {
  return { frame: FRAME, insets: { top: 30, left: 0, right: 0, bottom } };
}

function wrapper(bottom: number) {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={metrics(bottom)}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function sheetBottomPadding(): number {
  const sheet = screen.getByTestId('lock-sheet');
  const style = StyleSheet.flatten(sheet.props.contentContainerStyle) as { paddingBottom?: number };
  return style.paddingBottom ?? 0;
}

beforeEach(() => {
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  resetAppLockForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  (LocalAuthentication as unknown as { __reset: () => void }).__reset();
});

describe('the lock screen’s bottom edge', () => {
  it('pads "Turn the lock off instead" by the window inset when the provider reports none', async () => {
    // The Android case: the app root stops above the bar and says 0; the modal's window does not.
    await render(<LockScreen phase="set-pin" />, { wrapper: wrapper(0) });

    expect(screen.getByRole('button', { name: en.mobile.lock.setPin.turnOff })).toBeTruthy();
    expect(within(screen.getByTestId('lock-sheet')).getByTestId('lock-turn-off')).toBeTruthy();
    expect(sheetBottomPadding()).toBe(NAV_BAR + spacing[6]);
  });

  it('pads by the provider’s inset when it is the larger', async () => {
    await render(<LockScreen phase="signed-out" />, { wrapper: wrapper(60) });
    expect(sheetBottomPadding()).toBe(60 + spacing[6]);
  });

  it('on Android, the full-screen modal measures its own window', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    // The owner cancels the prompt: the PIN pad stays, and so does the lock screen.
    (LocalAuthentication as unknown as { __setBiometrics: (state: { succeeds: boolean }) => void })
      .__setBiometrics({ succeeds: false });
    await storeRefreshToken('refresh-1');
    await enableLock('135790');
    resetAppLockForTests();
    expect(lockPhase()).toBe('locked');

    await render(
      <LockGate>
        <></>
      </LockGate>,
      { wrapper: wrapper(0) },
    );

    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(sheetBottomPadding()).toBeGreaterThanOrEqual(NAV_BAR + spacing[6]);
  });
});
