import * as SecureStore from 'expo-secure-store';
import { deviceStore, type KeyValueStore } from './storage';

/**
 * Where the session lives on a phone — §16's `Authorization: Bearer` with the
 * refresh token in secure storage, behind #29's biometric gate.
 *
 * <h2>Why this is not `lib/storage.ts`</h2>
 *
 * The web keeps its refresh token in a `SameSite=Strict; HttpOnly` cookie, which
 * JavaScript on the page cannot read at all. A phone has no equivalent, so the
 * nearest true thing is the platform keychain: Keychain Services on iOS, the
 * Android Keystore behind `EncryptedSharedPreferences`. Both are backed by
 * hardware on any device this application supports, and both survive an
 * application update while MMKV's plain file does not deserve to hold a
 * credential in the first place.
 *
 * <h2>Access token in memory, refresh token on disk</h2>
 *
 * The access token lasts fifteen minutes (§16.2) and is never written down. A
 * fifteen-minute credential in persistent storage is a credential that outlives
 * the reason it existed: the process restarting is exactly the moment to go and
 * get a fresh one, and the refresh token is what makes that free.
 *
 * <h2>#29: TWO KEYCHAIN ITEMS, AND ONLY EVER ONE OF THEM AT A TIME</h2>
 *
 * The biometric lock is not a check this application performs and could forget
 * to perform. It is a property of where the token is kept: with the lock on, the
 * token lives in an item written with {@code requireAuthentication}, and the
 * operating system refuses to return the bytes until a prompt succeeds.
 * JavaScript cannot go around that, which is the entire reason to prefer it over
 * an `if` somewhere in this file.
 *
 * The two items cannot be one item. Expo's own note is explicit that
 * {@code requireAuthentication} "would not work in tandem with the
 * {@code keychainService} value used for the other non-authenticated
 * operations": the authenticated entry is generated against a different key, so
 * turning the lock on or off is a **move** between two entries rather than a
 * flag on one. {@link enableLock} and {@link disableLock} are that move, and
 * both delete the source only after the destination has been written — a
 * failure half-way leaves a readable session rather than a lost one.
 *
 * <h2>Whether somebody is signed in must be answerable WITHOUT a prompt</h2>
 *
 * `SavedScreen` and `PledgesScreen` ask that question on mount, to decide
 * between a list and an invitation to sign in. Answering it by reading the
 * keychain would show a Face ID sheet to somebody who opened the Saved tab —
 * every cold start, before they asked for anything. So the fact that a session
 * exists is kept as a boolean in `deviceStore` and the token is fetched only
 * when a request actually needs one.
 *
 * That boolean is <strong>not</strong> a credential and does not weaken
 * `lib/storage.ts`'s rule about what may go in MMKV. Anything that can read it
 * already has the application's sandbox and learns only that somebody is signed
 * in — which the presence of a keychain entry tells it anyway. It is also not
 * authoritative: {@link storedRefreshToken} clears it when the keychain turns
 * out to disagree, which is what a revoked Android key or a restored backup
 * looks like from here.
 */

/** The item used when the lock is off. Readable whenever the device is unlocked. */
const REFRESH_TOKEN_KEY = 'ideanest.refresh-token';

/**
 * The item used when the lock is on. Reading it presents the system prompt.
 *
 * <p>A different key AND a different {@code keychainService} from the entry
 * above, for the reason in the class note: an authenticated entry is generated
 * against its own key and does not share a service with unauthenticated ones.
 */
const LOCKED_REFRESH_TOKEN_KEY = 'ideanest.refresh-token.locked';
const LOCKED_KEYCHAIN_SERVICE = 'az.ideanest.app.locked';

/** MMKV: whether there is a session at all, and whether it is the locked kind. */
const PRESENT_KEY = 'session.present';
const LOCKED_KEY = 'session.locked';

/** What the system prompt says when a request needs the token and the lock is on. */
const UNLOCK_PROMPT = 'Unlock IdeyaNest';

let accessToken: string | null = null;

/**
 * Where the flags are kept.
 *
 * <p>Injectable for the same reason `lib/offline.ts` takes a store: these two
 * booleans decide what every screen renders before a network call happens, and a
 * test that had to reach into the module-level MMKV to set them would be
 * asserting against the mock rather than against this file.
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
 * <p>`lib/use-session.ts` is the only subscriber and it is a
 * `useSyncExternalStore`. The store lives here rather than in the hook because
 * this file is what actually changes the state: a hook that had to be told would
 * be a hook that four call sites can forget to tell, and the symptom — a Saved
 * tab still showing "sign in" after a successful sign-in — is the kind that gets
 * fixed with a `router.replace` instead of with the missing notification.
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

/**
 * Remembers an access token for the life of the process. Never persisted.
 *
 * <p>Announced, because `use-session.ts` reports whether the gate has been
 * passed in this process and that is exactly what this changes. A screen that
 * says "unlocked" while the token it is describing has just been dropped is
 * telling somebody the next tap is free when it will show a prompt.
 */
export function rememberAccessToken(token: string | null): void {
  if (accessToken === token) return;
  accessToken = token;
  announce();
}

/**
 * Whether this device holds a session, answered without touching the keychain.
 *
 * <p>Synchronous and prompt-free, which is what lets a screen decide what to
 * draw in its first render. See the class note for why the honest-looking
 * alternative is not.
 */
export function hasStoredSession(): boolean {
  return flags.getString(PRESENT_KEY) === 'true';
}

/** Whether the stored session is behind the biometric gate. */
export function isLocked(): boolean {
  return flags.getString(LOCKED_KEY) === 'true';
}

/**
 * The refresh token, prompting for biometry when the lock is on.
 *
 * @returns the token, or null when nobody is signed in, when the reader refused
 *     the prompt, or when the keychain refused for any other reason
 */
