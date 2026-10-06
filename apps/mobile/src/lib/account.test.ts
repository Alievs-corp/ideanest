import * as SecureStore from 'expo-secure-store';
import { ApiError } from '@ideanest/api-client';
import {
  NoCredentialError,
  badgeText,
  canReadAccount,
  fetchMe,
  fetchUnreadCount,
  sessionStateOf,
  type Me,
} from './account';
import {
  enableLock,
  hasStoredSession,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from './session';
import { memoryStore } from './storage';

const me = { id: 'a', name: 'Aysel' } as Me;

describe('sessionStateOf', () => {
  it('is signed out with no token, whatever the cache holds', () => {
    expect(sessionStateOf({ hasToken: false, me })).toBe('signed-out');
  });

  it('is unknown while the account has not been read or the read failed', () => {
    expect(sessionStateOf({ hasToken: true, me: undefined })).toBe('unknown');
  });

  it('is signed out when the service says nobody is there', () => {
    expect(sessionStateOf({ hasToken: true, me: null })).toBe('signed-out');
  });

  it('is signed in when the account came back', () => {
    expect(sessionStateOf({ hasToken: true, me })).toBe('signed-in');
  });

  it('is unknown behind a lock nobody has opened, even with the account in the cache', () => {
    // Signed in would enable the unread-count read, which is a prompt nobody asked for.
    expect(sessionStateOf({ hasToken: true, canRead: false, me })).toBe('unknown');
    expect(sessionStateOf({ hasToken: true, canRead: false, me: null })).toBe('unknown');
  });
});

describe('canReadAccount', () => {
  it('reads without a lock, or once the lock has been opened in this process', () => {
    expect(canReadAccount({ signedIn: true, locked: false, unlocked: false })).toBe(true);
    expect(canReadAccount({ signedIn: true, locked: true, unlocked: true })).toBe(true);
  });

  it('waits behind a lock nobody has opened, and reads nothing for nobody', () => {
    expect(canReadAccount({ signedIn: true, locked: true, unlocked: false })).toBe(false);
    expect(canReadAccount({ signedIn: false, locked: false, unlocked: false })).toBe(false);
  });
});

describe('badgeText', () => {
  it('draws nothing at zero, the number up to nine and 9+ above', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
    expect(badgeText(250)).toBe('9+');
  });
});

describe('fetchMe', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function answer(status: number, body: unknown = {}): void {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
  }

  const keychain = SecureStore as unknown as {
    __setBiometryAllowed: (allowed: boolean) => void;
    __reset: () => void;
  };

  beforeEach(() => {
    keychain.__reset();
    useFlagStore(memoryStore());
    rememberAccessToken(null);
  });

  it('turns 401 and 404 into "nobody" and lets a 500 through', async () => {
    answer(401);
    await expect(fetchMe()).resolves.toBeNull();
    answer(404);
    await expect(fetchMe()).resolves.toBeNull();
    answer(500);
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError);
  });

  it('does NOT read a 401 as "nobody" when the prompt was dismissed and no bearer went out', async () => {
    await storeRefreshToken('refresh-1');
    expect(await enableLock()).toBe(true);
    rememberAccessToken(null); // the lock re-armed
    keychain.__setBiometryAllowed(false); // …and the reader said "not now"
    answer(401);

    await expect(fetchMe()).rejects.toBeInstanceOf(NoCredentialError);
    // "Not now" must not mean "sign in again": the session is still on the phone.
    expect(hasStoredSession()).toBe(true);
  });

  it('still reads a 401 to a presented bearer as "nobody"', async () => {
    await storeRefreshToken('refresh-1');
    rememberAccessToken('access-1');
    answer(401);

    await expect(fetchMe()).resolves.toBeNull();
  });

  it('reads the unread count from a one-row page of the inbox', async () => {
    rememberAccessToken('access-1');
    answer(200, { notifications: [], unreadCount: 12 });

    await expect(fetchUnreadCount()).resolves.toBe(12);
    const url = new URL(String(jest.mocked(global.fetch).mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/v1/me/notifications');
    expect(url.searchParams.get('limit')).toBe('1');
  });
});
