import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  RELOCK_AFTER_MS,
  acknowledgeSignedOut,
  appStateChanged,
  attemptPin,
  autoPromptOnce,
  finishPinSetup,
  lockPhase,
  resetAppLockForTests,
  runMigration,
  settleAttempts,
  startAppLock,
  turnLockOffInstead,
  unlockWithBiometrics,
  unlockWithPin,
} from './app-lock';
import { refreshAccessToken } from './auth';
import { checkPin, failedPinAttempts, hasPin } from './pin';
import {
  enableLock,
  endSession,
  hasStoredSession,
  isLockOn,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from './session';
import { memoryStore, type KeyValueStore } from './storage';

/**
 * The app lock's gate (#319): when it shuts, what opens it, and what five wrong PINs do.
 *
 * <p>The owner's rule is a count — one prompt at launch, none on a token refresh, one after more
 * than five minutes away and none after less — so the count is what these tests assert, on the
 * `expo-local-authentication` double's own counter.
 */

const biometrics = LocalAuthentication as unknown as {
  __setBiometrics: (state: { succeeds?: boolean; hardware?: boolean }) => void;
  __prompts: () => number;
  __reset: () => void;
};
const keychain = SecureStore as unknown as {
  __put: (key: string, value: string, service?: string) => void;
  __setBiometryAllowed: (allowed: boolean) => void;
  __setWritesFail: (fail: boolean) => void;
  __reads: () => { key: string; options?: Record<string, unknown> }[];
  __reset: () => void;
};

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
let flags: KeyValueStore;
const wipe = jest.fn(async () => {
  await endSession();
});

beforeEach(() => {
  keychain.__reset();
  biometrics.__reset();
  flags = memoryStore();
  useFlagStore(flags);
  rememberAccessToken(null);
  resetAppLockForTests();
  wipe.mockClear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

/** A signed-in phone with the lock on and a PIN of 135790, as a cold start finds it. */
async function lockedPhone() {
  await storeRefreshToken('refresh-1');
  await enableLock('135790');
  resetAppLockForTests();
}

describe('a cold start', () => {
  it('is open with no lock, or with nobody signed in', async () => {
    expect(lockPhase()).toBe('open');
    resetAppLockForTests();
    await storeRefreshToken('refresh-1');
    expect(lockPhase()).toBe('open');
  });

  it('is locked with the lock on, and prompts exactly once however often it is asked', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });

    expect(lockPhase()).toBe('locked');
    expect(await autoPromptOnce('Unlock')).toBe(false);
    expect(await autoPromptOnce('Unlock')).toBe(false);
    expect(await autoPromptOnce('Unlock')).toBe(false);

    expect(biometrics.__prompts()).toBe(1);
    // Refused: the PIN pad is what is left, and the gate stays shut.
    expect(lockPhase()).toBe('locked');
  });

  it('opens on a passed prompt', async () => {
    await lockedPhone();
    expect(await autoPromptOnce('Unlock')).toBe(true);
    expect(lockPhase()).toBe('open');
    expect(biometrics.__prompts()).toBe(1);
  });

  it('never prompts for a token refresh, locked or open', async () => {
    await lockedPhone();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await refreshAccessToken();
    await autoPromptOnce('Unlock');
    await refreshAccessToken();
    await refreshAccessToken();

    expect(biometrics.__prompts()).toBe(1);
    expect(keychain.__reads().some((read) => read.options?.['requireAuthentication'] === true)).toBe(false);
  });
});

describe('coming back', () => {
  const T0 = 1_700_000_000_000;

  async function openedPhone() {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    expect(lockPhase()).toBe('open');
  }

  it('after five minutes or less is straight back in, with no prompt', async () => {
    await openedPhone();
    appStateChanged('background', T0);
    appStateChanged('active', T0 + RELOCK_AFTER_MS);
    expect(lockPhase()).toBe('open');
    expect(await autoPromptOnce('Unlock')).toBe(false);
    expect(biometrics.__prompts()).toBe(1);
  });

  it('after more than five minutes is locked, and prompts once more', async () => {
    await openedPhone();
    appStateChanged('inactive', T0);
    // Going inactive then background must not restart the clock.
    appStateChanged('background', T0 + 60_000);
    appStateChanged('active', T0 + RELOCK_AFTER_MS + 1);
    expect(lockPhase()).toBe('locked');

    await autoPromptOnce('Unlock');
    await autoPromptOnce('Unlock');
    expect(biometrics.__prompts()).toBe(2);
  });

  it('does not lock a phone without the lock', async () => {
    await storeRefreshToken('refresh-1');
    appStateChanged('background', T0);
    appStateChanged('active', T0 + RELOCK_AFTER_MS * 10);
    expect(lockPhase()).toBe('open');
  });

  it('listens to AppState once the gate is started', async () => {
    await lockedPhone();
    const stop = startAppLock();
    expect(lockPhase()).toBe('locked');
    stop();
  });
});

