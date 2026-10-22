import { useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { ALL_MARKETS, marketParameter, resolveMarket } from '@ideanest/messages/country';
import { deviceStore } from './storage';

/**
 * The reader's market in the app — issue #533.
 *
 * The country whose campaigns every list shows: the reader's choice, kept on the device, then
 * the phone's region (the app's stand-in for the web's Cloudflare country), then Azerbaijan.
 * `ALL_MARKETS` is every country.
 */

const STORAGE_KEY = 'market';

function fromDevice(): string {
  return resolveMarket(deviceStore.getString(STORAGE_KEY), getLocales()[0]?.regionCode);
}

let current: string = fromDevice();
const listeners = new Set<() => void>();

export function currentMarket(): string {
  return current;
}

/** Remembered on the device, and from now on it outranks where the phone is. */
export function setMarket(next: string): void {
  deviceStore.set(STORAGE_KEY, next);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useMarket(): string {
  return useSyncExternalStore(subscribe, currentMarket, currentMarket);
}

/** `{ market }` for the service, or nothing for every country. */
export function marketQuery(market: string): { market?: string } {
  const code = marketParameter(market);
  return code === null ? {} : { market: code };
}

export { ALL_MARKETS };
