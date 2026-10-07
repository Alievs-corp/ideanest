import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import * as client from '../../api/client';
import { resetAppLockForTests, unlockWithPin } from '../../lib/app-lock';
import { setOnline } from '../../lib/connectivity';
import { enableLock, rememberAccessToken, storeRefreshToken, useFlagStore } from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { setLocale } from '../../lib/locale';
import { LanguageSettingsScreen } from './language-screen';
import { SETTINGS_SECTIONS } from './sections';
import { SettingsListScreen } from './settings-list';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: jest.fn(),
  saveAccountLocale: jest.fn(async () => true),
}));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const C = en.settings.currency;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let queryClient: QueryClient;

async function show(element: React.ReactElement) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          {element}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function reads(paths: Record<string, unknown>) {
  mockGet.mockImplementation(async (path: string) => {
    if (path in paths) return paths[path];
    throw new Error(`unexpected read ${path}`);
  });
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
});

describe('the settings list', () => {
  it('lists the nine sections in the web order, Security named for the app lock', async () => {
    reads({});
    await show(<SettingsListScreen />);
    const labels = SETTINGS_SECTIONS.map(
      (section) => screen.getByTestId(`settings-row-${section}`).props.accessibilityLabel as string,
    );
    expect(labels).toEqual([
      en.account.links.profile.label,
      en.account.links.notifications.label,
      en.account.links.sessions.label,
      en.account.links.email.label,
      en.account.links.password.label,
      en.mobile.settings.securityLabel,
      en.account.links.privacy.label,
      en.account.links.payout.label,
      en.account.links.language.label,
    ]);

    await fireEvent.press(screen.getByRole('button', { name: en.account.links.sessions.label }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/sessions');
  });

  it('sends a signed-out reader to sign in with /settings as the way back', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    reads({});
    await show(<SettingsListScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings' },
    });
  });
});

describe('#319: with the app lock shut', () => {
  afterEach(() => {
    useFlagStore(memoryStore());
    resetAppLockForTests();
  });

  it('waits for the lock to open before sending a signed-out reader to sign in', async () => {
    useFlagStore(memoryStore());
    rememberAccessToken(null);
    await storeRefreshToken('refresh-1');
    await enableLock('135790');
    resetAppLockForTests(); // a locked cold start
    mockSession = { signedIn: false, locked: true, unlocked: false };
    reads({});
    await show(<SettingsListScreen />);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => {
      await unlockWithPin('135790', async () => undefined);
    });
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings' },
    });
  });
});

describe('language and currency', () => {
  const rates = { base: 'AZN', rates: [{ currency: 'USD', rate: '0.588' }, { currency: 'EUR', rate: '0.54' }] };

  it('signed out: the language only, and no account read', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    reads({});
    await show(<LanguageSettingsScreen />);
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
    expect(screen.queryByTestId('currency-section')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('signed in: saves the display currency and refreshes the account', async () => {
    reads({ '/v1/exchange-rates': rates, '/v1/me': { email: 'a@b.c', currency: 'AZN' } });
    sendJson.mockResolvedValue(null);
    await show(<LanguageSettingsScreen />);

    expect(screen.getByTestId('currency-form')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('currency-select'));
    await fireEvent.press(screen.getByRole('radio', { name: 'USD' }));
    await fireEvent.press(screen.getByTestId('currency-save'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/currency', { currency: 'USD' });
    expect(screen.getByText(C.saved)).toBeTruthy();
  });

  it('says so when the save is refused', async () => {
    reads({ '/v1/exchange-rates': rates, '/v1/me': { email: 'a@b.c', currency: 'AZN' } });
    sendJson.mockRejectedValue(new Error('refused'));
    await show(<LanguageSettingsScreen />);
    await fireEvent.press(screen.getByTestId('currency-save'));
    await settle();
    expect(screen.getByText(en.mobile.settings.currency.failed)).toBeTruthy();
  });

  it('cannot save while offline', async () => {
    reads({ '/v1/exchange-rates': rates, '/v1/me': { email: 'a@b.c', currency: 'USD' } });
    setOnline(false);
    await show(<LanguageSettingsScreen />);
    await fireEvent.press(screen.getByTestId('currency-save'));
    await settle();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('a failed rates read is an error with a retry, not "no other currency"', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/v1/me') return { email: 'a@b.c', currency: 'USD' };
      throw new TypeError('Network request failed');
    });
    await show(<LanguageSettingsScreen />);
    expect(screen.getByTestId('currency-load-failed')).toBeTruthy();
    expect(screen.queryByText(C.unavailable)).toBeNull();

    reads({ '/v1/exchange-rates': rates, '/v1/me': { email: 'a@b.c', currency: 'USD' } });
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('currency-form')).toBeTruthy();
  });

  it('never offers the form while the current currency is unknown', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/v1/exchange-rates') return rates;
      throw new TypeError('Network request failed');
    });
    await show(<LanguageSettingsScreen />);
    // `useMe` retries a network failure on its own; until it gives up, the card waits.
    expect(screen.queryByTestId('currency-save')).toBeNull();
    expect(screen.getByTestId('currency-loading')).toBeTruthy();
  });

  it('shows the currency the account already has', async () => {
    reads({ '/v1/exchange-rates': rates, '/v1/me': { email: 'a@b.c', currency: 'EUR' } });
    sendJson.mockResolvedValue(null);
    await show(<LanguageSettingsScreen />);
    await fireEvent.press(screen.getByTestId('currency-save'));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/currency', { currency: 'EUR' });
  });

  it('draws a sentence, not a control, when there is nothing to choose', async () => {
    reads({ '/v1/exchange-rates': { base: 'AZN', rates: [] }, '/v1/me': { email: 'a@b.c' } });
    await show(<LanguageSettingsScreen />);
    expect(screen.getByText(C.unavailable)).toBeTruthy();
    expect(screen.queryByTestId('currency-save')).toBeNull();
  });
});
