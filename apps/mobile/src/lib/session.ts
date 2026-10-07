import * as SecureStore from 'expo-secure-store';
import { translate } from './i18n';
import { forgetPin, savePin } from './pin';
import { deviceStore, type KeyValueStore } from './storage';

/**
 * Where the session lives on a phone — §16's `Authorization: Bearer` with the refresh token in
 * secure storage — and the flags of the app lock in front of it (§4.12 MB-03, issue #319).
 *
 * <h2>Why this is not `lib/storage.ts`</h2>
 *
 * The web keeps its refresh token in a `SameSite=Strict; HttpOnly` cookie, which JavaScript on the
 * page cannot read at all. A phone has no equivalent, so the nearest true thing is the platform
 * keychain: Keychain Services on iOS, the Android Keystore behind encrypted preferences. Both are
 * backed by hardware on any device this application supports, and both survive an application
 * update, while MMKV's plain file does not deserve to hold a credential in the first place.
 *
 * <h2>Access token in memory, refresh token on disk</h2>
 *
 * The access token lasts fifteen minutes (§16.2) and is never written down. A fifteen-minute
 * credential in persistent storage is a credential that outlives the reason it existed: the
 * process restarting is exactly the moment to go and get a fresh one, and the refresh token is
 * what makes that free.
 *
 * <h2>ONE ITEM, AND NO READ OF IT EVER SHOWS A PROMPT</h2>
 *
 * The refresh token is always in the ordinary item, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: encrypted
 * by the operating system, readable by this application while the phone is unlocked, and never
 * behind a biometric prompt. The app lock is a gate in front of the interface
 * (`lib/app-lock.ts`), not a property of where the token is kept.
 *
 * <p>Until #319 it was the other way round: with the lock on, the token lived in an item written
 * with `requireAuthentication`, so every read of it presented the system prompt. That was a gate
 * JavaScript could not go around, and it was unusable. A refresh reads the token AND writes the
 * rotated one back (§17.1 rotates on every use), and on Android `expo-secure-store` authenticates
 * the cipher for a write to such an item as well as for a read — so one cold start showed the
 * fingerprint prompt twice in a row, and every fifteen-minute expiry, and every re-lock, showed it
 * twice again on whatever screen made the next request. With no fallback: a wet finger or a
 * sensor lockout left the owner locked out of their own session. The owner chose a gate that asks
 * once, with a PIN behind it, over a keychain binding that asks at every refresh; this file is
 * the half of that decision that keeps the token readable.
 *
 * <p>Installs from before #319 still have the old item. {@link migrateLegacyLock} moves the token
 * out of it — one prompt, once — and every failure order leaves the session readable from one of
 * the two places.
 *
 * <h2>Whether somebody is signed in is answered without reading the keychain</h2>
 *
 * `SavedScreen` and `PledgesScreen` ask on mount, to decide between a list and an invitation to
 * sign in, and a keychain read is asynchronous: a screen that waited for it would flash "sign in"
 * for a frame. So the fact that a session exists is a boolean in `deviceStore`, and so is whether
 * the lock is on — the gate has to decide what the first frame shows before anything asynchronous
 * has answered.
 *
 * <p>Those booleans are <strong>not</strong> credentials and do not weaken `lib/storage.ts`'s rule
 * about what may go in MMKV: anything that can read them already has the application's sandbox.
 * They are also not authoritative: {@link storedRefreshToken} clears them when the keychain turns
 * out to disagree, which is what a revoked Android key or a restored backup looks like from here.
 */

/** The refresh token. Readable whenever the device is unlocked; never prompts. */
const REFRESH_TOKEN_KEY = 'ideanest.refresh-token';

/**
 * The item the token lived in, before #319, while the lock was on. Reading it presents the system
 * prompt. Only {@link migrateLegacyLock} reads it, and only once; sign-out still deletes it.
 *
 * <p>A different key AND a different `keychainService` from the item above: an authenticated
 * entry is generated against its own key and does not share a service with unauthenticated ones.
 */
const LOCKED_REFRESH_TOKEN_KEY = 'ideanest.refresh-token.locked';
const LOCKED_KEYCHAIN_SERVICE = 'az.ideanest.app.locked';

/** MMKV: whether there is a session at all. */
const PRESENT_KEY = 'session.present';
/**
 * MMKV: the pre-#319 lock flag. Set means the token may still be in the locked item, so it now
 * reads as "migration owed" and is removed only after the token has been moved.
 */
const LEGACY_LOCKED_KEY = 'session.locked';
/** MMKV: the app lock is on (#319). Always with a PIN, except between a migration and its PIN. */
const LOCK_ON_KEY = 'app-lock.on';
/** MMKV: the lock is on and the owner still owes it a PIN — a migrated install, until they set one. */
const PIN_REQUIRED_KEY = 'app-lock.pin-required';
/**
 * MMKV: the migration has written the token to the ordinary item. Without it, a token found in
 * the ordinary item during a migration is not ours to trust — it can be a stale one an earlier
 * build left behind when the lock was turned on — and the old item is read instead.
 */
