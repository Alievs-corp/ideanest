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
 * 1. the reader's stored choice (MMKV) — forgotten when the phone's first language changed
 *    since the last launch to another of the four, which is how the system's per-app
 *    setting speaks (`perAppLanguageChosen`);
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

/** The phone's first language as this app last saw it at launch. */
const DEVICE_KEY = 'locale.device';

/**
 * Whether the operating system's per-app language setting chose a language since the last
 * launch. It arrives as a new first entry in `getLocales()` and nothing else
 * (`CFBundleLocalizations` and Android's `localeConfig` list the four there, `app.config.ts`).
 *
 * That is a fresh preference and outranks the choice stored earlier in the app; otherwise the
 * phone's own setting would silently do nothing once somebody had tapped a language here. Only
 * a change *to one of the four* counts: the per-app setting offers nothing else, so a switch
 * to German is the whole phone changing language, which says nothing about this app, and the
 * stored choice stands. Nor does a change to the language already chosen here — there is
 * nothing to forget. Compared by language, not tag, so a new region (`en-US` → `en-GB`) is not
 * a new language; no record yet (the first launch, or the first since this rule) is no change.
 *
 * Known limit: setting the per-app language to the one the phone already speaks changes
 * nothing in `getLocales()`, so it cannot be told apart from no change at all.
 */
export function perAppLanguageChosen(
  lastSeen: string | null | undefined,
  now: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  return lastSeen != null && isLocale(now) && now !== lastSeen && now !== stored;
}

function fromDevice(): Locale {
  const locales = getLocales();
  const language = locales[0]?.languageCode?.toLowerCase() ?? null;
  const stored = deviceStore.getString(STORAGE_KEY);
  if (perAppLanguageChosen(deviceStore.getString(DEVICE_KEY), language, stored)) {
    deviceStore.remove(STORAGE_KEY);
  }
  if (language !== null) deviceStore.set(DEVICE_KEY, language);
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
