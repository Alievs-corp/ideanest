import { useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { isLocale, localeForCountry, type Locale } from '@ideanest/messages';
import { DEFAULT_LOCALE } from '../api/config';
import { deviceStore } from './storage';

/**
 * Which language the application speaks — issue #150.
 *
 * <h2>A choice, not a URL</h2>
 *
 * The web carries the language in the path. A phone has no path, so the answer is
 * resolved in this order, first hit wins:
 *
 * 1. the reader's stored choice (MMKV);
 * 2. when signed in, the account's language — it wins over the stored choice and
 *    overwrites it, as the web's `SessionProvider` does with its cookie;
 * 3. first launch: the device's preferred languages, first one that is one of the four
 *    (Georgian then Russian reads Russian);
 * 4. the device region through the web's own country table (`AZ` → az, `RU` → ru …);
 * 5. Azerbaijani.
 *
 * Language beats region on purpose: somebody in Baku with an English phone reads English.
 */

const STORAGE_KEY = 'locale';

export interface LocaleInputs {
  readonly stored: string | null | undefined;
  readonly account: string | null | undefined;
  readonly languages: readonly { readonly languageCode?: string | null }[];
  readonly region: string | null | undefined;
}

/** The pure resolver, so the five-step order is testable without a device. */
export function resolveLocale(inputs: LocaleInputs): Locale {
  if (isLocale(inputs.account)) return inputs.account;
  if (isLocale(inputs.stored)) return inputs.stored;
  for (const language of inputs.languages) {
    const tag = language.languageCode?.toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return localeForCountry(inputs.region) ?? DEFAULT_LOCALE;
}

function fromDevice(): Locale {
  const locales = getLocales();
  return resolveLocale({
    stored: deviceStore.getString(STORAGE_KEY),
    account: null,
    languages: locales,
    region: locales[0]?.regionCode,
  });
}

let current: Locale = fromDevice();
const listeners = new Set<() => void>();

/** The language in use right now. Synchronous, so `Accept-Language` can read it per request. */
export function currentLocale(): Locale {
  return current;
}

/**
 * Switches the language, persists the choice and re-renders subscribers with no restart.
 *
 * Rule 2 (the account language from `GET /v1/me` overwriting the stored choice) will call
 * this too, once the session reads `/v1/me`; nothing reads it yet.
 */
export function setLocale(next: Locale): void {
  // Persisted even when unchanged: tapping the language already in use is still a choice,
  // and it must outlive a later change of the phone's own language.
  deviceStore.set(STORAGE_KEY, next);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, currentLocale);
}