const MIGRATED_KEY = 'app-lock.token-moved';

let accessToken: string | null = null;

/**
 * Where the flags are kept.
 *
 * <p>Injectable for the same reason `lib/offline.ts` takes a store: these booleans decide what
 * every screen renders before a network call happens, and a test that had to reach into the
 * module-level MMKV to set them would be asserting against the mock rather than against this file.
 */
let flags: KeyValueStore = deviceStore;

/** Replaces the flag store. For tests, and for nothing else. */
export function useFlagStore(store: KeyValueStore): void {
  flags = store;
  announce();
}

/**
 * Who wants to know when the session changes.
 *
 * <p>`lib/use-session.ts` and `lib/app-lock.ts` subscribe. The store lives here rather than in a
 * hook because this file is what actually changes the state: a hook that had to be told would be a
 * hook that four call sites can forget to tell.
 */
const listeners = new Set<() => void>();

/** Subscribes to session changes. Returns the unsubscribe. */
export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

/** The access token this process is holding, if any. */
export function currentAccessToken(): string | null {
  return accessToken;
}

/** Remembers an access token for the life of the process. Never persisted. */
export function rememberAccessToken(token: string | null): void {
  if (accessToken === token) return;
  accessToken = token;
  announce();
}

/**
 * Whether this device holds a session, answered without touching the keychain.
 *
 * <p>Synchronous, which is what lets a screen decide what to draw in its first render.
 */
export function hasStoredSession(): boolean {
  return flags.getString(PRESENT_KEY) === 'true';
}

/** Whether the app lock is on — a pre-#319 lock still waiting for its migration included. */
export function isLockOn(): boolean {
  return flags.getString(LOCK_ON_KEY) === 'true' || flags.getString(LEGACY_LOCKED_KEY) === 'true';
}

/** Whether this is a pre-#319 locked session whose token is (or may be) in the old item. */
export function needsLockMigration(): boolean {
  return hasStoredSession() && flags.getString(LEGACY_LOCKED_KEY) === 'true';
}

/** Whether the lock is on without a PIN yet: a migrated install that has not chosen one. */
export function isPinRequired(): boolean {
  return flags.getString(PIN_REQUIRED_KEY) === 'true';
}

/**
 * The refresh token. Never presents a prompt.
 *
 * @returns the token, or null when nobody is signed in, when a pre-#319 token has not been moved
 *     out of the old item yet, or when the keychain refused for any other reason
 */
export async function storedRefreshToken(): Promise<string | null> {
  if (!hasStoredSession()) return null;

  // A migration is owed and has not moved the token yet: whatever the ordinary item holds is not
  // the session's (see MIGRATED_KEY). Nothing to send until the migration has run.
  if (needsLockMigration() && flags.getString(MIGRATED_KEY) !== 'true') return null;

  try {
    const token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (token === null && !needsLockMigration()) {
      /*
       * The flag said there was a session and the keychain says there is not. That is a real
       * state rather than an impossible one — an Android key is invalidated when the screen lock
       * changes, and a restored backup brings MMKV back without the keychain — and the flag is the
       * half that is wrong. Correcting it here means the next screen renders the sign-in prompt
       * instead of an empty list that never loads.
       *
       * Not while a migration is owed: then the token is in the old item, and reading that is the
       * migration's one prompt, not a request's.
       */
      forgetFlags();
    }
    return token;
  } catch {
    /*
     * A keychain read can fail for reasons that are not "no session": a device locked with
     * `WHEN_UNLOCKED` set, or a keystore that is briefly unavailable. Treating that as signed-out
     * for the length of this call is the safe reading, and the flags are deliberately NOT
     * cleared: a transient failure must not turn into "sign in again".
     */
    return null;
  }
}

/**
 * Stores a refresh token, in the one item.
 *
 * <p>Passing null ends the session on this device: both items, every flag, the PIN and its
 * counter (`endSession`).
 */
export async function storeRefreshToken(token: string | null): Promise<void> {
  if (token === null) {
    await clearEverything();
    return;
  }
  await writeToken(token);
  flags.set(PRESENT_KEY, 'true');
  announce();
}

/**
 * Turns the app lock on with a PIN, or gives a migrated lock its PIN.
 *
 * <p>The PIN is saved first and the flag flipped second, so a failure leaves the lock off rather
 * than on with nothing to open it. Whoever calls this has already confirmed the PIN twice
 * (`features/lock/pin-flow.tsx`).
 *
 * @returns false when there is no session to lock. Turning the lock on with nobody signed in
 *     would set a flag that the next sign-in silently obeys
 */
export async function enableLock(pin: string): Promise<boolean> {
  if (!hasStoredSession()) return false;
  await savePin(pin);
  flags.set(LOCK_ON_KEY, 'true');
  flags.remove(PIN_REQUIRED_KEY);
  announce();
  return true;
}

