import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  RELOCK_AFTER_MS,
  acknowledgeSignedOut,
  appStateChanged,
  attemptPin,
  autoPromptOnce,
  deferUntilOpen,
  finishPinSetup,
  isCurtained,
  lockEpisode,
  lockPhase,
  resetAppLockForTests,
  runMigration,
  settleAttempts,
  signOutFromGate,
  startAppLock,
  useHeldWhileShut,
  turnLockOffInstead,
  unlockWithBiometrics,
  unlockWithPin,
} from './app-lock';
import { act, renderHook } from '@testing-library/react-native';
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
  __setReadsFail: (fail: boolean) => void;
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

describe('#319 review: the gate stays shut through a wipe', () => {
  it('five wrong PINs: shut while the session and the caches go, the notice after', async () => {
    await lockedPhone();
    const stop = startAppLock();
    const during: string[] = [];
    const slowWipe = jest.fn(async () => {
      await endSession(); // the session's flags clear here, and the session listener hears it
      during.push(lockPhase());
      await Promise.resolve(); // the caches, still to go
      during.push(lockPhase());
    });

    for (let attempt = 0; attempt < 5; attempt += 1) await unlockWithPin('111111', slowWipe);

    expect(during).toEqual(['locked', 'locked']);
    expect(lockPhase()).toBe('signed-out');
    stop();
  });

  it('"Forgot your PIN?": shut until the wipe has finished, then open', async () => {
    await lockedPhone();
    const stop = startAppLock();
    const during: string[] = [];

    await signOutFromGate(async () => {
      await endSession();
      during.push(lockPhase());
    });

    expect(during).toEqual(['locked']);
    expect(lockPhase()).toBe('open');
    expect(hasStoredSession()).toBe(false);
    stop();
  });
});

describe('#319 review: attempts are serialised', () => {
  it('counts two entries that land together as two', async () => {
    await lockedPhone();
    const [one, two] = await Promise.all([
      attemptPin('000000', wipe),
      attemptPin('000001', wipe),
    ]);
    expect([one, two]).toEqual([
      { kind: 'wrong', remaining: 4 },
      { kind: 'wrong', remaining: 3 },
    ]);
    expect(await failedPinAttempts()).toBe(2);
  });

  it('answers "signed out" to an entry queued behind the wipe', async () => {
    await lockedPhone();
    for (let attempt = 0; attempt < 4; attempt += 1) await attemptPin('111111', wipe);
    const results = await Promise.all([attemptPin('111111', wipe), attemptPin('135790', wipe)]);
    expect(results).toEqual([{ kind: 'signed-out' }, { kind: 'signed-out' }]);
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('fails closed: a counter that cannot be read counts as the limit', async () => {
    await lockedPhone();
    await unlockWithPin('111111', wipe);
    keychain.__setReadsFail(true);
    // checkPin cannot read the record either: the entry is wrong, and the count is the limit.
    expect(await attemptPin('135790', wipe)).toEqual({ kind: 'signed-out' });
    expect(wipe).toHaveBeenCalledTimes(1);
  });
});

describe('#319 review: nothing gets past the shut gate', () => {
  it('holds a link at a cold start and opens it with the gate', async () => {
    await lockedPhone();
    const navigate = jest.fn();

    expect(deferUntilOpen(navigate)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    await unlockWithPin('135790', wipe);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('holds a push tap after a re-lock, keeping only the latest', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    expect(deferUntilOpen(jest.fn())).toBe(false); // open: the caller goes now

    appStateChanged('background', 0, 0);
    appStateChanged('active', RELOCK_AFTER_MS + 1, 0);
    const first = jest.fn();
    const second = jest.fn();
    deferUntilOpen(first);
    deferUntilOpen(second);

    await unlockWithBiometrics('Unlock');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops a held link when the session is wiped', async () => {
    await lockedPhone();
    const navigate = jest.fn();
    deferUntilOpen(navigate);
    for (let attempt = 0; attempt < 5; attempt += 1) await unlockWithPin('111111', wipe);
    acknowledgeSignedOut();
    expect(lockPhase()).toBe('open');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('holds an overlay asked to open while shut; one already open stays', async () => {
    await lockedPhone();
    const asked = await renderHook(({ visible }: { visible: boolean }) => useHeldWhileShut(visible), {
      initialProps: { visible: true },
    });
    expect(asked.result.current).toBe(false);
    await act(async () => {
      await unlockWithPin('135790', wipe);
    });
    expect(asked.result.current).toBe(true);

    // Open before the gate shut: stays open under the lock screen.
    await act(async () => {
      appStateChanged('background', 0, 0);
      appStateChanged('active', RELOCK_AFTER_MS + 1, 0);
    });
    expect(lockPhase()).toBe('locked');
    expect(asked.result.current).toBe(true);
  });
});

describe('#319 review: coming back', () => {
  it('curtains the app while it is away, and lifts it after five minutes or less', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');

    appStateChanged('inactive', 1_000, 1_000);
    expect(isCurtained()).toBe(true);
    appStateChanged('active', 1_000 + RELOCK_AFTER_MS, 1_000 + RELOCK_AFTER_MS);
    expect(isCurtained()).toBe(false);
    expect(lockPhase()).toBe('open');
  });

  it('turns the curtain into the lock after more than five minutes', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    appStateChanged('background', 0, 0);
    expect(isCurtained()).toBe(true);
    appStateChanged('active', RELOCK_AFTER_MS + 1, 10);
    expect(lockPhase()).toBe('locked');
    expect(isCurtained()).toBe(false);
  });

  it('puts up no curtain without the lock', async () => {
    await storeRefreshToken('refresh-1');
    appStateChanged('background', 0, 0);
    expect(isCurtained()).toBe(false);
  });

  it('locks when the wall clock went backwards', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    appStateChanged('background', 1_000_000, 0);
    appStateChanged('active', 1_000, 10);
    expect(lockPhase()).toBe('locked');
  });

  it('locks when the monotonic clock says more than five minutes, whatever the wall says', async () => {
    await lockedPhone();
    await autoPromptOnce('Unlock');
    appStateChanged('background', 0, 0);
    appStateChanged('active', 60_000, RELOCK_AFTER_MS + 1);
    expect(lockPhase()).toBe('locked');
  });

  it('a lock still shut after more than five minutes is a new episode with its own prompt', async () => {
    await lockedPhone();
    biometrics.__setBiometrics({ succeeds: false });
    await autoPromptOnce('Unlock');
    const before = lockEpisode();
    expect(await autoPromptOnce('Unlock')).toBe(false);
    expect(biometrics.__prompts()).toBe(1);

    appStateChanged('background', 0, 0);
    appStateChanged('active', RELOCK_AFTER_MS + 1, 0);

    expect(lockEpisode()).toBe(before + 1);
    await autoPromptOnce('Unlock');
    expect(biometrics.__prompts()).toBe(2);
  });
});