describe('the PIN', () => {
  it('opens the gate and resets the counter', async () => {
    await lockedPhone();
    expect(await unlockWithPin('000000', wipe)).toEqual({ kind: 'wrong', remaining: 4 });
    expect(await failedPinAttempts()).toBe(1);

    expect(await unlockWithPin('135790', wipe)).toEqual({ kind: 'correct' });
    expect(lockPhase()).toBe('open');
    expect(await failedPinAttempts()).toBe(0);
  });

  it('counts down, and the fifth wrong entry signs out on this phone', async () => {
    await lockedPhone();
    const remaining = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      remaining.push(await unlockWithPin('111111', wipe));
    }
    expect(remaining.map((r) => (r.kind === 'wrong' ? r.remaining : -1))).toEqual([4, 3, 2, 1]);
    expect(wipe).not.toHaveBeenCalled();

    expect(await unlockWithPin('111111', wipe)).toEqual({ kind: 'signed-out' });

    expect(wipe).toHaveBeenCalledTimes(1);
    expect(lockPhase()).toBe('signed-out');
    expect(hasStoredSession()).toBe(false);
    expect(isLockOn()).toBe(false);
    expect(await hasPin()).toBe(false);
    expect(await failedPinAttempts()).toBe(0);

    acknowledgeSignedOut();
    expect(lockPhase()).toBe('open');
  });

  it('keeps its count across a kill, and a relaunch at the limit finishes the wipe', async () => {
    await lockedPhone();
    for (let attempt = 0; attempt < 4; attempt += 1) await unlockWithPin('111111', wipe);

    resetAppLockForTests(); // the process died and came back
    expect(await failedPinAttempts()).toBe(4);
    expect(await unlockWithPin('222222', wipe)).toEqual({ kind: 'signed-out' });

    // The app killed between the fifth entry being counted and the wipe:
    await lockedPhone();
    await SecureStore.setItemAsync('ideanest.app-lock.failures', '5');
    resetAppLockForTests();
    wipe.mockClear();
    expect(await settleAttempts(wipe)).toBe(true);
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('a passed prompt resets the counter', async () => {
    await lockedPhone();
    await unlockWithPin('111111', wipe);
    await unlockWithPin('111111', wipe);

    expect(await unlockWithBiometrics('Unlock')).toBe(true);
    expect(await failedPinAttempts()).toBe(0);
  });

  it('counts the same in settings, where the gate is already open', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    expect(await attemptPin('999999', wipe)).toEqual({ kind: 'wrong', remaining: 4 });
    expect(await attemptPin('135790', wipe)).toEqual({ kind: 'correct' });
    expect(lockPhase()).toBe('open');
  });
});

describe('a pre-#319 locked install', () => {
  function legacy() {
    keychain.__put('ideanest.refresh-token.locked', 'refresh-old', 'az.ideanest.app.locked');
    flags.set('session.present', 'true');
    flags.set('session.locked', 'true');
    resetAppLockForTests();
  }

  it('is migrated with its one prompt, then asks for a PIN without asking again', async () => {
    legacy();
    expect(lockPhase()).toBe('migrating');

    await runMigration();

    expect(lockPhase()).toBe('set-pin');
    expect(await autoPromptOnce('Unlock')).toBe(false);
    expect(biometrics.__prompts()).toBe(0);

    await finishPinSetup('864209');
    expect(lockPhase()).toBe('open');
    expect(await checkPin('864209')).toBe(true);
    expect(isLockOn()).toBe(true);
  });

  it('may turn the lock off instead of choosing a PIN', async () => {
    legacy();
    await runMigration();
    await turnLockOffInstead();
    expect(lockPhase()).toBe('open');
    expect(isLockOn()).toBe(false);
    expect(hasStoredSession()).toBe(true);
  });

  it('a refused prompt or a failed write waits for "Try again", keeping the session', async () => {
    legacy();
    keychain.__setBiometryAllowed(false);
    await runMigration();
    expect(lockPhase()).toBe('migration-stalled');
    expect(hasStoredSession()).toBe(true);

    keychain.__setBiometryAllowed(true);
    keychain.__setWritesFail(true);
    await runMigration();
    expect(lockPhase()).toBe('migration-stalled');

    keychain.__setWritesFail(false);
    await runMigration();
    expect(lockPhase()).toBe('set-pin');
  });

  it('a relaunch before the PIN was chosen asks for the prompt, then the PIN', async () => {
    legacy();
    await runMigration();
    resetAppLockForTests();

    expect(lockPhase()).toBe('locked');
    expect(await autoPromptOnce('Unlock')).toBe(true);
    expect(lockPhase()).toBe('set-pin');
  });
});

describe('signing out', () => {
  it('opens the gate and takes the PIN with it', async () => {
    await lockedPhone();
    const stop = startAppLock();
    expect(lockPhase()).toBe('locked');

    await endSession();

    expect(lockPhase()).toBe('open');
    expect(await hasPin()).toBe(false);
    stop();
  });
});