export async function storedRefreshToken(): Promise<string | null> {
  if (!hasStoredSession()) return null;

  try {
    const token = isLocked()
      ? await SecureStore.getItemAsync(LOCKED_REFRESH_TOKEN_KEY, {
          keychainService: LOCKED_KEYCHAIN_SERVICE,
          requireAuthentication: true,
          authenticationPrompt: UNLOCK_PROMPT,
        })
      : await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

    if (token === null) {
      /*
       * The flag said there was a session and the keychain says there is not.
       * That is a real state rather than an impossible one — an Android key is
       * invalidated when the screen lock changes, and a restored backup brings
       * MMKV back without the keychain — and the flag is the half that is wrong.
       * Correcting it here means the next screen renders the sign-in prompt
       * instead of an empty list that never loads.
       */
      forgetFlags();
    }
    return token;
  } catch {
    /*
     * A keychain read can fail for reasons that are not "no session": a device
     * locked with `WHEN_UNLOCKED` set, a keystore invalidated because the user
     * changed their screen lock, or -- since #29 -- a biometric prompt the
     * reader dismissed. Treating that as signed-out for the length of this call
     * is the safe reading, and the flags are deliberately NOT cleared: a
     * dismissed prompt is somebody choosing to stay locked, and forgetting the
     * session would turn "not now" into "sign in again".
     */
    return null;
  }
}

/**
 * Stores a refresh token, in whichever item the current lock state names.
 *
 * <p>Passing null clears both items and both flags: signing out must not depend
 * on knowing which of the two the token was in, because the case where that is
 * wrong is exactly the case where somebody is trying to get rid of it.
 */
export async function storeRefreshToken(token: string | null): Promise<void> {
  if (token === null) {
    await clearBoth();
    return;
  }

  if (isLocked()) {
    await writeLocked(token);
  } else {
    await writeUnlocked(token);
  }
  flags.set(PRESENT_KEY, 'true');
  announce();
}

/**
 * Moves the session behind the biometric gate.
 *
 * <p>Ordered so that no failure loses the session: the locked entry is written
 * first, the flag is flipped second, and only then is the readable entry
 * removed. A crash between any two of those leaves a token that can still be
 * read — by the old path if the flag has not flipped, by the new one if it has.
 *
 * @returns false when there is no session to lock. Turning the lock on with
 *     nobody signed in would set a flag that the next sign-in silently obeys
 */
export async function enableLock(): Promise<boolean> {
  const token = await storedRefreshToken();
  if (token === null) return false;

  await writeLocked(token);
  flags.set(LOCKED_KEY, 'true');
  announce();
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  return true;
}

/**
 * Takes the session back out from behind the gate.
 *
 * <p>Reading the token is itself gated, so turning the lock off requires
 * passing it — which is the point. Somebody holding a phone they did not unlock
 * must not be able to disable the thing stopping them.
 *
 * @returns false when the prompt was refused or there was nothing to unlock
 */
export async function disableLock(): Promise<boolean> {
  const token = await storedRefreshToken();
  if (token === null) return false;

  await writeUnlocked(token);
  flags.set(LOCKED_KEY, 'false');
  announce();
  await SecureStore.deleteItemAsync(LOCKED_REFRESH_TOKEN_KEY, {
    keychainService: LOCKED_KEYCHAIN_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: UNLOCK_PROMPT,
  });
  return true;
}

/**
 * Re-arms the gate without ending the session.
 *
 * <h2>Why the lock needs this at all</h2>
 *
 * The keychain gate fires when the refresh token is read, and the access token
 * it produces then sits in memory for fifteen minutes. So a phone handed to
 * somebody else within that window reaches the pledges list without a prompt:
 * the gate is on the durable half of the session and the process is still
 * holding the disposable half.
 *
 * <p>Dropping the access token closes that window. The next private read has
 * nothing to send, `api/client.ts` refreshes, and the refresh reads the keychain
 * — which is the prompt. Nothing is deleted and nothing is revoked, so the cost
 * of being wrong about when to call this is one biometric prompt.
 *
 * <p>A no-op when the lock is off, deliberately: without the lock there is no
 * prompt for the next refresh to produce, so this would spend a round trip to
 * arrive back exactly where it started.
 */
export function lockNow(): void {
  if (!isLocked()) return;
  rememberAccessToken(null);
}

/** Forgets everything about the current session, in every place it is kept. */
export async function endSession(): Promise<void> {
  rememberAccessToken(null);
  await clearBoth();
}

async function writeUnlocked(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function writeLocked(token: string): Promise<void> {
  await SecureStore.setItemAsync(LOCKED_REFRESH_TOKEN_KEY, token, {
    keychainService: LOCKED_KEYCHAIN_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: UNLOCK_PROMPT,
    /*
     * `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` rather than the plain
     * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` used for the readable entry. It is the
     * accessibility class that means what the lock means: the entry exists only
     * while the device has a passcode, and removing the passcode destroys it
     * rather than downgrading it to something anybody can read. A locked session
     * that quietly survived the removal of the lock screen would be the one
     * outcome this feature must not produce.
     */
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
}

async function clearBoth(): Promise<void> {
  forgetFlags();
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  /*
   * Deleting the authenticated entry does not present a prompt on either
   * platform -- removal is not a read -- so signing out never asks somebody to
   * prove who they are in order to stop being signed in.
   */
  await SecureStore.deleteItemAsync(LOCKED_REFRESH_TOKEN_KEY, {
    keychainService: LOCKED_KEYCHAIN_SERVICE,
  });
}

function forgetFlags(): void {
  flags.remove(PRESENT_KEY);
  flags.remove(LOCKED_KEY);
  announce();
}
