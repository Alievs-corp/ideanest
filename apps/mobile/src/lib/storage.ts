import { bytesToHex } from '@noble/hashes/utils.js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * The device's key/value store — §14.3's MMKV, behind the one seam that keeps it
 * testable.
 *
 * <h2>Why an interface rather than the MMKV instance</h2>
 *
 * MMKV is a native module with no JavaScript implementation. That is the reason
 * to use it — a synchronous read is what lets `lib/offline.ts` hydrate the query
 * cache before the first frame instead of after it — and it is also the reason
 * every module that touched it directly would be untestable outside a simulator.
 * The interface is four methods wide because that is all the persister needs.
 *
 * <h2>What must never be stored here</h2>
 *
 * **No tokens.** MMKV is fast and readable by anything with the application's
 * sandbox. §12 puts the refresh token in the platform keychain, which is what
 * `lib/session.ts` uses. What belongs here is the cache: campaign summaries a
 * backer has already been shown, which of them they saved, an editor draft not
 * yet sent. Losing all of it costs one network round trip.
 *
 * <h2>Encrypted at rest (#587)</h2>
 *
 * The file is AES-256 under a random key that lives in the keychain beside the
 * session, never in the file system. A copy of the file alone — a backup, a
 * rooted phone's file browser, a forensic image without the keystore — is noise.
 * {@link openDeviceStore} has how the key is made, and how a store written in
 * plain text by an older build is converted on the first launch after the update.
 */
export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  /**
   * Named `remove` because that is what MMKV v4 calls it. A wrapper that renamed
   * it to `delete` would read better and would be the reason somebody later
   * "fixes" the implementation by calling a method that does not exist.
   */
  remove(key: string): void;
  getAllKeys(): readonly string[];
}

/** The store's id. Explicit, so that a second store cannot make this one "the other one". */
export const DEVICE_STORE_ID = 'ideanest';

/** Where the store's key is kept: the keychain, under its own name. */
export const STORE_KEY_ITEM = 'ideanest.storage.key';

/**
 * After first unlock rather than when unlocked: a notification can start the
 * process with the phone locked, and a key it cannot read then is a launch on a
 * memory store. This device only, so an iCloud backup carries the file and never
 * the key — which is the point.
 */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** What {@link openDeviceStore} needs from the platform, so a test can be the platform. */
export interface StorePlatform {
  /** MMKV's own factory. */
  readonly open: (config: { id: string; encryptionKey?: string; encryptionType?: 'AES-256' }) => Pick<
    MMKV,
    'getString' | 'set' | 'remove' | 'getAllKeys' | 'encrypt'
  >;
  /** The keychain, synchronously: the store is opened before the first frame. */
  readonly readKey: () => string | null;
  readonly writeKey: (key: string) => void;
  /** Best effort, and only after a conversion that failed. */
  readonly forgetKey: () => void;
  /** Thirty-two printable bytes from a CSPRNG. */
  readonly newKey: () => string;
}

/**
 * Opens the device's store under its keychain key, making the key the first time.
 *
 * <h2>The key</h2>
 *
 * Sixteen random bytes as hex: thirty-two ASCII characters, which is the exact
 * length MMKV's AES-256 takes. 128 bits of entropy in a 256-bit key is more
 * than enough; hex keeps every byte printable, so the key survives the keychain's
 * string API unchanged.
 *
 * <h2>The first launch after the update</h2>
 *
 * There is no key yet and the file, if any, is plain text. The key is written to
 * the keychain FIRST, then the open store is re-encrypted in place with MMKV's
 * `encrypt` — the order that cannot lose the key to a file that needs it. If the
 * conversion throws, the key is taken back out so that the next launch tries
 * again on the still-plain file rather than opening it with a key it was never
 * encrypted under.
 *
 * <h2>Failing closed, to memory</h2>
 *
 * A keychain that cannot be read or written gives this launch a store in memory.
 * Opening the file without its key would read an encrypted file as garbage —
 * MMKV discards it — and keep writing plain text; the memory store does neither.
 * It costs the offline cache for one launch, on a phone whose keychain is also
 * where the session lives and is just as unavailable.
 *
 * A key with no readable file behind it (an iOS restore brings the file and not
 * the key) is the same as no key: MMKV discards what it cannot decrypt, and the
 * cache refills from the network.
 */
export function openDeviceStore(platform: StorePlatform): KeyValueStore {
  let key: string | null;
  try {
    key = platform.readKey();
  } catch {
    return memoryStore();
  }

  if (key !== null && key !== '') {
    try {
      return platform.open({ id: DEVICE_STORE_ID, encryptionKey: key, encryptionType: 'AES-256' });
    } catch {
      return memoryStore();
    }
  }

  const fresh = platform.newKey();
  try {
    platform.writeKey(fresh);
  } catch {
    return memoryStore();
  }

  try {
    const store = platform.open({ id: DEVICE_STORE_ID });
    store.encrypt(fresh, 'AES-256');
    return store;
  } catch {
    try {
      platform.forgetKey();
    } catch {
      // The next launch then opens the plain file with this key and MMKV discards it: a
      // cache lost once, which is what failing here already cost.
    }
    return memoryStore();
  }
}

/** The platform as it is on a phone. */
const nativePlatform: StorePlatform = {
  open: (config) => createMMKV(config),
  readKey: () => SecureStore.getItem(STORE_KEY_ITEM, KEY_OPTIONS),
  writeKey: (key) => SecureStore.setItem(STORE_KEY_ITEM, key, KEY_OPTIONS),
  forgetKey: () => void SecureStore.deleteItemAsync(STORE_KEY_ITEM, KEY_OPTIONS).catch(() => undefined),
  newKey: () => bytesToHex(getRandomBytes(16)),
};

/** The application's store. */
export const deviceStore: KeyValueStore = openDeviceStore(nativePlatform);

/** A store that lives only as long as the process. For tests, and for nothing else. */
export function memoryStore(): KeyValueStore {
  const entries = new Map<string, string>();
  return {
    getString: (key) => entries.get(key),
    set: (key, value) => void entries.set(key, value),
    remove: (key) => void entries.delete(key),
    getAllKeys: () => [...entries.keys()],
  };
}
