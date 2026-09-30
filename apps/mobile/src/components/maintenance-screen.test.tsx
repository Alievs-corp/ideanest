import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import MaintenanceScreen from '../app/maintenance';
import { colors } from '../theme';
import { setOnline } from '../lib/connectivity';
import {
  POLL_INTERVAL_MS,
  enterMaintenance,
  inMaintenance,
  leaveMaintenance,
} from '../lib/maintenance';

/**
 * The maintenance screen — issue #150: the web's words, a white "Try again" that checks now,
 * polling that honours `Retry-After`, and a way out — once — only when the service answers.
 *
 * <p>Here rather than beside `app/maintenance.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

const mockRouter = { replace: jest.fn() };
const mockNavigation = { goBack: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavigation,
    // The screen is always focused here, so focus is mount.
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

/** A phone with a notch and a home indicator, so the WhatsApp sheet has real insets to read. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const copy = en.shell.failure.pages.maintenance;
const TRY_AGAIN = en.shell.failure.pages.error.retry;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();
const down = () => new Response(null, { status: 503 });
const up = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

/*
 * The first render pays for FailureState and the WhatsApp sheet's module graph, which is the
 * kind of cold start that took past jest's 5 s default on a CI runner.
 */
jest.setTimeout(20_000);

let queryClient: QueryClient;

function renderScreen() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  return render(<MaintenanceScreen />, { wrapper });
}

/** Lets timers run and the promises they start settle, inside React's act. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/*
 * `Once`, and never restored: React Native's preset already makes these jest mocks, so a spy is
 * that same mock, and restoring it would strip the implementation every later test relies on.
 */
function captureAppState(): ((state: AppStateStatus) => void)[] {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
  return listeners;
}

let announce: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockNavigation.canGoBack.mockReturnValue(true);
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  queryClient = new QueryClient();
  jest.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  setOnline(true);
  leaveMaintenance();
});

afterEach(() => {
  announce.mockRestore();
  jest.useRealTimers();
});

it("shows the web's maintenance copy with a white Try again, and no way back", async () => {
  const backHandlers: (() => boolean | null | undefined)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementationOnce((_type, handler) => {
    backHandlers.push(handler as () => boolean | null | undefined);
    return { remove: jest.fn() };
  });
  enterMaintenance(POLL_INTERVAL_MS);
  await renderScreen();

  expect(screen.getByRole('header', { name: copy.title })).toBeOnTheScreen();
  expect(screen.getByText(copy.description)).toBeOnTheScreen();
  // White, never lime: a page that is not there is not a surface to act on.
  expect(screen.getByRole('button', { name: TRY_AGAIN })).toHaveStyle({
    backgroundColor: colors.whiteSurface,
  });

  // Android's back button is swallowed while focused: the screens underneath failed.
  expect(backHandlers).toHaveLength(1);
  expect(backHandlers[0]?.()).toBe(true);
});

it('waits for Retry-After, polls every thirty seconds, and leaves when the service answers', async () => {
  enterMaintenance(10_000);
  fetchMock.mockResolvedValueOnce(down()).mockResolvedValueOnce(up());
  await renderScreen();

  await advance(9_999);
  expect(fetchMock).not.toHaveBeenCalled();

  await advance(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toMatch(/^https:\/\/api\.test\.invalid\/v1\/categories\?_=/);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(inMaintenance()).toBe(true);

  await advance(POLL_INTERVAL_MS);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(inMaintenance()).toBe(false);
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  // The screens underneath rendered errors as the outage began; they fetch again.
  expect(queryClient.refetchQueries).toHaveBeenCalledWith({ type: 'active' });
});

it('goes Home when there is nothing to go back to', async () => {
  mockNavigation.canGoBack.mockReturnValue(false);
  enterMaintenance(0);
  fetchMock.mockResolvedValueOnce(up());
  await renderScreen();

  await advance(0);
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
});

it('Try again checks now, busy while it asks, and says so when the answer is still no', async () => {
  enterMaintenance(POLL_INTERVAL_MS);
  let answer: (response: Response) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  await renderScreen();

  await fireEvent.press(screen.getByRole('button', { name: TRY_AGAIN }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: TRY_AGAIN })).toBeBusy();

  await act(async () => answer(down()));
  expect(screen.getByRole('button', { name: TRY_AGAIN })).not.toBeBusy();
  expect(announce).toHaveBeenCalledWith(copy.description);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();

  // Polling carries on from there.
  fetchMock.mockResolvedValueOnce(up());
  await advance(POLL_INTERVAL_MS);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
});

it('Try again leaves at once when the service answers', async () => {
  enterMaintenance(POLL_INTERVAL_MS);
  fetchMock.mockResolvedValueOnce(up());
  await renderScreen();

  await fireEvent.press(screen.getByRole('button', { name: TRY_AGAIN }));
  await advance(0);

  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  expect(announce).not.toHaveBeenCalled();
});

it('leaves once, even when Try again and a return to the foreground both answer', async () => {
  const listeners = captureAppState();
  enterMaintenance(POLL_INTERVAL_MS);
  fetchMock.mockResolvedValue(up());
  await renderScreen();

  await fireEvent.press(screen.getByRole('button', { name: TRY_AGAIN }));
  await act(async () => listeners.forEach((listener) => listener('active')));
  await advance(POLL_INTERVAL_MS);

  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  expect(queryClient.refetchQueries).toHaveBeenCalledTimes(1);
});

it('stops polling when the app is put away, and asks at once when it comes back', async () => {
  const listeners = captureAppState();
  enterMaintenance(POLL_INTERVAL_MS);
  fetchMock.mockResolvedValue(down());
  await renderScreen();

  await act(async () => listeners.forEach((listener) => listener('background')));
  await advance(POLL_INTERVAL_MS * 5);
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => listeners.forEach((listener) => listener('active')));
  await advance(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('stops polling when the screen unmounts', async () => {
  enterMaintenance(POLL_INTERVAL_MS);
  fetchMock.mockResolvedValue(down());
  const view = await renderScreen();

  await view.unmount();
  await advance(POLL_INTERVAL_MS * 5);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reached with no outage (a stray ideanest://maintenance), it goes Home at once', async () => {
  await renderScreen();

  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  await advance(POLL_INTERVAL_MS * 2);
  expect(fetchMock).not.toHaveBeenCalled();
});
