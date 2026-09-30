import { useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { isLocale, localeForCountry, type Locale } from '@ideanest/messages';
import { DEFAULT_LOCALE } from '../api/config';
import { deviceStore } from './storage';

/**
 * Which language the application speaks — issues #150 and #216.
 *
 * <h2>A choice, not a URL</h2>
 *
 * The web carries the language in the path. A phone has no path, so the answer is
 * resolved in this order, first hit wins:
 *
 * 1. the device's explicit choice (MMKV): the app's language screen, or the system's per-app
 *    language setting, noticed at launch (`perAppLanguageChosen`), which replaces whatever
 *    was stored before it;
 * 2. the account's language, but only when {@link reconcileLocale} says so: the device has no
 *    explicit choice of its own (a fresh install, a first sign-in, a phone that only ever
 *    followed its own language), or the account's language changed elsewhere since this
 *    device last synced it (`locale.accountSynced`). Applying it makes it the stored choice;
 * 3. first launch: the device's preferred languages, first one that is one of the four
 *    (Georgian then Russian reads Russian);
 * 4. the device region through the web's own country table (`AZ` → az, `RU` → ru …);
 * 5. Azerbaijani.
 *
 * Language beats region on purpose: somebody in Baku with an English phone reads English.
 *
 * <h2>The latest explicit choice wins, and it is written to the account</h2>
 *
 * Issue #216. Whichever of the three explicit choices came last — this app's language screen,
 * the phone's per-app setting, the web's header switch — becomes the account's language
 * (`PATCH /v1/me/locale`), so mail, pushes and every other device follow it. A choice made
 * here is never overridden by a stale account value: until its `PATCH` lands it is marked
 * pending (`locale.pending`), and a pending choice outranks whatever the account says. No
 * clocks are compared between devices: "changed elsewhere" is simply "the account now says
 * something other than what this device last synced". That is last-writer-wins.
 * `lib/locale-sync.ts` does the writing; `lib/account-sync.tsx` does the reading.
 *
 * Nothing else changes the language: a whole phone moving to a language the app does not
 * have (German) is not a choice about this app, and `Accept-Language` is only ever what this
 * file decided, never an input to it.
 */

const STORAGE_KEY = 'locale';

/** The account language this device last applied or wrote — issue #216. */
export const ACCOUNT_SYNCED_KEY = 'locale.accountSynced';

/** A choice made here that the account has not accepted yet — issue #216. */
export const PENDING_KEY = 'locale.pending';

export interface LocaleInputs {
  readonly stored: string | null | undefined;
  readonly account: string | null | undefined;
  readonly languages: readonly { readonly languageCode?: string | null }[];
  readonly region: string | null | undefined;
}

/**
 * The pure resolver, so the five-step order is testable without a device.
 *
 * `account` is step 2 as {@link reconcileLocale} already decided it: pass the account's
 * language only when it is to be applied. Applying it stores it, so the next launch reads it
 * back as step 1.
 */
export function resolveLocale(inputs: LocaleInputs): Locale {
  if (isLocale(inputs.stored)) return inputs.stored;
  if (isLocale(inputs.account)) return inputs.account;
  for (const language of inputs.languages) {
    const tag = language.languageCode?.toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return localeForCountry(inputs.region) ?? DEFAULT_LOCALE;
}

/** What to do with the account's language on one read of `GET /v1/me`. */
export type LocaleSync =
  | { readonly kind: 'keep' }
  | { readonly kind: 'apply'; readonly locale: Locale }
  | { readonly kind: 'push'; readonly locale: Locale };

export interface SyncInputs {
  /** `me.locale`, as the service answered it just now. */
  readonly account: string | null | undefined;
  /** The device's explicit choice, step 1. */
  readonly chosen: string | null | undefined;
  /** The account language this device last synced (`locale.accountSynced`). */
  readonly synced: string | null | undefined;
  /** A choice made here whose `PATCH` has not landed (`locale.pending`). */
  readonly pending: string | null | undefined;
}

/**
 * The last-synced rule — issue #216. The web's `lib/i18n/sync.ts` carries the same rule.
 *
 * - An account value this app cannot draw (absent, or not one of the four) changes nothing.
 * - A pending choice wins: it is pushed, or, when the account already says it (the `PATCH`
 *   landed and its answer was lost), it is settled by applying the account's equal value.
 * - No explicit choice here, or an account that changed elsewhere since this device synced:
 *   the account's language is applied. A first sign-in is the second case, because signing
 *   out forgets `synced`.
 * - Otherwise the device's own choice stands.
 */
export function reconcileLocale(inputs: SyncInputs): LocaleSync {
  const { account, chosen, synced, pending } = inputs;
  if (!isLocale(account)) return { kind: 'keep' };
  if (isLocale(pending)) {
    return pending === account
      ? { kind: 'apply', locale: account }
      : { kind: 'push', locale: pending };
  }
  if (!isLocale(chosen) || account !== synced) return { kind: 'apply', locale: account };
  return { kind: 'keep' };
}

/** The phone's first language as this app last saw it at launch. */
const DEVICE_KEY = 'locale.device';

/**
 * Whether the operating system's per-app language setting chose a language since the last
 * launch. It arrives as a new first entry in `getLocales()` and nothing else
 * (`CFBundleLocalizations` and Android's `localeConfig` list the four there, `app.config.ts`).
 *
 * That is a fresh explicit choice and outranks the choice stored earlier in the app; otherwise
 * the phone's own setting would silently do nothing once somebody had tapped a language here.
 * Only a change *to one of the four* counts: the per-app setting offers nothing else, so a
 * switch to German is the whole phone changing language, which says nothing about this app,
 * and the stored choice stands. Nor does a change to the language already chosen here — there
 * is nothing new to record. Compared by language, not tag, so a new region (`en-US` → `en-GB`)
 * is not a new language; no record yet (the first launch, or the first since this rule) is no
 * change.
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

/** The device's explicit choice (step 1), or `undefined` when it has none. */
export function storedLocale(): string | undefined {
  return deviceStore.getString(STORAGE_KEY);
}

function fromDevice(): Locale {
  const locales = getLocales();
  const language = locales[0]?.languageCode?.toLowerCase() ?? null;
  if (perAppLanguageChosen(deviceStore.getString(DEVICE_KEY), language, storedLocale())) {
    /*
     * An explicit choice, like a tap on the language screen: stored, and marked for the
     * account. `AccountSync` sends the `PATCH` once the account can be read, and drops the
     * mark when nobody is signed in — a signed-out phone has no account to tell.
     */
    deviceStore.set(STORAGE_KEY, language as Locale);
    deviceStore.set(PENDING_KEY, language as Locale);
  }
  if (language !== null) deviceStore.set(DEVICE_KEY, language);
  return resolveLocale({
    stored: storedLocale(),
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
 * Switches the language, persists it as the device's choice and re-renders subscribers with
 * no restart. The language screen reaches it through `lib/locale-sync.ts`'s `chooseLocale`,
 * and `AccountSync` when the account's language is applied.
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
