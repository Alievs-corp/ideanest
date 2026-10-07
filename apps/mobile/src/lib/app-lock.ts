import { AppState, type AppStateStatus } from 'react-native';
import { unlock } from './biometrics';
import { MAX_PIN_ATTEMPTS, checkPin, failedPinAttempts, recordFailedAttempt, resetPinAttempts } from './pin';
import {
  disableLock,
  enableLock,
  hasStoredSession,
  isLockOn,
  isPinRequired,
  migrateLegacyLock,
  needsLockMigration,
  subscribeToSession,
} from './session';

/**
 * The app lock's gate — issue #319, §4.12 MB-03. Owns WHEN the app is locked; `features/lock/`
 * draws it.
 *
 * <h2>The owner's rule: ask once</h2>
 *
 * The lock asks at a cold start, and again only when the app comes back after MORE than
 * {@link RELOCK_AFTER_MS} in the background. Never on navigation, never because a token is
 * refreshed or a request needs the session: the refresh token is readable without a prompt
 * (`lib/session.ts`), so nothing but this gate can ask, and the gate asks only in those two
 * moments.
 *
 * <p>Each locking is an "episode", and the biometric prompt is offered automatically once per
 * episode ({@link autoPromptOnce}). A refusal or a cancel lands on the PIN pad and is NOT asked
 * again on its own; "Use fingerprint" on the pad is the owner asking again.
 *
 * <h2>Why the previous build asked twice</h2>
 *
 * Nothing here prompted before #319 — the keychain did. A launch's first request refreshed the
 * session: reading the `requireAuthentication` item was one prompt, and writing the rotated token
 * back into it was a second (Android authenticates the cipher for a write too). This gate replaces
 * both with one call to `authenticateAsync`, and a test counts it.
 *
 * <h2>Five wrong PINs</h2>
 *
 * The counter is persisted before the answer is shown (`lib/pin.ts`), so killing the app after a
 * wrong entry does not give the attempt back, and a launch that finds the limit already reached
 * finishes the wipe before showing anything. A correct PIN or a passed prompt resets it.
 *
 * <h2>The gate is in the interface, and that is the trade</h2>
 *
 * The screens behind the gate stay mounted (so a re-lock does not lose somebody's place) and are
 * hidden from screen readers while it is shut; requests behind it carry the session as usual. A
 * gate the operating system enforced was stronger against code running inside this process — and
 * asked at every refresh, with no fallback. The owner chose this one.
 */

/** How long the app may be away before it locks again: five minutes, and the boundary stays open. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

export type LockPhase =
  /** Nothing in front of the app. */
  | 'open'
  /** The lock screen: the PIN pad, and the biometric prompt once. */
  | 'locked'
  /** A pre-#319 lock: its token is being moved out of the old item, behind that item's one prompt. */
  | 'migrating'
  /** The migration's prompt was refused, or its write failed. Nothing was lost; try again. */
  | 'migration-stalled'
  /** The lock is on without a PIN and this launch is unlocked: choose one, or turn the lock off. */
  | 'set-pin'
  /** Five wrong PINs ended the session on this phone. Said once, then open. */
  | 'signed-out';

let phase: LockPhase | null = null;
/** Bumped at every locking; the automatic prompt is offered once per value. */
let episode = 0;
let promptedEpisode = -1;
/** When the app first stopped being active, or null while it is. */
let leftAt: number | null = null;
let migration: Promise<void> | null = null;

const listeners = new Set<() => void>();

