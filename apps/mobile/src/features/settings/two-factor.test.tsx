import { AccessibilityInfo, BackHandler, Linking } from 'react-native';
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

/** Every `<Stack.Screen options>` the screen renders, in order: the last one is what applies. */
const mockScreenOptions: Record<string, unknown>[] = [];
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, {
    Screen: ({ options }: { options?: Record<string, unknown> }) => {
      if (options !== undefined) mockScreenOptions.push(options);
      return null;
    },
  }),
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

/**
 * Whether `target` — what was handed to `sendAccessibilityEvent` — is the host view the step
 * heading is drawn in: the one node carrying the heading's testID and the header role, and the
 * one on screen now. Checked through its props rather than with `toHaveBeenCalledWith`, whose
 * failure message would try to print the whole renderer graph hanging off a host node.
 */
function isHeadingNode(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false;
  const props = (target as { props?: Record<string, unknown> }).props;
  const onScreen = screen.getByTestId('two-factor-heading');
  return (
    props?.testID === 'two-factor-heading' &&
    props.accessibilityRole === 'header' &&
    props.accessible === true &&
    onScreen.props.accessibilityRole === 'header'
  );
}

/** The navigation options the two-factor card set last: whether the screen may be left. */
function leaveOptions(): Record<string, unknown> | undefined {
  return [...mockScreenOptions].reverse().find((options) => 'gestureEnabled' in options);
}

/** Android's back button: true when the screen consumed it. */
function pressAndroidBack(): boolean {
  const handler = backHandlers.at(-1);
  if (handler === undefined) throw new Error('no hardwareBackPress listener');
  return handler() === true;
}

