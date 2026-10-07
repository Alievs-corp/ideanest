import { useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { unlock } from './biometrics';
import { takeDeferred } from './maintenance';
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
 * again on its own; "Use fingerprint" on the pad is the owner asking again. Coming back after
 * more than five minutes to a lock that is still shut is a new episode, with its own prompt.
 *
 * <h2>Why the previous build asked twice</h2>
 *
 * Nothing here prompted before #319 — the keychain did. A launch's first request refreshed the
 * session: reading the `requireAuthentication` item was one prompt, and writing the rotated token
 * back into it was a second (Android authenticates the cipher for a write too). This gate replaces
 * both with one call to `authenticateAsync`, and a test counts it.
 *
 * <h2>Nothing gets past it while it is shut</h2>
 *
 * - A link, a push tap or the maintenance screen that arrives while the gate is shut waits
 *   ({@link deferUntilOpen}, `maintenance-gate.ts`) and is replayed when it opens; a native modal
 *   presented after the lock screen would otherwise sit above it on iOS. So does one that arrives
 *   while the app is AWAY with the lock on: the link that brings the app back is delivered before
 *   it becomes active (iOS `openURL`, Android `onNewIntent`), which is before this gate has
 *   decided whether to lock. One that arrives during a wipe, or under the signed-out notice, is
 *   dropped: it was for the session that is ending.
 * - A kit `Sheet`, `Dialog` or `SuccessReveal`, and the editor's modals, asked to open while it is
 *   shut are held until it opens ({@link useHeldWhileShut}): on Android each would be a window
 *   above the lock.
 * - A wipe holds it shut until the caches are gone too ({@link holdShutWhile}): the session's
 *   flags clear first, and opening on that alone would show the cached screens for a moment. A
 *   session that ends any other way while the gate is shut — a refresh the service refused, a
 *   keychain that lost the token — is cleaned up the same way ({@link setSessionEndCleanup})
 *   before the gate opens. A wipe that fails leaves the gate shut.
 *
 * <h2>Five wrong PINs</h2>
 *
 * The counter is persisted before the answer is shown (`lib/pin.ts`), and fails closed: a counter
 * that cannot be read or written counts as the limit. Attempts are serialised, so two taps that
 * land together cannot both read the same count. A launch that finds the limit already reached
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
/** When the app first stopped being active — wall clock and monotonic — or null while it is. */
let leftAt: { readonly wall: number; readonly mono: number } | null = null;
/** The app is away with the lock on: the curtain is up over whatever was on screen. */
let curtained = false;
/** A wipe or a sign-out in progress: the session flags clearing must not open the gate. */
let holds = 0;
/** What the last of the holds shows when it lets go: the notice wins over plain open. */
let heldThen: 'open' | 'signed-out' = 'open';
/** Empties this account's caches after a session ended without a wipe. Set by the gate's view. */
let sessionEndCleanup: (() => void | Promise<void>) | null = null;
/** A navigation that arrived while the gate was shut. Only the latest is kept. */
let pendingNavigation: (() => void) | null = null;
let migration: Promise<void> | null = null;
/** The tail of the PIN attempts: each waits for the one before it. */
let attempts: Promise<unknown> = Promise.resolve();

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function publish(next: LockPhase): void {
  if (phase === next) return;
  phase = next;
  if (next !== 'open') curtained = false;
  notify();
  if (next === 'open') replayNavigation();
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

/** The current episode: a new value is a new locking, with its own automatic prompt. */
export function lockEpisode(): number {
  lockPhase();
  return episode;
}

/** Whether something is in front of the app. */
export function isGateShut(): boolean {
  return lockPhase() !== 'open';
}

/** Whether the away-curtain is up: the app is in the background with the lock on. */
export function isCurtained(): boolean {
  return curtained;
}

export function subscribeToLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Whether the gate is shut, as a component reads it. */
export function useGateShut(): boolean {
  return useSyncExternalStore(subscribeToLock, isGateShut, isGateShut);
}

/**
 * An overlay's `visible`, held while the gate is shut. One that was already open when the gate
 * shut stays open (the lock screen is above it); one asked to open while the gate is shut waits
 * until it opens. For the kit's `Sheet`, `Dialog` and `SuccessReveal` and the editor's modals.
 */
export function useHeldWhileShut(visible: boolean): boolean {
  const shut = useGateShut();
  const opened = useRef(false);
  if (!visible) opened.current = false;
  else if (!shut) opened.current = true;
  return visible && opened.current;
}

/** The app is away (or the curtain is up) with a locked session: the gate has not decided yet. */
function awayWithLock(): boolean {
  return (leftAt !== null || curtained) && hasStoredSession() && isLockOn();
}

/**
 * Holds a navigation while the gate is shut — or while the app is away with the lock on, since
 * the link that brings it back arrives before it is active — to run when the gate is open. Drops
 * one that arrives during a wipe or under the signed-out notice.
 *
 * @returns true when it was held or dropped; false when the caller should go now
 */
export function deferUntilOpen(navigate: () => void): boolean {
  if (holds > 0 || lockPhase() === 'signed-out') return true;
  if (!isGateShut() && !awayWithLock()) return false;
  pendingNavigation = navigate;
  return true;
}

/**
 * Registers what empties this account's caches when the session ends WITHOUT a wipe while the
 * gate is shut (a refresh refused, a token gone). `LockGate` sets it; it has the query client.
 */
export function setSessionEndCleanup(cleanup: (() => void | Promise<void>) | null): void {
  sessionEndCleanup = cleanup;
}

function replayNavigation(): void {
  const navigate = pendingNavigation;
  pendingNavigation = null;
  navigate?.();
}

/** Shuts the gate for a new episode. */
function lockNow(): void {
  episode += 1;
  curtained = false;
  if (phase === 'locked') notify();
  else publish('locked');
}

/** The session moved under the gate: signed out, or the lock turned off elsewhere. */
function sessionChanged(): void {
  // A wipe clears the session's flags before the caches; its caller says when it is done.
  if (holds > 0) return;
  const current = lockPhase();
  if (current === 'open' || current === 'signed-out') return;
  if (!hasStoredSession()) {
    // Ended some other way — the service refused a refresh, the keychain lost the token. The
    // caches are this account's still: emptied with the gate held shut, then it opens.
    void holdShutWhile(async () => {
      await sessionEndCleanup?.();
    }, 'open');
    return;
  }
  if (!isLockOn()) publish('open');
}

/**
 * Runs a wipe or a sign-out with the gate held shut, then shows `then`. Nothing behind the gate
 * is visible or touchable until every cache is gone; a navigation that was waiting — a link, or
 * one held for maintenance — is dropped: it was for the session that has just ended.
 *
 * <p>Fails closed. If a session is still on the phone when the work is over (it threw half-way),
 * the gate stays locked rather than opening on it. Holds nest: only the last to finish decides,
 * and the signed-out notice wins over plain open. Never throws.
 */
export async function holdShutWhile(
  work: () => Promise<void>,
  then: 'open' | 'signed-out',
): Promise<void> {
  holds += 1;
  if (then === 'signed-out') heldThen = 'signed-out';
  pendingNavigation = null;
  takeDeferred();
  try {
    await work();
  } catch {
    // Decided below, from what is left on the phone.
  } finally {
    holds -= 1;
    if (holds === 0) {
      const next = heldThen;
      heldThen = 'open';
      pendingNavigation = null;
      takeDeferred();
      if (!hasStoredSession()) publish(next);
      // Failed: back to where the session still is — a migration still owed shows its own screen.
      else if (needsLockMigration()) publish('migration-stalled');
      else publish(isLockOn() ? 'locked' : 'open');
    }
  }
}

/** A monotonic reading, where the runtime has one. */
function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Whether a time away says lock: either clock past five minutes, or a wall clock gone backwards. */
export function awayLongEnough(wall: number, mono: number): boolean {
  return wall < 0 || wall > RELOCK_AFTER_MS || mono > RELOCK_AFTER_MS;
}

/**
 * `AppState`, as the gate reads it. Exported so a test can drive it with clocks of its own.
 *
 * <p>`background` on both platforms, and `inactive` on iOS for the app switcher, an incoming call
 * and the Face ID sheet itself. The first non-active moment is the one remembered: going inactive
 * then background must not reset the clock.
 *
 * <p>Two clocks, and either one locks. The wall clock (`Date.now()`) measures across a suspension,
 * which a timer inside a suspended process cannot — but it can be changed in the phone's settings,
 * so one that went backwards locks too. The monotonic one cannot be changed, but `performance.now()`
 * may stand still while the phone sleeps; it catches a wall clock wound back by less than the time
 * the app was awake-but-away. A wall clock wound back while the phone SLEPT is not caught: that
 * needs the native boot-time clock (`elapsedRealtime`, `mach_continuous_time`), which is not
 * exposed to JavaScript here.
 *
 * <p>With the lock on, leaving puts a curtain over the app at once, and coming back lifts it
 * (five minutes or less) or turns it into the lock screen — so the screen that was open is never
 * shown again before the lock decides. It also covers the app switcher's snapshot as far as
 * JavaScript can: iOS takes that snapshot when the app goes inactive, possibly before this frame
 * is drawn, and Android needs `FLAG_SECURE` to keep it out entirely — both native work.
 */
export function appStateChanged(
  state: AppStateStatus,
  now: number = Date.now(),
  mono: number = monotonicNow(),
): void {
  if (state !== 'active') {
    leftAt ??= { wall: now, mono };
    if (!curtained && lockPhase() === 'open' && hasStoredSession() && isLockOn()) {
      curtained = true;
      notify();
    }
    return;
  }
  const away = leftAt;
  leftAt = null;
  const relock = away !== null && awayLongEnough(now - away.wall, mono - away.mono);
  const current = lockPhase();
  if (relock && hasStoredSession() && isLockOn()) {
    // `set-pin` too: a migrated owner who walked away before choosing a PIN is asked again. And a
    // lock still shut from before is a new episode: the owner is back, and is asked again.
    if (current === 'open' || current === 'set-pin' || current === 'locked') {
      // A link that brought the app back stays held, for after the unlock.
      lockNow();
      return;
    }
  }
  if (curtained) {
    curtained = false;
    notify();
  }
  // Back within five minutes: a link that arrived while away goes now.
  if (!isGateShut() && holds === 0) replayNavigation();
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
 * <p>Serialised: each entry waits for the one before it, so two that land together are counted
 * as two, never as one read twice. One that arrives after the limit wiped the session is answered
 * "signed out" without being checked.
 *
 * @param wipe ends the session on this phone and empties its caches (`lib/local-sign-out.ts`)
 */
export function attemptPin(pin: string, wipe: () => Promise<void>): Promise<PinAttempt> {
  const run = attempts.then(() => countedAttempt(pin, wipe));
  attempts = run.catch(() => undefined);
  return run;
}

async function countedAttempt(pin: string, wipe: () => Promise<void>): Promise<PinAttempt> {
  if (!hasStoredSession()) return { kind: 'signed-out' };
  // Already at the limit — a wipe that failed, or a counter that cannot be read: the wipe again,
  // and the PIN is not even checked. A correct PIN must not open a phone that is owed a wipe.
  if ((await failedPinAttempts()) >= MAX_PIN_ATTEMPTS) {
    await signOutForAttempts(wipe);
    return hasStoredSession() ? { kind: 'wrong', remaining: 0 } : { kind: 'signed-out' };
  }
  if (await checkPin(pin)) {
    await quietly(resetPinAttempts);
    return { kind: 'correct' };
  }
  const failures = await recordFailedAttempt();
  if (failures >= MAX_PIN_ATTEMPTS) {
    await signOutForAttempts(wipe);
    // A wipe that failed left the session — and the gate shut. The next entry tries again.
    return hasStoredSession() ? { kind: 'wrong', remaining: 0 } : { kind: 'signed-out' };
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

/** Five wrong PINs: the wipe, with the gate held shut until it is done, then the notice. */
async function signOutForAttempts(wipe: () => Promise<void>): Promise<void> {
  await holdShutWhile(wipe, 'signed-out');
}

/** "Forgot your PIN?" and a stalled migration's way out: the wipe, held shut, then the app. */
export async function signOutFromGate(wipe: () => Promise<void>): Promise<void> {
  await holdShutWhile(wipe, 'open');
}

/** The lock screen has said what five wrong PINs did; the app is open, and signed out. */
export function acknowledgeSignedOut(): void {
  if (lockPhase() === 'signed-out') publish('open');
}

/**
 * A passed prompt or a correct PIN. A migrated lock with no PIN yet goes on to choose one. Not
 * while a wipe holds the gate: a prompt that passes during "Forgot your PIN?" opens nothing.
 */
function opened(): void {
  if (holds > 0) return;
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
  curtained = false;
  holds = 0;
  heldThen = 'open';
  sessionEndCleanup = null;
  pendingNavigation = null;
  migration = null;
  attempts = Promise.resolve();
  stalledBy = 'refused';
  listeners.clear();
}
