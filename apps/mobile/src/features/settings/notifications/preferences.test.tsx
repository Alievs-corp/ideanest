import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as Notifications from 'expo-notifications';
import { ApiError } from '@ideanest/api-client';
import {
  CATEGORIES,
  CHANNELS,
  type DeliveryMode,
  type PreferenceSwitch,
} from '@ideanest/account/notifications';
import en from '@ideanest/messages/en.json';
import * as client from '../../../api/client';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { registerForPush } from '../../../lib/push';
import { NotificationSettingsScreen } from './preferences-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));
jest.mock('../../../lib/push', () => ({ registerForPush: jest.fn(async () => ({ status: 'registered' })) }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined' })),
}));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const permissions = jest.mocked(Notifications.getPermissionsAsync);
const N = en.account.notifications;
const M = en.mobile.settings.notifications;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** The whole table as a fresh account sees it: nothing stored, security mandatory, digest by email. */
function table(overrides: Partial<PreferenceSwitch>[] = []): PreferenceSwitch[] {
  const rows = CATEGORIES.flatMap((category) =>
    CHANNELS.map(
      (channel): PreferenceSwitch => ({
        category,
        channel,
        mode: 'IMMEDIATE',
        stored: false,
        changeable: category !== 'SECURITY',
        digestOffered: channel === 'EMAIL' && category !== 'SECURITY',
      }),
    ),
  );
  return rows.map((row) => {
    const change = overrides.find((o) => o.category === row.category && o.channel === row.channel);
    return change === undefined ? row : { ...row, ...change };
  });
}

function refusal(status: number): ApiError {
  return new ApiError(status, { type: 'about:blank', title: 'Refused', status });
}