/**
 * Turns the app lock off and erases the PIN.
 *
 * <p>This does not ask for anything: the gate is in the interface now, so the interface asks
 * first (`lib/app-lock.ts`'s `confirmIdentity`), and settings only offer it to somebody who has
 * just unlocked.
 */
export async function disableLock(): Promise<void> {
  flags.remove(LOCK_ON_KEY);
  flags.remove(PIN_REQUIRED_KEY);
  announce();
  await forgetPin();
}

/** What {@link migrateLegacyLock} did. */
export type LockMigration =
  /** Not a pre-#319 locked session. Nothing to do. */
  | 'none'
  /** The owner passed the one prompt and the token moved. This launch is unlocked. */
  | 'migrated'
  /**
   * The token had already been copied by an interrupted earlier run, so nothing was read and
   * nobody was asked. The lock stays shut: this launch has not been unlocked.
   */
  | 'recovered'
  /** The prompt was refused or cancelled. Nothing changed; the old item still holds the token. */
  | 'refused'
  /** The token was read but could not be written. Nothing changed. */
  | 'failed'
  /** The old item was empty — a key invalidated, a backup restored. The session was already gone. */
  | 'lost';

/**
 * Moves a pre-#319 locked session's token into the ordinary item — issue #319's migration.
 *
 * <h2>Every failure order keeps the session</h2>
 *
 * 1. If an earlier run marked the token as moved (`MIGRATED_KEY`), the ordinary item is read
 *    without a prompt and the old item is not read at all (`recovered`). Without the mark, a token
 *    in the ordinary item is ignored: it can be a stale one a pre-#319 build left behind.
 * 2. Otherwise the old item is read — the one prompt. Refused: nothing has changed (`refused`).
 * 3. The token is written to the ordinary item, then marked as moved. A failure: nothing else has
 *    changed, the old item still holds it, and the next launch tries again (`failed`).
 * 4. The lock's new flags are set — on, and owing a PIN.
 * 5. The old item is deleted. A deletion does not prompt; if it fails, the legacy flag stays and
 *    the next launch takes step 1's path and deletes it then.
 * 6. Only now is the legacy flag removed.
 *
 * A crash between any two steps leaves a token that is readable without a prompt (after 3) or
 * behind the one prompt it was always behind (before 3).
 */
export async function migrateLegacyLock(): Promise<LockMigration> {
  if (!needsLockMigration()) return 'none';

  let outcome: LockMigration = 'migrated';
  let token: string | null = null;
  if (flags.getString(MIGRATED_KEY) === 'true') {
    try {
      token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      token = null;
    }
  }

  if (token !== null) {
    outcome = 'recovered';
  } else {
    try {
      token = await SecureStore.getItemAsync(LOCKED_REFRESH_TOKEN_KEY, {
        keychainService: LOCKED_KEYCHAIN_SERVICE,
        requireAuthentication: true,
        authenticationPrompt: translate()('mobile.lock.prompt'),
      });
    } catch {
      return 'refused';
    }
    if (token === null) {
      // Nothing behind the prompt either: the session was gone before this ran.
      forgetFlags();
      return 'lost';
    }
    try {
      await writeToken(token);
    } catch {
      return 'failed';
    }
    flags.set(MIGRATED_KEY, 'true');
  }

  flags.set(LOCK_ON_KEY, 'true');
  flags.set(PIN_REQUIRED_KEY, 'true');
  try {
    await deleteLegacyItem();
  } catch {
    announce();
    return outcome;
  }
  flags.remove(LEGACY_LOCKED_KEY);
  flags.remove(MIGRATED_KEY);
  announce();
  return outcome;
}

/** Forgets everything about the current session, in every place it is kept. */
export async function endSession(): Promise<void> {
  rememberAccessToken(null);
  await clearEverything();
}

async function writeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Deleting the authenticated entry does not present a prompt on either platform — removal is not
 * a read — so neither signing out nor finishing a migration asks anybody to prove who they are.
 */
async function deleteLegacyItem(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCKED_REFRESH_TOKEN_KEY, {
    keychainService: LOCKED_KEYCHAIN_SERVICE,
  });
}

/**
 * The session, the old item, the lock's flags, the PIN and its counter. Every step is attempted
 * even when an earlier one fails — the case where one of them throws is exactly the case where
 * somebody is trying to get rid of all of it — and the first failure is rethrown at the end.
 */
async function clearEverything(): Promise<void> {
  forgetFlags();
  const steps = [
    () => SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    deleteLegacyItem,
    forgetPin,
  ];
  let failure: unknown = null;
  for (const step of steps) {
    try {
      await step();
    } catch (cause) {
      failure ??= cause;
    }
  }
  if (failure !== null) throw failure;
}

function forgetFlags(): void {
  flags.remove(PRESENT_KEY);
  flags.remove(LEGACY_LOCKED_KEY);
  flags.remove(LOCK_ON_KEY);
  flags.remove(PIN_REQUIRED_KEY);
  flags.remove(MIGRATED_KEY);
  announce();
}
