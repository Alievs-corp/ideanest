import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { SessionSummary } from '@ideanest/account/sessions';
import en from '@ideanest/messages/en.json';
import * as client from '../../../api/client';
import { signOut } from '../../../lib/auth';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { forgetPersistedCache } from '../../../lib/offline';
import { relativeTime } from './relative-time';
import { SessionsSettingsScreen } from './sessions-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockSessionStore = {
  value: { signedIn: true, locked: false, unlocked: false },
  listeners: new Set<() => void>(),
  set(signedIn: boolean) {
    this.value = { ...this.value, signedIn };
    this.listeners.forEach((listener) => listener());
  },
};
const mockGet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../../lib/use-session', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return {
    useSession: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockSessionStore.listeners.add(listener);
          return () => mockSessionStore.listeners.delete(listener);
        },
        () => mockSessionStore.value,
      ),
  };
});
jest.mock('../../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));
jest.mock('../../../lib/auth', () => ({ signOut: jest.fn(async () => undefined) }));
jest.mock('../../../lib/offline', () => ({ forgetPersistedCache: jest.fn() }));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const S = en.settings.panels.sessions;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

function session(overrides: Partial<SessionSummary> & Pick<SessionSummary, 'id'>): SessionSummary {
  return {
    createdAt: '2026-09-01T09:00:00.000Z',
    lastSeenAt: '2026-10-01T09:00:00.000Z',
    expiresAt: '2026-11-01T09:00:00.000Z',
    current: false,
    ...overrides,
  };
}

const THIS_PHONE = session({ id: 'here', deviceLabel: 'Aysel’s iPhone', current: true, ipAddress: '203.0.113.7' });
const LAPTOP = session({ id: 'laptop', userAgent: CHROME_MAC });
const DESKTOP = session({ id: 'desktop', userAgent: FIREFOX_LINUX });

function refusal(status: number, detail?: string): ApiError {
  return new ApiError(status, { type: 'about:blank', title: 'Refused', status, detail });
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let queryClient: QueryClient;

async function show() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <SessionsSettingsScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSessionStore.value = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  mockGet.mockResolvedValue([THIS_PHONE, LAPTOP, DESKTOP]);
  sendJson.mockResolvedValue(null);
});

describe('the device list', () => {
  it('names each device and marks this one with a word', async () => {
    await show();

    expect(mockGet).toHaveBeenCalledWith('/v1/auth/sessions', expect.anything());
    expect(screen.getByText('Aysel’s iPhone')).toBeTruthy();
    expect(screen.getByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('Firefox on Linux')).toBeTruthy();
    expect(within(screen.getByTestId('session-here')).getByText(S.row.thisDevice)).toBeTruthy();
    expect(screen.getByText('203.0.113.7')).toBeTruthy();
    // Named by the parser and with no address: the name already says all the row knows.
    expect(within(screen.getByTestId('session-laptop')).getByText(S.row.noDetails)).toBeTruthy();
  });

  it('gives every Sign out a name that says which device', async () => {
    await show();

    expect(screen.getByLabelText('Sign out Chrome on macOS')).toBeTruthy();
    expect(screen.getByLabelText('Sign out Firefox on Linux')).toBeTruthy();
    expect(screen.getByLabelText(S.row.signOutThisLabel)).toBeTruthy();
  });

  it('signs one device out with a DELETE and takes its row away', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('session-sign-out-laptop'));
    await settle();

    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith('DELETE', '/v1/auth/sessions/laptop');
    expect(screen.queryByTestId('session-laptop')).toBeNull();
    expect(screen.getByText('Signed out Chrome on macOS.')).toBeTruthy();
  });

  it('counts a 404 as the device already gone, which is what was asked', async () => {
    sendJson.mockRejectedValueOnce(refusal(404));
    await show();
    await fireEvent.press(screen.getByTestId('session-sign-out-laptop'));
    await settle();

    expect(screen.queryByTestId('session-laptop')).toBeNull();
    expect(screen.queryByTestId('sessions-error')).toBeNull();
  });

  it('says the account is closing when the service refuses with 403', async () => {
    sendJson.mockRejectedValueOnce(refusal(403, 'Forbidden.'));
    await show();
    await fireEvent.press(screen.getByTestId('session-sign-out-laptop'));
    await settle();

    expect(screen.getByText(S.deletionScheduled)).toBeTruthy();
    expect(screen.getByTestId('session-laptop')).toBeTruthy();
  });

  it('signs this phone out locally and never DELETEs its own session', async () => {
    // The real sign-out empties the keychain, which flips the flag the signed-in gate reads.
    jest.mocked(signOut).mockImplementationOnce(async () => {
      mockSessionStore.set(false);
    });
    await show();
    const clear = jest.spyOn(queryClient, 'clear');
    const button = screen.getByTestId('session-sign-out-here');
    await fireEvent.press(button);
    await fireEvent.press(button);
    await settle();

    expect(sendJson).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
    // Moves on once this phone has forgotten the session; the logout request is not awaited.
    expect(signOut).toHaveBeenCalledWith({ waitForService: false });
    // The screen leads the way out, so the gate does not race it to sign-in.
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(forgetPersistedCache).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith('/');
  });
});

