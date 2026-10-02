import { AccessibilityInfo, Linking } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import type { TestInstance } from 'test-renderer';
import * as client from '../../api/client';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { deviceStore } from '../../lib/storage';
import { SecuritySettingsScreen } from './security-screen';

/**
 * `settings/security`'s two-factor card (#161): the five steps on screen, focus on each step's
 * heading, the scan step's three ways to the secret, and recovery codes that exist only on screen.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: true };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/client', () => ({ sendJson: jest.fn() }));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const T = en.settings.panels.twoFactor;
const S = en.mobile.settings.security;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PASSWORD = 'a long pass phrase';
const ENROLMENT = {
  secret: 'ABCDEFGHIJKLMNOP',
  otpauthUri: 'otpauth://totp/IdeyaNest:aysel?secret=ABCDEFGHIJKLMNOP&issuer=IdeyaNest',
  digits: 6,
  periodSeconds: 30,
  algorithm: 'SHA1',
};
const CODES = ['first recovery', 'second recovery', 'third recovery', 'fourth recovery'];

function refusal(status: number, detail: string): ApiError {
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
          <SecuritySettingsScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

/** The step heading's words — one header, which is where focus goes on every step. */
function headingText(): string {
  return textOf(screen.getByTestId('two-factor-heading'));
}

function textOf(node: TestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

async function press(testID: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await settle();
}

/** Through password and scan to the codes, as somebody switching it on does. */
async function enrolToCodes() {
  sendJson.mockResolvedValueOnce(ENROLMENT).mockResolvedValueOnce({ recoveryCodes: CODES });
  await press('two-factor-set-up');
  await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
  await press('two-factor-continue');
  await fireEvent.changeText(screen.getByTestId('two-factor-code'), ' 123456 ');
  await press('two-factor-switch-on');
}

let canOpen: jest.SpyInstance;
let openURL: jest.SpyInstance;
let focus: jest.SpyInstance;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: true };
  setOnline(true);
  canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
});

afterEach(() => {
  canOpen.mockRestore();
  openURL.mockRestore();
  focus.mockRestore();
});

