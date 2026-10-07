import * as SecureStore from 'expo-secure-store';
import { checkPin, failedPinAttempts, hasPin, recordFailedAttempt } from './pin';
import {
  currentAccessToken,
  disableLock,
  enableLock,
  endSession,
  hasStoredSession,
  isLockOn,
  isPinRequired,
  migrateLegacyLock,
  needsLockMigration,
  rememberAccessToken,
  storeRefreshToken,
  storedRefreshToken,
  subscribeToSession,
  useFlagStore,
} from './session';
import { memoryStore, type KeyValueStore } from './storage';

/**
 * The session on a phone, and the flags of the app lock in front of it (§4.12 MB-03, #319).
 *
 * <ul>
 *   <li>Presence is answered without the keychain, so a tab never waits for it.</li>
 *   <li>No read of the token ever asks for a prompt — the cause of #319's double prompt.</li>
 *   <li>A pre-#319 locked session is migrated with one prompt, and no failure order loses it.</li>
 *   <li>Signing out takes the PIN and its counter with the session.</li>
 * </ul>
 */

const keychain = SecureStore as unknown as {
  __setBiometryAllowed: (allowed: boolean) => void;
  __setReadsFail: (fail: boolean) => void;
  __setWritesFail: (fail: boolean) => void;
  __setDeletesFail: (fail: boolean) => void;
  __put: (key: string, value: string, service?: string) => void;
  __reads: () => { key: string; options?: Record<string, unknown> }[];
  __reset: () => void;
  __entries: () => string[];
};

const ORDINARY = ':ideanest.refresh-token';
const LEGACY_KEY = 'ideanest.refresh-token.locked';
const LEGACY_SERVICE = 'az.ideanest.app.locked';

let flags: KeyValueStore;

beforeEach(() => {
  keychain.__reset();
  flags = memoryStore();
  useFlagStore(flags);
  rememberAccessToken(null);
});

/** A phone as a pre-#319 build left it with the lock on: the token behind the prompt only. */
function legacyLockedInstall(token = 'refresh-old') {
  keychain.__put(LEGACY_KEY, token, LEGACY_SERVICE);
  flags.set('session.present', 'true');
  flags.set('session.locked', 'true');
}

function promptedReads() {
  return keychain.__reads().filter((read) => read.options?.['requireAuthentication'] === true);
}

describe('a session on this device', () => {
  it('is answered without touching the keychain', async () => {
    expect(hasStoredSession()).toBe(false);

    await storeRefreshToken('refresh-1');

    expect(hasStoredSession()).toBe(true);
    expect(isLockOn()).toBe(false);
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
    // A restored backup: MMKV came back and the keychain did not.
    keychain.__reset();

    expect(await storedRefreshToken()).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });

  it('keeps the session when the keychain cannot be read just now', async () => {
    await storeRefreshToken('refresh-1');
    keychain.__setReadsFail(true);

    expect(await storedRefreshToken()).toBeNull();
    expect(hasStoredSession()).toBe(true);

    keychain.__setReadsFail(false);
    expect(await storedRefreshToken()).toBe('refresh-1');
  });
});

describe('#319: the token is never behind a prompt', () => {
  it('stays in the one ordinary item with the lock on, and reading it asks for nothing', async () => {
    await storeRefreshToken('refresh-1');
    expect(await enableLock('123456')).toBe(true);

    await storeRefreshToken('refresh-2'); // a refresh rotating it
    expect(await storedRefreshToken()).toBe('refresh-2');

    expect(isLockOn()).toBe(true);
    expect(keychain.__entries()).toContain(ORDINARY);
    expect(keychain.__entries()).not.toContain(`${LEGACY_SERVICE}:${LEGACY_KEY}`);
    expect(promptedReads()).toEqual([]);
  });

  it('turns the lock on only with a session, and only with the PIN saved first', async () => {
    expect(await enableLock('123456')).toBe(false);
    expect(isLockOn()).toBe(false);

    await storeRefreshToken('refresh-1');
    expect(await enableLock('123456')).toBe(true);
    expect(await checkPin('123456')).toBe(true);
  });

  it('does not turn the lock on when the PIN cannot be saved', async () => {
    await storeRefreshToken('refresh-1');
    keychain.__setWritesFail(true);

    await expect(enableLock('123456')).rejects.toThrow();
    expect(isLockOn()).toBe(false);
  });

  it('turns the lock off and erases the PIN', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock('123456');

    await disableLock();

    expect(isLockOn()).toBe(false);
    expect(await hasPin()).toBe(false);
    expect(await storedRefreshToken()).toBe('refresh-1');
  });

  it('erases the PIN, the counter and the lock at sign-out', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock('123456');
    await recordFailedAttempt();

    await endSession();

    expect(isLockOn()).toBe(false);
    expect(await hasPin()).toBe(false);
    expect(await failedPinAttempts()).toBe(0);
    expect(keychain.__entries()).toEqual([]);
  });
});

