import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * The app lock's PIN — issue #319. Six digits, kept on this phone and nowhere else.
 *
 * <h2>What is stored, and where</h2>
 *
 * Never the PIN. A random 16-byte salt and PBKDF2-HMAC-SHA256 of the PIN under it, with the
 * iteration count beside them so a later count can be adopted without invalidating anybody's PIN
 * ({@link checkPin} re-derives at the current count after a correct entry). The record lives in
 * the ordinary secure-store item — Keychain on iOS, Keystore-encrypted preferences on Android,
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — next to the refresh token it guards, and never in MMKV.
 *
 * <h2>Why the derivation is cheap, and why that is honest</h2>
 *
 * There is no native PBKDF2 in the app (`expo-crypto` has digests and random bytes only), so the
 * derivation is `@noble/hashes` in JavaScript, and Hermes interprets JavaScript: measured with the
 * Hermes CLI on a desktop, 1,000 iterations take about 125 ms; a Galaxy A-class phone is three to
 * five times slower, so {@link KDF_ITERATIONS} is 1,000 to stay near the half-second an unlock may
 * cost. OWASP's 600,000 would take minutes there.
 *
 * <p>No count a phone can afford protects a six-digit PIN from an offline guess — a million
 * candidates is seconds on a GPU at any of them. What protects the PIN is where the record is (the
 * operating system's encrypted store, readable only by this application on an unlocked device —
 * and anybody who can read it can read the refresh token beside it, which is the asset) and the
 * attempt limit in front of it ({@link MAX_PIN_ATTEMPTS}, then a local sign-out). The derivation
 * makes the record one-way and salted, so the PIN is not sitting there to be read at a glance or
 * matched across installs; that is all it is claimed to do.
 *
 * <h2>The attempt counter</h2>
 *
 * Also in secure storage, for the same reason as the record: a counter in MMKV is a file that can
 * be reset between guesses. It is written before the answer is shown, so killing the app after a
 * wrong entry does not undo the attempt.
 */

/** Digits in a PIN. */
export const PIN_LENGTH = 6;

/** Wrong PINs before the session on this phone is erased (`lib/app-lock.ts`). */
export const MAX_PIN_ATTEMPTS = 5;

/** PBKDF2-HMAC-SHA256 iterations for a new record. See the note above for the measurement. */
export const KDF_ITERATIONS = 1_000;

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** How long the derivation may hold the JS thread before yielding to it, in ms. */
const KDF_TICK_MS = 8;

const PIN_KEY = 'ideanest.app-lock.pin';
const ATTEMPTS_KEY = 'ideanest.app-lock.failures';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** The stored form. Versioned, so a different derivation later is a new `v`, not a guess. */
export interface PinRecord {
  readonly v: 1;
  readonly kdf: 'pbkdf2-sha256';
  readonly iterations: number;
  readonly salt: string;
  readonly hash: string;
}

/** Whether a string is a whole PIN: exactly six ASCII digits. */
export function isPin(value: string): boolean {
  return value.length === PIN_LENGTH && /^[0-9]+$/.test(value);
}

/** ASCII digits as bytes. Not `TextEncoder`, which an older Hermes does not have. */
function bytesOf(pin: string): Uint8Array {
  return Uint8Array.from(pin, (character) => character.charCodeAt(0));
}

/** PBKDF2-HMAC-SHA256 of the PIN, yielding to the JS thread every few milliseconds. */
export async function derivePin(
  pin: string,
  salt: Uint8Array,
  iterations: number = KDF_ITERATIONS,
): Promise<Uint8Array> {
  return await pbkdf2Async(sha256, bytesOf(pin), salt, {
    c: iterations,
    dkLen: KEY_BYTES,
    asyncTick: KDF_TICK_MS,
  });
}

/**
 * Compares two byte strings in time that depends only on their length. The length of a derived
 * key is public (it is always {@link KEY_BYTES}), so an early answer for a different length leaks
 * nothing.
 */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** A fresh record for a PIN, under a new random salt. */
export async function hashPin(pin: string): Promise<PinRecord> {
  if (!isPin(pin)) throw new Error('A PIN is six digits.');
  const salt = getRandomBytes(SALT_BYTES);
  const hash = await derivePin(pin, salt);
  return {
    v: 1,
    kdf: 'pbkdf2-sha256',
    iterations: KDF_ITERATIONS,
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  };
}

/** Whether a PIN matches a record. Never throws; a record it cannot read matches nothing. */
export async function matchesRecord(record: PinRecord, pin: string): Promise<boolean> {
  if (!isPin(pin)) return false;
  try {
    const expected = hexToBytes(record.hash);
    const actual = await derivePin(pin, hexToBytes(record.salt), record.iterations);
    return sameBytes(actual, expected);
  } catch {
    return false;
  }
}

function parseRecord(raw: string | null): PinRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<PinRecord>;
    if (
      value.v === 1 &&
      value.kdf === 'pbkdf2-sha256' &&
      typeof value.iterations === 'number' &&
      value.iterations > 0 &&
      typeof value.salt === 'string' &&
      typeof value.hash === 'string'
    ) {
      return value as PinRecord;
    }
  } catch {
    // A record that is not JSON is no record.
  }
  return null;
}

async function readRecord(): Promise<PinRecord | null> {
  try {
    return parseRecord(await SecureStore.getItemAsync(PIN_KEY));
  } catch {
    return null;
  }
}

/** Replaces the PIN. Resets the attempt counter: a new PIN starts with every attempt. */
export async function savePin(pin: string): Promise<void> {
  const record = await hashPin(pin);
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), STORE_OPTIONS);
  await resetPinAttempts();
}

/** Whether a PIN is stored on this phone. */
export async function hasPin(): Promise<boolean> {
  return (await readRecord()) !== null;
}

/**
 * Whether a PIN is the stored one. Does NOT count the attempt — {@link recordFailedAttempt} does,
 * so the caller decides what a wrong entry costs.
 *
 * <p>A correct entry against a record derived at an older iteration count is re-derived at the
 * current one; a failure to save it changes nothing, and the old record still works.
 */
export async function checkPin(pin: string): Promise<boolean> {
  const record = await readRecord();
  if (record === null) return false;
  const matches = await matchesRecord(record, pin);
  if (matches && record.iterations !== KDF_ITERATIONS) {
    try {
      await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(await hashPin(pin)), STORE_OPTIONS);
    } catch {
      // Kept at the old count. It still verifies.
    }
  }
  return matches;
}

/** Wrong entries since the last correct one. Persisted; a read failure counts as none recorded. */
export async function failedPinAttempts(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(ATTEMPTS_KEY);
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

/** Counts a wrong entry and answers the new total. Written before anything is shown. */
export async function recordFailedAttempt(): Promise<number> {
  const count = (await failedPinAttempts()) + 1;
  await SecureStore.setItemAsync(ATTEMPTS_KEY, String(count), STORE_OPTIONS);
  return count;
}

/** After a correct PIN or a passed biometric prompt. */
export async function resetPinAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
}

/** Erases the PIN and the counter — turning the lock off, and every sign-out. */
export async function forgetPin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PIN_KEY);
  } finally {
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
  }
}