function permission(granted: boolean, status: 'granted' | 'denied' | 'undetermined') {
  permissions.mockResolvedValue({ granted, status } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          <NotificationSettingsScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

async function choose(category: string, channel: string, mode: DeliveryMode) {
  await fireEvent.press(screen.getByTestId(`preference-${category}-${channel}`));
  await fireEvent.press(
    within(screen.getByTestId('preferences-sheet')).getByRole('radio', { name: N.mode[mode] }),
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  permission(false, 'undetermined');
  mockGet.mockResolvedValue({ preferences: table() });
});

describe('the table', () => {
  it('draws seven categories by three channels, in order, at their defaults', async () => {
    await show();

    expect(mockGet).toHaveBeenCalledWith('/v1/me/notification-preferences', expect.anything());
    expect(screen.getByText(N.preferences.heading)).toBeTruthy();
    expect(screen.getByText(N.preferences.defaults)).toBeTruthy();
    const cards = screen.getAllByTestId(/^preferences-[A-Z]+$/u).map((card) => card.props.testID);
    expect(cards).toEqual(CATEGORIES.map((category) => `preferences-${category}`));
    const pledges = within(screen.getByTestId('preferences-PLEDGES'))
      .getAllByRole('button')
      .map((row) => row.props.accessibilityLabel);
    expect(pledges).toEqual(['Your pledges — In app', 'Your pledges — Email', 'Your pledges — Push']);
  });

  it('offers a daily digest only where the service says it is offered', async () => {
    await show();

    await fireEvent.press(screen.getByTestId('preference-PLEDGES-EMAIL'));
    const sheet = screen.getByTestId('preferences-sheet');
    expect(within(sheet).getAllByRole('radio').map((radio) => radio.props.accessibilityLabel)).toEqual([
      N.mode.IMMEDIATE,
      N.mode.DIGEST,
      N.mode.OFF,
    ]);
    await fireEvent.press(within(sheet).getByLabelText(en.mobile.kitForm.close));

    await fireEvent.press(screen.getByTestId('preference-PLEDGES-IN_APP'));
    expect(
      within(screen.getByTestId('preferences-sheet')).queryByRole('radio', { name: N.mode.DIGEST }),
    ).toBeNull();
  });

  it('keeps a security switch disabled and says why', async () => {
    await show();

    const row = screen.getByTestId('preference-SECURITY-EMAIL');
    expect(row.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(within(screen.getByTestId('preferences-SECURITY')).getAllByText(N.mandatorySecurity)).toHaveLength(3);
    await fireEvent.press(row);
    expect(screen.queryByTestId('preferences-sheet')).toBeNull();
  });
});

describe('changing a switch', () => {
  it('sends exactly that one switch and adopts the whole answer', async () => {
    sendJson.mockResolvedValueOnce({
      preferences: table([{ category: 'PLEDGES', channel: 'EMAIL', mode: 'DIGEST', stored: true }]),
    });
    await show();
    await choose('PLEDGES', 'EMAIL', 'DIGEST');

    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/notification-preferences', {
      preferences: [{ category: 'PLEDGES', channel: 'EMAIL', mode: 'DIGEST' }],
    });
    expect(screen.getByText('Saved. Your pledges by email: daily digest.')).toBeTruthy();
    expect(
      within(screen.getByTestId('preference-PLEDGES-EMAIL')).getByText(N.mode.DIGEST),
    ).toBeTruthy();
    expect(screen.queryByText(N.preferences.defaults)).toBeNull();
  });

  it('holds the row while its request is in flight', async () => {
    sendJson.mockReturnValueOnce(new Promise(() => {}));
    await show();
    await choose('PLEDGES', 'IN_APP', 'OFF');

    expect(screen.getByTestId('preference-PLEDGES-IN_APP').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true, busy: true }),
    );
    expect(screen.getByTestId('preference-PLEDGES-EMAIL').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });

  it('says when the service wants fewer changes, and when somebody else changed it', async () => {
    sendJson.mockRejectedValueOnce(refusal(429));
    await show();
    await choose('PLEDGES', 'IN_APP', 'OFF');
    expect(screen.getByText(N.preferences.tooManyChanges)).toBeTruthy();
    expect(screen.getByText(N.preferences.saveFailedTitle)).toBeTruthy();

    sendJson.mockRejectedValueOnce(refusal(409));
    await choose('PLEDGES', 'IN_APP', 'OFF');
    expect(screen.getByText(M.conflict)).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('cannot be changed offline', async () => {
    await show();
    await act(async () => setOnline(false));

    expect(screen.getByTestId('preference-PLEDGES-IN_APP').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(screen.getByTestId('preference-PLEDGES-IN_APP'));
    expect(screen.queryByTestId('preferences-sheet')).toBeNull();
  });
});

describe('push and the phone’s permission', () => {
  it('asks for the permission when a Push switch is turned on and the phone has not decided', async () => {
    sendJson.mockResolvedValueOnce({ preferences: table() });
    mockGet.mockResolvedValue({
      preferences: table([{ category: 'PLEDGES', channel: 'PUSH', mode: 'OFF', stored: true }]),
    });
    await show();
    await choose('PLEDGES', 'PUSH', 'IMMEDIATE');

    expect(registerForPush).toHaveBeenCalledTimes(1);
  });

  it('does not ask when Push is turned off, or when the phone already allows it', async () => {
    sendJson.mockResolvedValue({ preferences: table() });
    await show();
    await choose('PLEDGES', 'PUSH', 'OFF');
    expect(registerForPush).not.toHaveBeenCalled();

    permission(true, 'granted');
    mockGet.mockResolvedValue({
      preferences: table([{ category: 'CAMPAIGN', channel: 'PUSH', mode: 'OFF', stored: true }]),
    });
    await show();
    await choose('CAMPAIGN', 'PUSH', 'IMMEDIATE');
    expect(registerForPush).not.toHaveBeenCalled();
  });

  it('keeps the saved preference when the phone refuses, and points to the phone’s settings', async () => {
    sendJson.mockResolvedValueOnce({
      preferences: table([{ category: 'PLEDGES', channel: 'PUSH', mode: 'IMMEDIATE', stored: true }]),
    });
    mockGet.mockResolvedValue({
      preferences: table([{ category: 'PLEDGES', channel: 'PUSH', mode: 'OFF', stored: true }]),
    });
    jest.mocked(registerForPush).mockImplementationOnce(async () => {
      permission(false, 'denied');
      return { status: 'denied' };
    });
    await show();
    expect(screen.queryByTestId('preferences-push-off')).toBeNull();

    await choose('PLEDGES', 'PUSH', 'IMMEDIATE');

    expect(screen.getByTestId('preferences-push-off')).toBeTruthy();
    expect(screen.getByText(M.pushOffTitle)).toBeTruthy();
    expect(within(screen.getByTestId('preference-PLEDGES-PUSH')).getByText(N.mode.IMMEDIATE)).toBeTruthy();
    expect(sendJson).toHaveBeenCalledTimes(1);

    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('preferences-open-settings'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('says so at the top whenever the phone has push turned off', async () => {
    permission(false, 'denied');
    await show();

    expect(screen.getByText(M.pushOffTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: M.openSettings })).toBeTruthy();
  });
});

describe('the states around the table', () => {
  it('shows three skeleton cards while loading', async () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('preferences-loading')).toBeTruthy();
    expect(screen.getByLabelText(N.preferences.loading)).toBeTruthy();
  });

  it('offers to try again when the table could not be read', async () => {
    mockGet.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();

    expect(screen.getByText(N.preferences.unreachable)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('preferences-PLEDGES')).toBeTruthy();
  });

  it('sends a signed-out reader to sign in, coming back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/notifications' },
    });
  });
});
