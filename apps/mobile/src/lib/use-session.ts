import { useSyncExternalStore } from 'react';
import {
  currentAccessToken,
  hasStoredSession,
  isLockOn,
  subscribeToSession,
} from './session';

/**
 * Whether anybody is signed in on this device, and whether the gate is armed.
 *
 * <h2>Why a hook rather than a provider</h2>
 *
 * Four screens ask, and all four ask the same question of two synchronous
 * booleans. A context provider would add a tree-wide re-render for a value that
 * changes a handful of times in a session, and it would have to be threaded
 * through the root layout in front of the query client — where it would delay
 * the first frame on a cold start for something the first frame can read
 * directly.
 *
 * <h2>`useSyncExternalStore` and not `useState` + `useEffect`</h2>
 *
 * This hook once read the keychain in an effect and held the answer in
 * state, which was two problems. The read is asynchronous, so every screen
 * flashed "sign in" for a frame; and the state was per-component, so signing in
 * on one screen left the others showing the old answer until something else
 * re-rendered them. `session.ts` publishes changes now, and this subscribes:
 * one source of truth, read synchronously on the first render, and every screen
 * moves together.
 *
 * <h2>What this is NOT</h2>
 *
 * It is not authentication. It answers "is there a session on this device",
 * which is enough to decide whether to show a sign-in prompt or a list, and
 * nothing more: the token can be revoked, and only the service knows. A screen
 * that showed private data on the strength of this alone would be showing it on
 * the strength of a file on the device. Every read that matters still goes
 * through `api/client.ts` and is still refused by the service without a valid
 * bearer.
 */
export interface Session {
  /** Whether a refresh token is kept on this device. */
  readonly signedIn: boolean;
  /** Whether the app lock is on (§4.12 MB-03, #319). Not whether it is shut: `lib/app-lock.ts`. */
  readonly locked: boolean;
  /** Whether this process is already holding an access token. */
  readonly unlocked: boolean;
}

/**
 * The snapshot, cached.
 *
 * <p>`useSyncExternalStore` compares snapshots by identity and re-reads on every
 * render, so a `getSnapshot` that built a fresh object each time would report a
 * change on every render and loop until React gives up with "The result of
 * getSnapshot should be cached". The object is therefore rebuilt only when one
 * of its three fields actually differs.
 */
let snapshot: Session = { signedIn: false, locked: false, unlocked: false };

function currentSnapshot(): Session {
  const signedIn = hasStoredSession();
  const locked = isLockOn();
  const unlocked = currentAccessToken() !== null;

  if (
    snapshot.signedIn !== signedIn ||
    snapshot.locked !== locked ||
    snapshot.unlocked !== unlocked
  ) {
    snapshot = { signedIn, locked, unlocked };
  }
  return snapshot;
}

export function useSession(): Session {
  return useSyncExternalStore(subscribeToSession, currentSnapshot, currentSnapshot);
}
