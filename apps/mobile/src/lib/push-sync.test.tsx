import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { markNotificationRead } from '../features/notifications/api';
import type { SessionState } from './account';
import { syncPushRegistration } from './push';
import { PushSync } from './push-sync';
import { forgetHandledResponses } from './push-taps';

/**
 * Push at the root (#160): registration without a prompt at launch and foreground, never while
 * signed out; a foreground push refreshing the inbox; a tapped push routed once.
 */

// eslint-disable-next-line no-var
var mockState: SessionState;
// eslint-disable-next-line no-var
var mockLast: Notifications.NotificationResponse | null;
// eslint-disable-next-line no-var
var mockTapped: ((response: Notifications.NotificationResponse) => void) | undefined;
// eslint-disable-next-line no-var
var mockReceived: (() => void) | undefined;

jest.mock('./account', () => ({
  ACCOUNT_KEYS: { me: ['me'], unread: ['unread'] },
  canReadAccount: (session: { signedIn: boolean }) => session.signedIn,
  useSessionState: () => mockState,
}));
jest.mock('./use-session', () => ({
  useSession: () => ({ signedIn: mockState === 'signed-in', locked: false, unlocked: false }),
}));
jest.mock('./push', () => ({ syncPushRegistration: jest.fn(async () => 'registered') }));
jest.mock('../features/notifications/api', () => ({ markNotificationRead: jest.fn(async () => ({})) }));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn(async () => mockLast),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockTapped = listener;
    return { remove: () => undefined };
  },
  addNotificationReceivedListener: (listener: () => void) => {
    mockReceived = listener;
    return { remove: () => undefined };
  },
}));

jest.setTimeout(20_000);

const sync = jest.mocked(syncPushRegistration);
const markRead = jest.mocked(markNotificationRead);
const HOST = 'ideanest.az';

function response(identifier: string, data: Record<string, unknown>): Notifications.NotificationResponse {
  return {
    notification: { date: 1, request: { identifier, content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

let foreground: ((state: AppStateStatus) => void) | undefined;
let client: QueryClient;
const onOpen = jest.fn();

async function mount() {
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  client = new QueryClient();
  jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = await render(<PushSync siteHost={HOST} onOpen={onOpen} />, { wrapper });
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  forgetHandledResponses();
  mockState = 'signed-in';
  mockLast = null;
  mockTapped = undefined;
  mockReceived = undefined;
  foreground = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('registration', () => {
  it('makes no call on launch while signed out, nor on a foreground', async () => {
    mockState = 'signed-out';
    await mount();
    await act(async () => foreground?.('active'));

    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs once on a signed-in cold start, and again on every foreground', async () => {
    const view = await mount();
    expect(sync).toHaveBeenCalledTimes(1);

    await view.rerender(<PushSync siteHost={HOST} onOpen={onOpen} />);
    await act(async () => {});
    expect(sync).toHaveBeenCalledTimes(1);

    await act(async () => foreground?.('background'));
    await act(async () => foreground?.('active'));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('waits while the account is unknown — the lock, or no answer yet', async () => {
    mockState = 'unknown';
    await mount();
    await act(async () => foreground?.('active'));

    expect(sync).not.toHaveBeenCalled();
  });
});

describe('a push arriving in the foreground', () => {
  it('refreshes the unread count and the inbox', async () => {
    await mount();
    await act(async () => mockReceived?.());

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['unread'] });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });
  });
});

describe('a tapped push', () => {
  it('opens a campaign, the device list, and the inbox for a push with no destination', async () => {
    await mount();
    await act(async () => mockTapped?.(response('t-1', { url: 'ideanest://projects/a/b' })));
    await act(async () => mockTapped?.(response('t-2', { url: 'ideanest://settings/sessions' })));
    await act(async () => mockTapped?.(response('t-3', { url: 'ideanest://' })));

    expect(onOpen.mock.calls.map(([destination]) => destination)).toEqual([
      { pathname: '/projects/a/b' },
      { pathname: '/settings/sessions' },
      { pathname: '/notifications' },
    ]);
  });

  it('ignores a foreign host and a non-string url', async () => {
    await mount();
    await act(async () => mockTapped?.(response('t-1', { url: 'https://evil.example/projects/a/b' })));
    await act(async () => mockTapped?.(response('t-2', { url: ['ideanest://projects/a/b'] })));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the named inbox row read and refreshes the count', async () => {
    await mount();
    await act(async () => mockTapped?.(response('t-1', { url: 'ideanest://projects/a/b', notificationId: 'n-1' })));
    await act(async () => {});

    expect(markRead).toHaveBeenCalledWith('n-1');
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['unread'] });
  });

  it('handles the tap that launched the app once, across remounts', async () => {
    mockLast = response('cold', { url: 'ideanest://projects/a/b', notificationId: 'n-9' });
    const first = await mount();
    await first.unmount();
    await mount();
    // The listener reporting the same response does not open it a second time either.
    await act(async () => mockTapped?.(mockLast!));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});