describe('signing out everywhere else', () => {
  it('asks first, in a dialog with no corner X', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('sessions-sign-out-others'));

    const dialog = screen.getByTestId('sessions-confirm');
    expect(within(dialog).getByText(S.confirmTitle)).toBeTruthy();
    expect(within(dialog).getByText('2 devices will be signed out immediately. This one stays signed in.')).toBeTruthy();
    expect(within(dialog).queryByLabelText(en.mobile.kitForm.close)).toBeNull();

    await fireEvent.press(screen.getByTestId('sessions-confirm-cancel'));
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('signs out every other device, not this one, then reads the list again', async () => {
    await show();
    mockGet.mockResolvedValue([THIS_PHONE]);
    await fireEvent.press(screen.getByTestId('sessions-sign-out-others'));
    await fireEvent.press(screen.getByTestId('sessions-confirm-sign-out'));
    await settle();

    expect(sendJson.mock.calls.map((call) => call[1]).sort()).toEqual([
      '/v1/auth/sessions/desktop',
      '/v1/auth/sessions/laptop',
    ]);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Signed out 2 devices.')).toBeTruthy();
    expect(screen.queryByTestId('session-laptop')).toBeNull();
  });

  it('says what could not be signed out when only some of them were', async () => {
    sendJson.mockImplementation(async (_method, path) => {
      if (path === '/v1/auth/sessions/desktop') throw refusal(500, 'Down.');
      return null;
    });
    await show();
    mockGet.mockResolvedValue([THIS_PHONE, DESKTOP]);
    await fireEvent.press(screen.getByTestId('sessions-sign-out-others'));
    await fireEvent.press(screen.getByTestId('sessions-confirm-sign-out'));
    await settle();

    const error = screen.getByTestId('sessions-error');
    expect(
      within(error).getByText(
        'Signed out 1 device. 1 device could not be signed out — try again. Still signed in: Firefox on Linux.',
      ),
    ).toBeTruthy();
  });
});

describe('when the account is closing', () => {
  it('says so when every device is refused with 403', async () => {
    sendJson.mockRejectedValue(refusal(403, 'Forbidden.'));
    await show();
    await fireEvent.press(screen.getByTestId('sessions-sign-out-others'));
    await fireEvent.press(screen.getByTestId('sessions-confirm-sign-out'));
    await settle();

    expect(within(screen.getByTestId('sessions-error')).getByText(S.deletionScheduled)).toBeTruthy();
    expect(screen.queryByText(/could not be signed out/u)).toBeNull();
  });
});

describe('the states around the list', () => {
  it('shows three skeleton rows while loading', async () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('sessions-loading')).toBeTruthy();
    expect(screen.getByLabelText(S.loading)).toBeTruthy();
  });

  it('offers to try again when the list could not be read', async () => {
    mockGet.mockRejectedValueOnce(refusal(500, 'The list is not available.'));
    await show();

    expect(screen.getByText('The list is not available.')).toBeTruthy();
    mockGet.mockResolvedValue([THIS_PHONE]);
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('session-here')).toBeTruthy();
  });

  it('keeps the list readable offline, with every action disabled', async () => {
    await show();
    await act(async () => setOnline(false));

    expect(screen.getByTestId('settings-offline')).toBeTruthy();
    expect(screen.getByTestId('session-laptop')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('session-sign-out-laptop'));
    await fireEvent.press(screen.getByTestId('sessions-sign-out-others'));
    await settle();
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sessions-confirm')).toBeNull();
  });

  it('sends a signed-out reader to sign in, coming back here', async () => {
    mockSessionStore.value = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/sessions' },
    });
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('steps through the units in the reader’s language', () => {
    expect(relativeTime('2026-08-15T09:00:00.000Z', now, 'en')).toBe('3 hours ago');
    expect(relativeTime('2026-08-15T09:00:00.000Z', now, 'az')).toBe('3 saat öncə');
  });

  it('says the time is unknown rather than printing an invalid date', () => {
    expect(relativeTime('not a date', now, 'en')).toBe('Unknown');
  });
});
