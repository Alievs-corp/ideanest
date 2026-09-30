import { isLocale, type Locale } from '@ideanest/messages';
import { saveAccountLocale } from '../api/client';
import {
  ACCOUNT_SYNCED_KEY,
  PENDING_KEY,
  currentLocale,
  reconcileLocale,
  setLocale,
  storedLocale,
  type LocaleSync,
} from './locale';
import { deviceStore } from './storage';

/**
 * The device's language and the account's, kept in step — issue #216.
 *
 * `lib/locale.ts` holds the rule ({@link reconcileLocale}) and the order; this file is the
 * half that touches the network, kept apart because `api/client.ts` already imports
 * `lib/locale.ts` for `Accept-Language` and the reverse import would be a cycle.
 *
 * Two markers live in MMKV beside the choice itself:
 *
 * - `locale.accountSynced`, the account language this device last applied or wrote. When the
 *   account says something else, somebody changed it elsewhere.
 * - `locale.pending`, a choice made here that the account has not accepted yet. While it is
 *   set, the account's value does not win: a failed or offline `PATCH` keeps the reader's
 *   choice, and `AccountSync` retries it on the next foreground.
 *
 * Signing out keeps the choice — the next person on this phone keeps the language it was
 * using — and forgets both markers, so the next sign-in follows its own account.
 */

/**
 * An explicit choice from the language screen: applied at once, and marked for the account
 * when somebody is signed in. The caller then sends it with {@link pushPendingLocale}.
 */
export function chooseLocale(locale: Locale, signedIn: boolean): void {
  setLocale(locale);
  if (signedIn) deviceStore.set(PENDING_KEY, locale);
}

/** What one read of `GET /v1/me` means for this device, from what MMKV holds now. */
export function reconcileWithAccount(account: string | null | undefined): LocaleSync {
  return reconcileLocale({
    account,
    chosen: storedLocale(),
    synced: deviceStore.getString(ACCOUNT_SYNCED_KEY),
    pending: deviceStore.getString(PENDING_KEY),
  });
}

/**
 * Applies the account's language: it becomes this device's choice and the last-synced value,
 * and any pending mark is settled by it. Returns whether the language on screen changed.
 */
export function applyAccountLocale(locale: Locale): boolean {
  const changed = locale !== currentLocale();
  setLocale(locale);
  deviceStore.set(ACCOUNT_SYNCED_KEY, locale);
  deviceStore.remove(PENDING_KEY);
  return changed;
}

type Save = (locale: string) => Promise<boolean>;

/** The one `PATCH` in flight, so a foreground and a screen retry do not send it twice. */
let inFlight: { readonly locale: string; readonly promise: Promise<boolean> } | null = null;

/**
 * Sends the pending choice to the account (`PATCH /v1/me/locale`).
 *
 * Resolves `null` when nothing is pending, otherwise whether the account accepted it. On
 * success the choice becomes the last-synced value and the mark is dropped — unless a newer
 * choice replaced it while the request was out, which then stays pending for its own send.
 * On failure nothing changes, and the mark is what makes the next foreground try again.
 */
export function pushPendingLocale(save: Save = saveAccountLocale): Promise<boolean | null> {
  const pending = deviceStore.getString(PENDING_KEY);
  if (!isLocale(pending)) return Promise.resolve(null);
  if (inFlight !== null && inFlight.locale === pending) return inFlight.promise;

  const promise = save(pending)
    .catch(() => false)
    .then((saved) => {
      if (saved && deviceStore.getString(PENDING_KEY) === pending) {
        deviceStore.set(ACCOUNT_SYNCED_KEY, pending);
        deviceStore.remove(PENDING_KEY);
      }
      return saved;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { locale: pending, promise };
  return promise;
}

/**
 * The end of a session: the device keeps its language and forgets which account it last
 * agreed with, and any choice still waiting for that account.
 */
export function forgetAccountSync(): void {
  deviceStore.remove(ACCOUNT_SYNCED_KEY);
  deviceStore.remove(PENDING_KEY);
}