describe('#319: migrating a pre-#319 locked session', () => {
  it('reads the old item once, moves the token, deletes the old item and owes a PIN', async () => {
    legacyLockedInstall();
    expect(needsLockMigration()).toBe(true);

    expect(await migrateLegacyLock()).toBe('migrated');

    expect(promptedReads()).toHaveLength(1);
    expect(keychain.__entries()).toEqual([ORDINARY]);
    expect(await storedRefreshToken()).toBe('refresh-old');
    expect(isLockOn()).toBe(true);
    expect(isPinRequired()).toBe(true);
    expect(needsLockMigration()).toBe(false);
    // Done once: the next launch has nothing to migrate and nothing to prompt for.
    expect(await migrateLegacyLock()).toBe('none');
    expect(promptedReads()).toHaveLength(1);
  });

  it('a refused prompt changes nothing, and the next try works', async () => {
    legacyLockedInstall();
    keychain.__setBiometryAllowed(false);

    expect(await migrateLegacyLock()).toBe('refused');
    expect(hasStoredSession()).toBe(true);
    expect(needsLockMigration()).toBe(true);
    expect(keychain.__entries()).toEqual([`${LEGACY_SERVICE}:${LEGACY_KEY}`]);

    keychain.__setBiometryAllowed(true);
    expect(await migrateLegacyLock()).toBe('migrated');
    expect(await storedRefreshToken()).toBe('refresh-old');
  });

  it('a failed write changes nothing: the old item still holds the token', async () => {
    legacyLockedInstall();
    keychain.__setWritesFail(true);

    expect(await migrateLegacyLock()).toBe('failed');
    expect(hasStoredSession()).toBe(true);
    expect(needsLockMigration()).toBe(true);
    expect(keychain.__entries()).toEqual([`${LEGACY_SERVICE}:${LEGACY_KEY}`]);

    keychain.__setWritesFail(false);
    expect(await migrateLegacyLock()).toBe('migrated');
  });

  it('a failed delete keeps the migration owed, and the next launch finishes it without a prompt', async () => {
    legacyLockedInstall();
    keychain.__setDeletesFail(true);

    expect(await migrateLegacyLock()).toBe('migrated');
    // The token is readable already; only the old item is left behind.
    expect(await storedRefreshToken()).toBe('refresh-old');
    expect(needsLockMigration()).toBe(true);

    keychain.__setDeletesFail(false);
    expect(await migrateLegacyLock()).toBe('recovered');
    expect(promptedReads()).toHaveLength(1);
    expect(keychain.__entries()).toEqual([ORDINARY]);
    expect(needsLockMigration()).toBe(false);
  });

  it('a token already copied by an interrupted run is not read again', async () => {
    legacyLockedInstall();
    keychain.__put('ideanest.refresh-token', 'refresh-old');

    expect(await migrateLegacyLock()).toBe('recovered');

    expect(promptedReads()).toEqual([]);
    expect(keychain.__entries()).toEqual([ORDINARY]);
    expect(isPinRequired()).toBe(true);
  });

  it('never forgets the session while the move is owed, even when a request reads first', async () => {
    legacyLockedInstall();

    // A request behind the gate, before the migration ran: no prompt, no token, no sign-out.
    expect(await storedRefreshToken()).toBeNull();
    expect(hasStoredSession()).toBe(true);
    expect(promptedReads()).toEqual([]);
  });

  it('an empty old item is a session that was already gone', async () => {
    flags.set('session.present', 'true');
    flags.set('session.locked', 'true');

    expect(await migrateLegacyLock()).toBe('lost');
    expect(hasStoredSession()).toBe(false);
  });

  it('signing out deletes the old item without a prompt', async () => {
    legacyLockedInstall();
    keychain.__setBiometryAllowed(false);

    await endSession();

    expect(keychain.__entries()).toEqual([]);
    expect(promptedReads()).toEqual([]);
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
