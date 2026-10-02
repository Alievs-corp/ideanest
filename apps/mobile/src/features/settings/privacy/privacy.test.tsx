import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as Sharing from 'expo-sharing';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../../api/client';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { PrivacySettingsScreen } from './privacy-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();
const mockPublicGet = jest.fn();
const mockFiles = new Map<string, string>();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../../api/client', () => ({
  api: () => ({ get: mockGet }),
  publicApi: () => ({ get: mockPublicGet }),
  sendJson: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  Directory: class {
    readonly uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}${name}/`;
    }
    get exists(): boolean {
      return [...mockFiles.keys()].some((uri) => uri.startsWith(this.uri));
    }
    create(): void {}
    delete(): void {
      for (const uri of [...mockFiles.keys()]) if (uri.startsWith(this.uri)) mockFiles.delete(uri);
    }
  },
  File: class {
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
    create(): void {
      mockFiles.set(this.uri, '');
    }
    write(contents: string): void {
      mockFiles.set(this.uri, contents);
    }
    delete(): void {
      mockFiles.delete(this.uri);
    }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
const isAvailableAsync = jest.mocked(Sharing.isAvailableAsync);
const shareAsync = jest.mocked(Sharing.shareAsync);
const V = en.profile.editor.visibility;
const X = en.settings.panels.export;
const C = en.settings.panels.closure;
const M = en.mobile.settings.privacy;
const EXPORT_URI = 'file:///cache/account-export/ideanest-account.json';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Me = { slug?: string; deletionScheduledAt?: string; email?: string };
let me: Me;
let visitorSees: 'PUBLIC' | 'PRIVATE' | 'BROKEN';

function refusal(status: number, detail?: string): ApiError {
  return new ApiError(status, {
    type: 'about:blank',
    title: 'Refused',
    status,
    ...(detail === undefined ? {} : { detail }),
  });
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
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
          <PrivacySettingsScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function stateOf(testID: string): { checked?: boolean | 'mixed'; disabled?: boolean } {
  return screen.getByTestId(testID).props.accessibilityState ?? {};
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  mockFiles.clear();
  me = { slug: 'aysel', email: 'aysel@example.com' };
  visitorSees = 'PUBLIC';
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/v1/me') return me;
    if (path === '/v1/me/export') return { format: 'ideanest-account/1', account: { slug: 'aysel' } };
    throw new Error(`unexpected read ${path}`);
  });
  mockPublicGet.mockImplementation(async () => {
    if (visitorSees === 'PUBLIC') return { slug: 'aysel' };
    throw refusal(visitorSees === 'PRIVATE' ? 404 : 500);
  });
  isAvailableAsync.mockResolvedValue(true);
  shareAsync.mockResolvedValue(undefined);
  sendJson.mockResolvedValue(null);
});

it('draws visibility, then the export, then the closure', async () => {
  await show();
  const order = screen
    .getAllByTestId(/^privacy-(visibility|export|closure)$/)
    .map((node) => node.props.testID as string);
  expect(order).toEqual(['privacy-visibility', 'privacy-export', 'privacy-closure']);
});

describe('visibility', () => {
  it('reads the position through the anonymous client and links to the public profile', async () => {
    await show();

    expect(mockPublicGet).toHaveBeenCalledWith(
      '/v1/users/{slug}',
      expect.objectContaining({ path: { slug: 'aysel' } }),
    );
    // The session client is never asked: with the bearer, the owner always sees their own profile.
    expect(mockGet).not.toHaveBeenCalledWith('/v1/users/{slug}', expect.anything());
    expect(stateOf('privacy-visibility-switch')).toMatchObject({ checked: true, disabled: false });
    expect(screen.getByText(V.public)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('privacy-visibility-profile'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[slug]', params: { slug: 'aysel' } });
  });

  it('writes the new position and confirms it by asking as a stranger again', async () => {
    await show();
    visitorSees = 'PRIVATE';
    await fireEvent.press(screen.getByTestId('privacy-visibility-switch'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('PATCH', '/v1/me/profile-visibility', { visibility: 'PRIVATE' });
    expect(mockPublicGet).toHaveBeenCalledTimes(2);
    expect(stateOf('privacy-visibility-switch')).toMatchObject({ checked: false });
    expect(screen.getByText(V.hidden)).toBeTruthy();
    expect(screen.queryByTestId('privacy-visibility-profile')).toBeNull();
  });

  it('moves back and says so when the write is refused', async () => {
    sendJson.mockRejectedValueOnce(refusal(403));
    await show();
    await fireEvent.press(screen.getByTestId('privacy-visibility-switch'));
    await settle();

    expect(stateOf('privacy-visibility-switch')).toMatchObject({ checked: true });
    expect(screen.getByText(V.failedTitle)).toBeTruthy();
  });

  it('disables the switch with a warning when what a visitor sees cannot be read', async () => {
    visitorSees = 'BROKEN';
    await show();

    expect(stateOf('privacy-visibility-switch')).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText(V.unknownTitle)).toBeTruthy();
    expect(screen.getByText(M.visibility.unknownBody)).toBeTruthy();

    visitorSees = 'PRIVATE';
    await fireEvent.press(screen.getByTestId('privacy-visibility-retry'));
    await settle();
    expect(stateOf('privacy-visibility-switch')).toMatchObject({ checked: false, disabled: false });
  });

  it('goes to unknown, not to the hoped-for position, when the write cannot be confirmed', async () => {
    await show();
    visitorSees = 'BROKEN';
    await fireEvent.press(screen.getByTestId('privacy-visibility-switch'));
    await settle();

    expect(stateOf('privacy-visibility-switch')).toMatchObject({ disabled: true });
    expect(screen.getByTestId('privacy-visibility-unknown')).toBeTruthy();
  });
});

describe('export', () => {
  it('hands the file to the share sheet, deletes it afterwards and says where to look', async () => {
    let shared: string | undefined;
    shareAsync.mockImplementation(async (uri) => {
      shared = mockFiles.get(uri);
    });
    await show();
    await fireEvent.press(screen.getByTestId('privacy-export-download'));
    await settle();

    expect(shareAsync).toHaveBeenCalledWith(EXPORT_URI, expect.anything());
    expect(JSON.parse(shared ?? '')).toEqual({ format: 'ideanest-account/1', account: { slug: 'aysel' } });
    expect(mockFiles.has(EXPORT_URI)).toBe(false);
    expect(screen.getByText(M.export.sharedTitle)).toBeTruthy();
    expect(screen.getByText('ideanest-account.json')).toBeTruthy();
    // iOS (the test platform) deletes at once, and the notice says so — never that it was sent.
    expect(screen.getByText(/has been removed/)).toBeTruthy();
  });

  it('says the share sheet would not open, not that the connection failed', async () => {
    shareAsync.mockRejectedValueOnce(new Error('activity failed'));
    await show();
    await fireEvent.press(screen.getByTestId('privacy-export-download'));
    await settle();

    expect(screen.getByText(M.export.shareFailed)).toBeTruthy();
    expect(screen.queryByText(en.auth.failures.unreachableDetail)).toBeNull();
    expect(mockFiles.has(EXPORT_URI)).toBe(false);
  });

  it('sweeps an export an earlier visit left behind when the screen opens', async () => {
    mockFiles.set(EXPORT_URI, 'left for a Bluetooth transfer');
    await show();
    expect(mockFiles.has(EXPORT_URI)).toBe(false);
  });

  it('shows the rate limit rather than retrying into it', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/v1/me') return me;
      throw refusal(429);
    });
    await show();
    await fireEvent.press(screen.getByTestId('privacy-export-download'));
    await settle();

    expect(screen.getByText(X.errorTitle)).toBeTruthy();
    expect(screen.getByText(X.rateLimited)).toBeTruthy();
    expect(shareAsync).not.toHaveBeenCalled();
    expect(mockGet.mock.calls.filter(([path]) => path === '/v1/me/export')).toHaveLength(1);
  });

  it('asks for nothing when this phone has no share sheet', async () => {
    isAvailableAsync.mockResolvedValue(false);
    await show();
    await fireEvent.press(screen.getByTestId('privacy-export-download'));
    await settle();

    expect(screen.getByText(M.export.unavailable)).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalledWith('/v1/me/export', expect.anything());
  });
});

describe('closure', () => {
  it('keeps Close disabled until the box is ticked, then schedules it and re-reads the account', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'a long password');
    expect(stateOf('privacy-closure-submit')).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByTestId('privacy-closure-understood'));
    expect(stateOf('privacy-closure-submit')).toMatchObject({ disabled: false });

    me = { ...me, deletionScheduledAt: '2026-11-01T10:00:00Z' };
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/me/deletion', { password: 'a long password' });
    expect(mockGet.mock.calls.filter(([path]) => path === '/v1/me').length).toBeGreaterThan(1);
    expect(screen.getByTestId('privacy-closure-scheduled')).toBeTruthy();
    expect(screen.getByText(C.scheduledTitle)).toBeTruthy();
  });

  it('shows the scheduled date and keeps the account without asking for the password', async () => {
    me = { ...me, deletionScheduledAt: '2026-11-01T10:00:00Z' };
    await show();

    expect(screen.getByText(/It will be anonymised on .*2026/)).toBeTruthy();
    expect(screen.queryByTestId('privacy-closure-password')).toBeNull();

    me = { slug: 'aysel' };
    await fireEvent.press(screen.getByTestId('privacy-closure-keep'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('DELETE', '/v1/me/deletion');
    expect(screen.getByTestId('privacy-closure-submit')).toBeTruthy();
  });

  it('shows the schedule the service answered when the account cannot be re-read, and says so', async () => {
    await show();
    sendJson.mockResolvedValueOnce({ requestedAt: '2026-10-02T10:00:00Z', scheduledFor: '2026-11-01T10:00:00Z' });
    let readable = false;
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/v1/me' && !readable) throw refusal(503);
      return { ...me, deletionScheduledAt: '2026-11-01T10:00:00Z' };
    });
    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'a long password');
    await fireEvent.press(screen.getByTestId('privacy-closure-understood'));
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    await settle();

    // At once, from the 202 — not the form again over an account that is closing.
    expect(screen.getByTestId('privacy-closure-scheduled')).toBeTruthy();
    expect(screen.getByText(/It will be anonymised on .*2026/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('privacy-closure-reread-failed')).toBeTruthy(), {
      timeout: 15_000,
    });
    expect(screen.queryByTestId('privacy-closure-submit')).toBeNull();

    readable = true;
    await fireEvent.press(screen.getByTestId('privacy-closure-reread'));
    await settle();
    expect(screen.queryByTestId('privacy-closure-reread-failed')).toBeNull();
    expect(screen.getByTestId('privacy-closure-scheduled')).toBeTruthy();
  });

  it('shows the form after Keep even when the account cannot be re-read, and says so', async () => {
    me = { ...me, deletionScheduledAt: '2026-11-01T10:00:00Z' };
    await show();
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/v1/me') throw refusal(503);
      return null;
    });
    await fireEvent.press(screen.getByTestId('privacy-closure-keep'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('DELETE', '/v1/me/deletion');
    expect(screen.getByTestId('privacy-closure-submit')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('privacy-closure-reread-failed')).toBeTruthy(), {
      timeout: 15_000,
    });
    expect(screen.queryByTestId('privacy-closure-scheduled')).toBeNull();
  });

  it('says the account is already gone on a 404 rather than reporting a closure', async () => {
    sendJson.mockRejectedValueOnce(refusal(404));
    await show();
    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'a long password');
    await fireEvent.press(screen.getByTestId('privacy-closure-understood'));
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    await settle();

    expect(screen.getByText(C.goneTitle)).toBeTruthy();
    expect(screen.queryByTestId('privacy-closure-scheduled')).toBeNull();
  });

  it('shows the service’s words for a wrong password, and the rate limit', async () => {
    sendJson.mockRejectedValueOnce(refusal(403, 'That password is not right.'));
    sendJson.mockRejectedValueOnce(refusal(429));
    await show();
    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'the wrong one');
    await fireEvent.press(screen.getByTestId('privacy-closure-understood'));
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    await settle();
    expect(screen.getByText('That password is not right.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'another try');
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    await settle();
    expect(screen.getByText(C.rateLimited)).toBeTruthy();
  });
});

describe('states', () => {
  it('draws a skeleton while the account loads', async () => {
    mockGet.mockImplementation(() => new Promise(() => undefined));
    await show();
    expect(screen.getByTestId('privacy-loading')).toBeTruthy();
    expect(screen.getByLabelText(M.loading)).toBeTruthy();
  });

  it('offers Try again when the account cannot be read', async () => {
    let failing = true;
    mockGet.mockImplementation(async (path: string) => {
      if (failing) throw refusal(500);
      return path === '/v1/me' ? me : null;
    });
    await show();
    // `useMe` backs off three times before it gives up (lib/account.ts `retryMe`).
    await waitFor(() => expect(screen.getByText(M.loadFailedTitle)).toBeTruthy(), { timeout: 15_000 });

    failing = false;
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('privacy-closure')).toBeTruthy();
  });

  it('waits for the app lock to be opened, and Try again asks for it', async () => {
    mockSession = { signedIn: true, locked: true, unlocked: false };
    await show();
    expect(mockGet).not.toHaveBeenCalledWith('/v1/me', expect.anything());
    expect(screen.getByTestId('privacy-load-failed')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('privacy-visibility')).toBeTruthy();
  });

  it('disables every action while offline', async () => {
    await show();
    await act(async () => setOnline(false));
    await fireEvent.changeText(screen.getByTestId('privacy-closure-password'), 'a long password');
    await fireEvent.press(screen.getByTestId('privacy-closure-understood'));

    expect(screen.getByTestId('settings-offline')).toBeTruthy();
    expect(stateOf('privacy-visibility-switch')).toMatchObject({ disabled: true });
    expect(stateOf('privacy-export-download')).toMatchObject({ disabled: true });
    expect(stateOf('privacy-closure-submit')).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('privacy-export-download'));
    await fireEvent.press(screen.getByTestId('privacy-closure-submit'));
    expect(sendJson).not.toHaveBeenCalled();
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it('sends a signed-out reader to sign in, and back here after', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/privacy' },
    });
    expect(screen.queryByTestId('privacy-closure')).toBeNull();
  });
});
