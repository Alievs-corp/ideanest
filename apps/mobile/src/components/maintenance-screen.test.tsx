import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, BackHandler, type AppStateStatus } from 'react-native';
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
 * polling that honours `Retry-After`, and a way out only when the service answers.
 *
 * <p>Here rather than beside `app/maintenance.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

/** A phone with a notch and a home indicator, so the WhatsApp sheet has real insets to read. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const copy = en.shell.failure.pages.maintenance;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();
const down = () => new Response(null, { status: 503 });
const up = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

/*
 * The first render pays for FailureState and the WhatsApp sheet's module graph, which is the
 * kind of cold start that took past jest's 5 s default on a CI runner.
 */
jest.setTimeout(20_000);

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <MaintenanceScreen />
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

/** Lets timers run and the promises they start settle, inside React's act. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  setOnline(true);
  leaveMaintenance();
});

afterEach(() => jest.useRealTimers());

it("shows the web's maintenance copy with a white Try again, and no way back", async () => {
  const backHandlers: (() => boolean | null | undefined)[] = [];
  /*
   * `Once`, and never restored: React Native's preset already makes these jest mocks, so a
   * spy is that same mock, and restoring it would strip the implementation every later test
   * relies on.
   */
  jest.spyOn(BackHandler, 'addEventListener').mockImplementationOnce((_type, handler) => {
    backHandlers.push(handler as () => boolean | null | undefined);
    return { remove: jest.fn() };
  });
  enterMaintenance(POLL_INTERVAL_MS);
  await renderScreen();

  expect(screen.getByRole('header', { name: copy.title })).toBeOnTheScreen();
  expect(screen.getByText(copy.description)).toBeOnTheScreen();
  // White, never lime: a page that is not there is not a surface to act on.
  expect(screen.getByRole('button', { name: en.shell.failure.pages.error.retry })).toHaveStyle({
    backgroundColor: colors.whiteSurface,
  });

  // Android's back button is swallowed: the screens underneath are the ones that failed.
  expect(backHandlers).toHaveLength(1);
  expect(backHandlers[0]?.()).toBe(true);
});

it('waits for Retry-After, polls every thirty seconds, and goes back when the service answers', async () => {
  enterMaintenance(10_000);
  fetchMock.mockResolvedValueOnce(down()).mockResolvedValueOnce(up());
  await renderScreen();

  await advance(9_999);
  expect(fetchMock).not.toHaveBeenCalled();

  await advance(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/categories');
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(inMaintenance()).toBe(true);

  await advance(POLL_INTERVAL_MS);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(inMaintenance()).toBe(false);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('goes Home when there is nothing to go back to', async () => {
  mockRouter.canGoBack.mockReturnValue(false);
  enterMaintenance(0);
  fetchMock.mockResolvedValueOnce(up());
  await renderScreen();

  await advance(0);
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('Try again checks now rather than at the next tick', async () => {
  enterMaintenance(POLL_INTERVAL_MS);
  fetchMock.mockResolvedValueOnce(up());
  await renderScreen();

  await fireEvent.press(screen.getByRole('button', { name: en.shell.failure.pages.error.retry }));
  await advance(0);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('stops polling when the app is put away, and asks at once when it comes back', async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
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
