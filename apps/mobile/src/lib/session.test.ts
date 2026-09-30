import * as SecureStore from 'expo-secure-store';
import {
  currentAccessToken,
  disableLock,
  enableLock,
  endSession,
  hasStoredSession,
  isLocked,
  lockNow,
  rememberAccessToken,
  storeRefreshToken,
  storedRefreshToken,
  subscribeToSession,
  useFlagStore,
} from './session';
import { memoryStore } from './storage';

/**
 * The session on a phone, and the biometric gate over it (§4.12 MB-03).
 *
 * <p>Everything here is a property whose absence costs somebody either their
 * session or the protection they turned on:
 *
 * <ul>
 *   <li>{@link presenceIsAnsweredWithoutTheKeychain} — the reason the tabs do not
 *       show a biometric prompt on a cold start.
 *   <li>The lock moves the token and leaves exactly one entry. Two entries is a
 *       readable copy of a credential somebody asked to have locked away.
 *   <li>A dismissed prompt leaves the session intact. "Not now" must not mean
 *       "sign in again".
 * </ul>
 *
 * <p>The keychain double lives in `jest.setup.ts` and is keyed by service as
 * well as key, which is what makes the "exactly one entry" assertion mean
 * anything.
 */

const keychain = SecureStore as unknown as {
  __setBiometryAllowed: (allowed: boolean) => void;
  __reset: () => void;
  __entries: () => string[];
};

beforeEach(() => {
  keychain.__reset();
  // Module state, and a test that inherited another test's flags would pass for
  // the wrong reason.
  useFlagStore(memoryStore());
  rememberAccessToken(null);
});

describe('a session on this device', () => {
  it('is answered without touching the keychain', async () => {
    expect(hasStoredSession()).toBe(false);

    await storeRefreshToken('refresh-1');

    expect(hasStoredSession()).toBe(true);
    expect(isLocked()).toBe(false);
    /*
     * The point of the assertion: `hasStoredSession` is synchronous. A screen
     * can read it during its first render, which is what stops the Saved tab
     * flashing a sign-in prompt — and, with the lock on, what stops it showing a
     * Face ID sheet to somebody who only opened a tab.
     */
    expect(await storedRefreshToken()).toBe('refresh-1');
  });

  it('forgets both halves when the session ends', async () => {
    await storeRefreshToken('refresh-1');
    rememberAccessToken('access-1');

    await endSession();

    expect(hasStoredSession()).toBe(false);
    expect(currentAccessToken()).toBeNull();
    expect(keychain.__entries()).toEqual([]);
  });

  it('corrects itself when the keychain disagrees with the flag', async () => {
    await storeRefreshToken('refresh-1');
    // What a restored backup looks like from here: MMKV came back and the
    // keychain did not.
    keychain.__reset();

    expect(await storedRefreshToken()).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });
});

describe('§4.12 MB-03: the biometric lock', () => {
  it('moves the token behind the gate and leaves nothing readable', async () => {
    await storeRefreshToken('refresh-1');

    expect(await enableLock()).toBe(true);

    expect(isLocked()).toBe(true);
    expect(keychain.__entries()).toEqual(['az.ideanest.app.locked:ideanest.refresh-token.locked']);
    expect(await storedRefreshToken()).toBe('refresh-1');
  });

  it('refuses the token when the prompt is dismissed, and keeps the session', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();

    keychain.__setBiometryAllowed(false);

    expect(await storedRefreshToken()).toBeNull();
    // The whole difference between a lock and a sign-out: the session is still
    // here, and the next successful prompt opens it.
    expect(hasStoredSession()).toBe(true);
    expect(isLocked()).toBe(true);

    keychain.__setBiometryAllowed(true);
    expect(await storedRefreshToken()).toBe('refresh-1');
  });

  it('cannot be turned off without passing the prompt', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();
    keychain.__setBiometryAllowed(false);

    expect(await disableLock()).toBe(false);

    // Still locked. Somebody holding a phone they did not unlock must not be
    // able to remove the thing stopping them.
    expect(isLocked()).toBe(true);
  });

  it('moves the token back out, and leaves nothing behind the gate', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();

    expect(await disableLock()).toBe(true);

    expect(isLocked()).toBe(false);
    expect(keychain.__entries()).toEqual([':ideanest.refresh-token']);
    expect(await storedRefreshToken()).toBe('refresh-1');
  });

  it('is not turned on when there is no session to lock', async () => {
    expect(await enableLock()).toBe(false);
    expect(isLocked()).toBe(false);
  });

  it('signs out without asking anybody to prove who they are', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();
    keychain.__setBiometryAllowed(false);

    await endSession();

    expect(hasStoredSession()).toBe(false);
    expect(keychain.__entries()).toEqual([]);
  });

  it('re-arms the gate by dropping the access token, and does nothing when off', () => {
    rememberAccessToken('access-1');
    lockNow();
    expect(currentAccessToken()).toBe('access-1');
  });

  it('re-arms the gate when the lock is on', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();
    rememberAccessToken('access-1');

    lockNow();

    // Nothing is revoked and nothing is deleted; the next private read simply
    // has to go through the keychain again, which is the prompt.
    expect(currentAccessToken()).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });
});

describe('subscribers', () => {
  it('are told when the session changes', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToSession(listener);

    await storeRefreshToken('refresh-1');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    await endSession();
    expect(listener).not.toHaveBeenCalled();
  });
});