let canOpen: jest.SpyInstance;
let openURL: jest.SpyInstance;
let focus: jest.SpyInstance;
let backHandlers: (() => boolean | null | undefined)[];
let listen: jest.SpyInstance;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: true };
  mockScreenOptions.length = 0;
  setOnline(true);
  canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  backHandlers = [];
  listen = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'hardwareBackPress') backHandlers.push(handler as () => boolean | null | undefined);
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  canOpen.mockRestore();
  openURL.mockRestore();
  focus.mockRestore();
  listen.mockRestore();
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

  /** Focus moved once more, onto the heading's host node, which now reads `words`. */
  function expectFocusOnHeading(times: number, words: string) {
    expect(headingText()).toBe(words);
    expect(focus).toHaveBeenCalledTimes(times);
    const [target, event] = focus.mock.lastCall ?? [];
    expect(isHeadingNode(target)).toBe(true);
    expect(event).toBe('focus');
  }

  it('moves screen-reader focus to the step heading on every step of switching it on', async () => {
    await show();
    await press('two-factor-set-up');
    expectFocusOnHeading(1, T.passwordHeading);

    sendJson.mockResolvedValueOnce(ENROLMENT).mockResolvedValueOnce({ recoveryCodes: CODES });
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
    expectFocusOnHeading(2, T.scanHeading);

    await fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
    await press('two-factor-switch-on');
    expectFocusOnHeading(3, T.codesHeading);

    await press('two-factor-acknowledge');
    expect(focus).toHaveBeenCalledTimes(3);
    await press('two-factor-done');
    expectFocusOnHeading(4, T.heading);
  });

  it('moves focus to the heading on the way to switching it off, and back', async () => {
    await show();
    await press('two-factor-turn-off');
    expectFocusOnHeading(1, T.disableHeading);

    await press('two-factor-cancel');
    expectFocusOnHeading(2, T.heading);
  });

  it('moves focus to the off-path heading when the service says it is already on', async () => {
    await show();
    await press('two-factor-set-up');
    expectFocusOnHeading(1, T.passwordHeading);

    sendJson.mockRejectedValueOnce(refusal(400, 'Two-factor authentication is already enabled.'));
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
    expectFocusOnHeading(2, T.disableHeading);
  });

  it('leaves focus where it is on a refusal that keeps the step', async () => {
    await show();
    await press('two-factor-set-up');
    sendJson.mockRejectedValueOnce(refusal(400, 'The password is not right.'));
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
    // Only the error summary takes focus, not the heading a second time.
    expect(focus.mock.calls.filter(([node]) => isHeadingNode(node))).toHaveLength(1);
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

describe('two-factor: leaving the screen', () => {
  it('may be left freely while nothing is pending', async () => {
    await show();
    expect(leaveOptions()).toEqual({ gestureEnabled: true, headerBackVisible: true });
    expect(pressAndroidBack()).toBe(false);
  });

  it('cannot be left while "Switch it on" is in flight, or the codes would never be seen', async () => {
    await show();
    sendJson.mockResolvedValueOnce(ENROLMENT);
    await press('two-factor-set-up');
    await fireEvent.changeText(screen.getByTestId('two-factor-password'), PASSWORD);
    await press('two-factor-continue');
    expect(pressAndroidBack()).toBe(false);

    let answer: (value: unknown) => void = () => undefined;
    sendJson.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
    await press('two-factor-switch-on');

    // In flight: no iOS swipe, no header back, and Android's back button is consumed.
    expect(leaveOptions()).toEqual({ gestureEnabled: false, headerBackVisible: false });
    expect(pressAndroidBack()).toBe(true);
    expect(mockRouter.back).not.toHaveBeenCalled();

    await act(async () => answer({ recoveryCodes: CODES }));
    await settle();
    expect(headingText()).toBe(T.codesHeading);
  });

  it('cannot be left from the codes until they are acknowledged and Done is pressed', async () => {
    await show();
    await enrolToCodes();
    expect(leaveOptions()).toEqual({ gestureEnabled: false, headerBackVisible: false });
    expect(pressAndroidBack()).toBe(true);

    await press('two-factor-acknowledge');
    // Ticking the box is not leaving the step: Done is still the only way off.
    expect(pressAndroidBack()).toBe(true);
    expect(leaveOptions()).toEqual({ gestureEnabled: false, headerBackVisible: false });

    await press('two-factor-done');
    expect(leaveOptions()).toEqual({ gestureEnabled: true, headerBackVisible: true });
    expect(pressAndroidBack()).toBe(false);
  });

  it('cannot be left while turning it off is in flight', async () => {
    await show();
    await press('two-factor-turn-off');
    sendJson.mockReturnValueOnce(new Promise(() => undefined));
    await fireEvent.changeText(screen.getByTestId('two-factor-disable-password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('two-factor-disable-code'), '654321');
    await press('two-factor-disable-submit');
    expect(leaveOptions()).toEqual({ gestureEnabled: false, headerBackVisible: false });
    expect(pressAndroidBack()).toBe(true);
  });
});

describe('two-factor: copying', () => {
  it('says so, as a danger alert a screen reader hears, when the codes could not be copied', async () => {
    jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
    const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    await show();
    await enrolToCodes();

    await fireEvent.press(screen.getByRole('button', { name: S.copyCodes }));
    await settle();

    expect(screen.getByTestId('two-factor-copy-codes-failed')).toBeTruthy();
    expect(screen.getByText(S.copyFailed)).toBeTruthy();
    // iOS has no live regions: the danger alert speaks through an assertive announcement.
    expect(said).toHaveBeenCalledWith(S.copyFailed, { queue: false });
    expect(screen.queryByText(S.copied, { includeHiddenElements: true })).toBeNull();
    said.mockRestore();
  });

  it('a thrown clipboard error is the same failure', async () => {
    jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('denied'));
    await show();
    await enrolToCodes();
    await fireEvent.press(screen.getByRole('button', { name: S.copyCodes }));
    await settle();
    expect(screen.getByTestId('two-factor-copy-codes-failed')).toBeTruthy();
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