describe('two-factor: idle', () => {
  it('offers both paths, and says why, because the account cannot say which applies', async () => {
    await show();

    expect(headingText()).toBe(T.heading);
    expect(screen.getByText(T.introEmphasis)).toBeTruthy();
    expect(screen.getByRole('button', { name: T.setUp })).toBeTruthy();
    expect(screen.getByRole('button', { name: T.turnOff })).toBeTruthy();
    expect(screen.getByText(T.bothOffered)).toBeTruthy();
    // Nobody asked for focus on arrival.
    expect(focus).not.toHaveBeenCalled();
  });

  it('links the intro to the devices screen', async () => {
    await show();
    await fireEvent.press(screen.getByText('devices'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/sessions');
  });
});

describe('two-factor: switching it on', () => {
  it('goes password → scan → codes → idle, sending what the web sends', async () => {
    await show();
    await enrolToCodes();

    expect(sendJson).toHaveBeenNthCalledWith(1, 'POST', '/v1/auth/2fa/enable', { password: PASSWORD });
    expect(sendJson).toHaveBeenNthCalledWith(2, 'POST', '/v1/auth/2fa/confirm', { code: '123456' });
    expect(headingText()).toBe(T.codesHeading);
    for (const recovery of CODES) expect(screen.getByText(recovery)).toBeTruthy();
    expect(screen.getByText(T.codesWarningTitle)).toBeTruthy();

    await press('two-factor-acknowledge');
    await press('two-factor-done');
    expect(headingText()).toBe(T.heading);
    expect(screen.getByText(T.enabledNotice)).toBeTruthy();
    expect(screen.queryByText(CODES[0]!)).toBeNull();
  });

  it('moves screen-reader focus to the heading on every step', async () => {
    await show();
    await press('two-factor-set-up');
    expect(headingText()).toBe(T.passwordHeading);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenLastCalledWith(expect.anything(), 'focus');

    sendJson.mockResolvedValueOnce(ENROLMENT);
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
    expect(headingText()).toBe(T.scanHeading);
    expect(focus).toHaveBeenCalledTimes(2);

    await press('two-factor-cancel');
    expect(headingText()).toBe(T.heading);
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it('keeps "Done" disabled until the box is ticked', async () => {
    await show();
    await enrolToCodes();

    const done = screen.getByTestId('two-factor-done');
    expect(done.props.accessibilityState).toMatchObject({ disabled: true });
    await press('two-factor-done');
    expect(headingText()).toBe(T.codesHeading);

    await press('two-factor-acknowledge');
    expect(screen.getByTestId('two-factor-done').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('never writes the recovery codes to the phone or the query cache', async () => {
    const set = jest.spyOn(deviceStore, 'set');
    await show();
    await enrolToCodes();
    await press('two-factor-acknowledge');
    await press('two-factor-done');

    const stored = [
      ...set.mock.calls.map(([, value]) => value),
      ...deviceStore.getAllKeys().map((key) => deviceStore.getString(key) ?? ''),
    ].join('\n');
    const cached = JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data));
    for (const recovery of CODES) {
      expect(stored).not.toContain(recovery);
      expect(cached).not.toContain(recovery);
    }
    expect(stored).not.toContain(ENROLMENT.secret);
    set.mockRestore();
  });

  it('copies all the recovery codes, under an accessible name', async () => {
    await show();
    await enrolToCodes();

    await fireEvent.press(screen.getByRole('button', { name: S.copyCodes }));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODES.join('\n'));
    // The pill says so; its accessible name stays what the button does.
    expect(screen.getByText(S.copied, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: S.copyCodes })).toBeTruthy();
  });

  it('shows the refusal and stays on the step when the code is wrong', async () => {
    await show();
    sendJson.mockResolvedValueOnce(ENROLMENT);
    await press('two-factor-set-up');
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');

    sendJson.mockRejectedValueOnce(refusal(400, 'That code is not right.'));
    await fireEvent.changeText(screen.getByTestId('two-factor-code'), '000000');
    await press('two-factor-switch-on');

    expect(screen.getByText('That code is not right.')).toBeTruthy();
    expect(headingText()).toBe(T.scanHeading);
  });
});

describe('two-factor: the scan step', () => {
  async function toScan() {
    await show();
    sendJson.mockResolvedValueOnce(ENROLMENT);
    await press('two-factor-set-up');
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
  }

  it('opens the otpauth URI in the authenticator on this phone', async () => {
    await toScan();

    expect(canOpen).toHaveBeenCalledWith(ENROLMENT.otpauthUri);
    await press('two-factor-open-app');
    expect(openURL).toHaveBeenCalledWith(ENROLMENT.otpauthUri);
    expect(screen.queryByTestId('two-factor-no-authenticator')).toBeNull();
  });

  it('says there is no authenticator on this phone rather than offering a dead button', async () => {
    canOpen.mockResolvedValue(false);
    await toScan();

    expect(screen.getByText(S.noAuthenticator)).toBeTruthy();
    expect(screen.queryByTestId('two-factor-open-app')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('draws the QR code and shows the key, its parameters and a named Copy button', async () => {
    await toScan();

    expect(screen.getByRole('image', { name: S.qrLabel })).toBeTruthy();
    expect(screen.getByText(ENROLMENT.secret).props.selectable).toBe(true);
    expect(screen.getByText('6 digits, every 30 seconds, SHA1.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: S.copyKey }));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(ENROLMENT.secret);
  });

  it('offers a one-time-code field the keyboard and autofill understand', async () => {
    await toScan();
    const field = screen.getByTestId('two-factor-code');
    expect(field.props.keyboardType).toBe('number-pad');
    expect(field.props.textContentType).toBe('oneTimeCode');
  });
});

describe('two-factor: switching it off', () => {
  it('goes to the off-path with our sentence when the service says it is already on', async () => {
    await show();
    sendJson.mockRejectedValueOnce(refusal(400, 'Two-factor authentication is already enabled.'));
    await press('two-factor-set-up');
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');

    expect(headingText()).toBe(T.disableHeading);
    expect(screen.getByText(T.alreadyEnabled)).toBeTruthy();
    expect(screen.queryByTestId('two-factor-failure')).toBeNull();
    // The password just proved is the one the off-path asks for.
    expect(screen.getByTestId('two-factor-disable-password').props.value).toBe(PASSWORD);
  });

  it('sends a recovery code in place of a generated one when that is what was typed', async () => {
    sendJson.mockResolvedValueOnce(null);
    await show();
    await press('two-factor-turn-off');
    await fireEvent.changeText(screen.getByTestId('two-factor-disable-password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('two-factor-recovery'), ' third recovery ');
    await press('two-factor-disable-submit');

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/auth/2fa/disable', {
      password: PASSWORD,
      recoveryCode: 'third recovery',
    });
    expect(headingText()).toBe(T.heading);
    expect(screen.getByText(T.disabledNotice)).toBeTruthy();
  });

  it('sends the generated code otherwise', async () => {
    sendJson.mockResolvedValueOnce(null);
    await show();
    await press('two-factor-turn-off');
    await fireEvent.changeText(screen.getByTestId('two-factor-disable-password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('two-factor-disable-code'), '654321');
    await press('two-factor-disable-submit');

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/auth/2fa/disable', {
      password: PASSWORD,
      code: '654321',
    });
  });
});

describe('the security screen', () => {
  it('offline: two-factor waits for a connection, and the notice says the lock does not', async () => {
    setOnline(false);
    await show();

    expect(screen.getByText(S.offline)).toBeTruthy();
    expect(screen.queryByText(en.mobile.settings.offline)).toBeNull();

    await press('two-factor-set-up');
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    expect(screen.getByTestId('two-factor-continue').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await press('two-factor-continue');
    expect(sendJson).not.toHaveBeenCalled();

    // The lock is this phone's and works offline.
    const lock = await screen.findByRole('switch', { name: en.mobile.lock.fingerprint });
    expect(lock.props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('holds two-factor first and the app lock under it', async () => {
    await show();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf(T.heading)).toBeLessThan(tree.indexOf(S.appLockTitle));
  });

  it('sends a signed-out reader to sign in, and back here after', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/security' },
    });
    expect(screen.queryByTestId('two-factor')).toBeNull();
  });
});
