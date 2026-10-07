import * as SecureStore from 'expo-secure-store';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  KDF_ITERATIONS,
  checkPin,
  derivePin,
  failedPinAttempts,
  forgetPin,
  hasPin,
  hashPin,
  isPin,
  matchesRecord,
  recordFailedAttempt,
  resetPinAttempts,
  sameBytes,
  savePin,
} from './pin';

/**
 * The app lock's PIN (#319): what is stored, how it is checked, and the counter that ends the
 * session after five wrong entries.
 */

const keychain = SecureStore as unknown as {
  __setReadsFail: (fail: boolean) => void;
  __setWritesFail: (fail: boolean) => void;
  __reset: () => void;
  __entries: () => string[];
  __put: (key: string, value: string) => void;
};

beforeEach(() => keychain.__reset());

describe('the stored form', () => {
  it('is a salted PBKDF2-HMAC-SHA256 record, never the PIN', async () => {
    await savePin('482913');

    const raw = await SecureStore.getItemAsync('ideanest.app-lock.pin');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('482913');
    const record = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({ v: 1, kdf: 'pbkdf2-sha256', iterations: KDF_ITERATIONS });
    expect(record['salt']).toMatch(/^[0-9a-f]{32}$/);
    expect(record['hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the standard derivation, so it can be checked by anything that implements it', async () => {
    const salt = new Uint8Array(16).fill(7);
    const expected = pbkdf2(sha256, new Uint8Array([49, 50, 51, 52, 53, 54]), salt, {
      c: KDF_ITERATIONS,
      dkLen: 32,
    });
    expect(bytesToHex(await derivePin('123456', salt))).toBe(bytesToHex(expected));
  });

  it('takes a new salt each time, so the same PIN is never stored the same way twice', async () => {
    const one = await hashPin('111111');
    const two = await hashPin('111111');
    expect(one.salt).not.toBe(two.salt);
    expect(one.hash).not.toBe(two.hash);
  });

  it('takes only six digits', async () => {
    expect(isPin('123456')).toBe(true);
    for (const bad of ['12345', '1234567', '12345a', '', '１２３４５６']) expect(isPin(bad)).toBe(false);
    await expect(hashPin('12345')).rejects.toThrow();
  });
});

describe('checking a PIN', () => {
  it('accepts the stored PIN and refuses any other', async () => {
    await savePin('482913');
    expect(await checkPin('482913')).toBe(true);
    expect(await checkPin('482914')).toBe(false);
    expect(await checkPin('')).toBe(false);
  });

  it('refuses everything when no PIN is stored, or the record is unreadable', async () => {
    expect(await checkPin('000000')).toBe(false);
    keychain.__put('ideanest.app-lock.pin', 'not json');
    expect(await checkPin('000000')).toBe(false);
    expect(await hasPin()).toBe(false);
  });

  it('checks a record at the count it was made with, and re-derives it at the current one', async () => {
    const salt = new Uint8Array(16).fill(1);
    const old = {
      v: 1 as const,
      kdf: 'pbkdf2-sha256' as const,
      iterations: 10,
      salt: bytesToHex(salt),
      hash: bytesToHex(await derivePin('246810', salt, 10)),
    };
    expect(await matchesRecord(old, '246810')).toBe(true);
    keychain.__put('ideanest.app-lock.pin', JSON.stringify(old));

    expect(await checkPin('246810')).toBe(true);
    const upgraded = JSON.parse((await SecureStore.getItemAsync('ideanest.app-lock.pin')) ?? '{}');
    expect(upgraded.iterations).toBe(KDF_ITERATIONS);
    expect(await checkPin('246810')).toBe(true);
  });

  it('compares in constant time over the whole length', () => {
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(sameBytes(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  /*
   * THE BUDGET. Under Jest this is V8 with its JIT, so the number is a floor, not the phone's:
   * Hermes interprets, and the Hermes CLI measured 1,000 iterations at ~125 ms on a desktop —
   * about 0.4–0.6 s on a Galaxy A-class phone (`lib/pin.ts` has the arithmetic). What this
   * guards is the order of magnitude: somebody raising KDF_ITERATIONS to OWASP's 600,000 fails
   * here instead of on a phone that takes a minute to unlock.
   */
  it('derives within the unlock budget', async () => {
    const started = Date.now();
    await derivePin('123456', new Uint8Array(16));
    expect(Date.now() - started).toBeLessThan(500);
    expect(KDF_ITERATIONS).toBeLessThanOrEqual(2_000);
  });
});

describe('the attempt counter', () => {
  it('counts wrong entries and persists them in secure storage', async () => {
    expect(await failedPinAttempts()).toBe(0);
    expect(await recordFailedAttempt()).toBe(1);
    expect(await recordFailedAttempt()).toBe(2);
    // A new read, as a relaunch would make: the count is on disk, not in memory.
    expect(await SecureStore.getItemAsync('ideanest.app-lock.failures')).toBe('2');
    expect(await failedPinAttempts()).toBe(2);
  });

  it('resets on demand, and with a new PIN', async () => {
    await recordFailedAttempt();
    await resetPinAttempts();
    expect(await failedPinAttempts()).toBe(0);

    await recordFailedAttempt();
    await savePin('135790');
    expect(await failedPinAttempts()).toBe(0);
  });

  it('fails closed: a counter that cannot be read is at the limit, never back at zero', async () => {
    await recordFailedAttempt();
    keychain.__setReadsFail(true);
    expect(await failedPinAttempts()).toBe(5);
    expect(await recordFailedAttempt()).toBeGreaterThanOrEqual(5);
  });

  it('fails closed: an attempt that cannot be written counts as the limit', async () => {
    keychain.__setWritesFail(true);
    expect(await recordFailedAttempt()).toBe(5);
  });

  it('goes with the PIN', async () => {
    await savePin('135790');
    await recordFailedAttempt();
    await forgetPin();
    expect(keychain.__entries()).toEqual([]);
  });
});