function publish(next: LockPhase): void {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

/** What a cold start shows, from the session's flags alone — synchronous, so the first frame knows. */
function coldStartPhase(): LockPhase {
  if (!hasStoredSession() || !isLockOn()) return 'open';
  if (needsLockMigration()) return 'migrating';
  return 'locked';
}

/** The current phase. The first read is the cold start's. */
export function lockPhase(): LockPhase {
  if (phase === null) {
    phase = coldStartPhase();
    if (phase === 'locked') episode += 1;
  }
  return phase;
}

/** Whether something is in front of the app. */
export function isGateShut(): boolean {
  return lockPhase() !== 'open';
}

export function subscribeToLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Shuts the gate for a new episode. */
function lockNow(): void {
  episode += 1;
  publish('locked');
}

/** The session moved under the gate: signed out, or the lock turned off elsewhere. */
function sessionChanged(): void {
  const current = lockPhase();
  if (current === 'open' || current === 'signed-out') return;
  if (!hasStoredSession() || !isLockOn()) publish('open');
}

/**
 * `AppState`, as the gate reads it. Exported so a test can drive it with a clock of its own.
 *
 * <p>`background` on both platforms, and `inactive` on iOS for the app switcher, an incoming call
 * and the Face ID sheet itself. The first non-active moment is the one remembered: going inactive
 * then background must not reset the clock. Wall time (`Date.now()`), because a timer inside a
 * suspended process does not run.
 */
export function appStateChanged(state: AppStateStatus, now: number = Date.now()): void {
  if (state !== 'active') {
    leftAt ??= now;
    return;
  }
  const away = leftAt;
  leftAt = null;
  if (away === null || now - away <= RELOCK_AFTER_MS) return;
  const current = lockPhase();
  // `set-pin` too: a migrated owner who walked away before choosing a PIN is asked again.
  if ((current === 'open' || current === 'set-pin') && hasStoredSession() && isLockOn()) lockNow();
}

/**
 * Starts the gate: the `AppState` listener, the session subscription, and a migration owed by a
 * pre-#319 install. Mounted once, by the root layout. Returns the stop.
 */
export function startAppLock(): () => void {
  lockPhase();
  const app = AppState.addEventListener('change', (state) => appStateChanged(state));
  const session = subscribeToSession(sessionChanged);
  if (phase === 'migrating') void runMigration();
  return () => {
    app.remove();
    session();
  };
}

/**
 * The automatic biometric prompt — at most once per episode, and only on the lock screen.
 *
 * @returns whether it was shown and passed; false when it was not this episode's to show
 */
export async function autoPromptOnce(reason: string): Promise<boolean> {
  if (lockPhase() !== 'locked' || promptedEpisode === episode) return false;
  promptedEpisode = episode;
  return await unlockWithBiometrics(reason);
}

/** "Use fingerprint" on the lock screen: one prompt, because the owner asked for it. */
export async function unlockWithBiometrics(reason: string): Promise<boolean> {
  promptedEpisode = episode;
  const passed = await confirmWithBiometrics(reason);
  if (passed && lockPhase() === 'locked') opened();
  return passed;
}

/** What a PIN entry came to. */
export type PinAttempt =
  | { readonly kind: 'correct' }
  | { readonly kind: 'wrong'; readonly remaining: number }
  | { readonly kind: 'signed-out' };

/**
 * One PIN entry, counted — the lock screen's, and settings' when they ask before turning the lock
 * off or changing the PIN. The limit is the same everywhere: a phone left unlocked must not become
 * a place to guess the PIN at leisure.
 *
 * @param wipe ends the session on this phone and empties its caches (`lib/local-sign-out.ts`)
 */
export async function attemptPin(pin: string, wipe: () => Promise<void>): Promise<PinAttempt> {
  if (await checkPin(pin)) {
    await quietly(resetPinAttempts);
    return { kind: 'correct' };
  }
  let failures: number;
  try {
    failures = await recordFailedAttempt();
  } catch {
    // The counter could not be written. Refuse the entry anyway; the limit is checked again next time.
    failures = (await failedPinAttempts()) + 1;
  }
  if (failures >= MAX_PIN_ATTEMPTS) {
    await signOutForAttempts(wipe);
    return { kind: 'signed-out' };
  }
  return { kind: 'wrong', remaining: MAX_PIN_ATTEMPTS - failures };
}

/** A PIN entry on the lock screen: {@link attemptPin}, and the gate opens on a correct one. */
export async function unlockWithPin(pin: string, wipe: () => Promise<void>): Promise<PinAttempt> {
  const attempt = await attemptPin(pin, wipe);
  if (attempt.kind === 'correct' && lockPhase() === 'locked') opened();
  return attempt;
}

/**
 * The biometric prompt as confirmation — settings' "it is you" before the lock goes off or the PIN
 * changes. A pass resets the counter, as on the lock screen.
 */
export async function confirmWithBiometrics(reason: string): Promise<boolean> {
  const passed = await unlock(reason);
  if (passed) await quietly(resetPinAttempts);
  return passed;
}

/**
 * The lock screen's first job: a launch that finds the limit already reached — the app was killed
 * between the fifth wrong PIN and the wipe — finishes the wipe before anything else.
 *
 * @returns whether it wiped
 */
export async function settleAttempts(wipe: () => Promise<void>): Promise<boolean> {
  if ((await failedPinAttempts()) < MAX_PIN_ATTEMPTS) return false;
  await signOutForAttempts(wipe);
  return true;
}

async function signOutForAttempts(wipe: () => Promise<void>): Promise<void> {
  try {
    await wipe();
  } finally {
    // The PIN and the counter go with the session (`session.ts`'s `endSession`); this says so once.
    publish('signed-out');
  }
}

/** The lock screen has said what five wrong PINs did; the app is open, and signed out. */
export function acknowledgeSignedOut(): void {
  if (lockPhase() === 'signed-out') publish('open');
}

/** A passed prompt or a correct PIN. A migrated lock with no PIN yet goes on to choose one. */
function opened(): void {
  publish(isPinRequired() ? 'set-pin' : 'open');
}

/** Why the migration stalled, for the screen's sentence. */
let stalledBy: 'refused' | 'failed' = 'refused';

export function migrationStall(): 'refused' | 'failed' {
  return stalledBy;
}

/** Moves a pre-#319 locked session's token — its one prompt — and decides what comes next. */
export function runMigration(): Promise<void> {
  const current = lockPhase();
  if (migration === null && current !== 'migrating' && current !== 'migration-stalled') {
    return Promise.resolve();
  }
  migration ??= (async () => {
    publish('migrating');
    const outcome = await migrateLegacyLock();
    switch (outcome) {
      case 'migrated':
        // The prompt just passed: this launch is unlocked, and owes the lock a PIN.
        promptedEpisode = episode;
        publish('set-pin');
        break;
      case 'recovered':
        // Copied by an earlier, interrupted run: nobody has been asked this launch.
        lockNow();
        break;
      case 'refused':
      case 'failed':
        stalledBy = outcome;
        publish('migration-stalled');
        break;
      case 'lost':
      case 'none':
        publish(coldStartPhase());
        break;
    }
  })().finally(() => {
    migration = null;
  });
  return migration;
}

/** The PIN a migrated lock owed, chosen and confirmed. The gate opens. */
export async function finishPinSetup(pin: string): Promise<void> {
  await enableLock(pin);
  publish('open');
}

/** A migrated owner who would rather not have the lock. Offered only after the prompt passed. */
export async function turnLockOffInstead(): Promise<void> {
  if (lockPhase() !== 'set-pin') return;
  await disableLock();
  publish('open');
}

async function quietly(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    // Best effort: a counter that could not be reset is reset by the next correct entry.
  }
}

/** Back to a cold start. For tests, and for nothing else. */
export function resetAppLockForTests(): void {
  phase = null;
  episode = 0;
  promptedEpisode = -1;
  leftAt = null;
  migration = null;
  stalledBy = 'refused';
  listeners.clear();
}
