import { authorizedFetch } from '../api/client';
import { currentLocaleCookie, writeLocaleCookie } from './cookie';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, isLocale, type Locale } from './locale';

/**
 * The browser's language and the account's, kept in step — issue #216.
 *
 * <h2>The latest explicit choice wins, and it is written to the account</h2>
 *
 * A signed-in person has one language on the account (`PATCH /v1/me/locale`), and mail and
 * pushes are sent in it. They can also choose one here — the header's switcher or Settings →
 * Language — or on a phone. Whichever of those came last is the language: it is written to
 * the account, and every other browser and device follows it on its next account read.
 *
 * The account's language is applied to this browser only when the browser has no explicit
 * choice of its own (no cookie), or when the account changed **elsewhere** since this browser
 * last synced it. There are no clocks: this browser remembers the account language it last
 * synced, and an account that now says something else was changed by somebody else. That is
 * last-writer-wins, the same rule `apps/mobile`'s `lib/locale.ts` carries.
 *
 * <h2>Two companions to the language cookie</h2>
 *
 * - `ideanest_locale_synced`: the account language this browser last applied or wrote.
 * - `ideanest_locale_pending`: a choice made here that the account has not accepted yet.
 *
 * A cookie that differs from `synced` while the account still says `synced` is a choice made
 * on this browser since the last sync — the header's switcher writes only the cookie and
 * navigates, and this is how the page it opens knows to send the `PATCH`. From then until the
 * account has it, the choice is also marked pending, so a failed or offline `PATCH` keeps the
 * choice, is sent again on every session read, and is not overridden by a change made
 * elsewhere meanwhile. A pending mark counts only while the cookie still holds it: Settings →
 * Language writing a newer choice makes it stale.
 *
 * Both are cookies because the choice they describe is one, and they share its lifetime and
 * scope. A session read that finds nobody, and a sign-out, keep the choice and forget both, so
 * the next person to sign in on this browser follows their own account.
 *
 * The browser's `Accept-Language` is not an input to any of it: `proxy.ts` never negotiates
 * on it, and nothing here reads it.
 *
 * <h2>Loaded after the session read, not with the page</h2>
 *
 * `SessionProvider` imports this file dynamically once `GET /v1/me` has answered. It is in no
 * route's First Load JS, which is budgeted to the tenth of a KiB, and nothing in it can run
 * before there is an answer anyway. The switcher and the settings panel need nothing from it:
 * both already write the cookie, and the next session read does the rest.
 */

export const LOCALE_SYNCED_COOKIE = `${LOCALE_COOKIE}_synced`;
export const LOCALE_PENDING_COOKIE = `${LOCALE_COOKIE}_pending`;

/** What to do with the account's language on one session read. */
export type LocaleSync =
  | { readonly kind: 'keep' }
  | { readonly kind: 'apply'; readonly locale: Locale }
  | { readonly kind: 'push'; readonly locale: Locale };

export interface SyncInputs {
  /** `locale` from `GET /v1/me`, as the service answered it just now. */
  readonly account: string | null | undefined;
  /** This browser's explicit choice: the language cookie. */
  readonly chosen: string | null | undefined;
  /** The account language this browser last synced. */
  readonly synced: string | null | undefined;
  /** A choice made here whose `PATCH` has not landed. */
  readonly pending: string | null | undefined;
}

/**
 * The last-synced rule, pure.
 *
 * - An account value this client cannot draw (absent, or not one of the four) changes nothing.
 * - A pending choice the cookie still holds wins: it is sent, or settled when the account
 *   already carries it.
 * - No choice here, or an account that changed elsewhere since this browser synced: the
 *   account's language is applied. A first sign-in is the second case, because signing out
 *   forgets `synced`.
 * - A cookie that moved since the last sync is a choice made here: it is sent.
 * - Otherwise this browser's choice and the account agree.
 */
export function reconcileLocale(inputs: SyncInputs): LocaleSync {
  const { account, chosen, synced, pending } = inputs;
  if (!isLocale(account)) return { kind: 'keep' };
  if (isLocale(chosen) && chosen === pending) {
    return chosen === account ? { kind: 'apply', locale: account } : { kind: 'push', locale: chosen };
  }
  if (!isLocale(chosen) || account !== synced) return { kind: 'apply', locale: account };
  if (chosen !== account) return { kind: 'push', locale: chosen };
  return { kind: 'keep' };
}

/** One of the language cookie's companions, parsed the way the cookie itself is. */
export function readMarker(name: string): Locale | null {
  for (const pair of document.cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    return isLocale(value) ? value : null;
  }
  return null;
}

function writeMarker(name: string, locale: Locale | null): void {
  document.cookie =
    locale === null
      ? `${name}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${name}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** Makes the account's language this browser's: the cookie, the last-synced value, no pending. */
function adopt(locale: Locale): void {
  writeLocaleCookie(locale);
  writeMarker(LOCALE_SYNCED_COOKIE, locale);
  writeMarker(LOCALE_PENDING_COOKIE, null);
}

/**
 * Sends a choice made here to the account (`PATCH /v1/me/locale`, through the api client's
 * own fetch path), marked pending until it lands. Resolves whether the account accepted it.
 * On success it becomes the last-synced value, unless the cookie moved on meanwhile.
 */
export async function pushLocale(locale: Locale): Promise<boolean> {
  writeMarker(LOCALE_PENDING_COOKIE, locale);

  let saved = false;
  try {
    const response = await authorizedFetch('/v1/me/locale', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
    saved = response.ok;
  } catch {
    // Offline, or the session ended: the mark stays, and the next session read sends it again.
  }

  if (saved && currentLocaleCookie() === locale) {
    writeMarker(LOCALE_SYNCED_COOKIE, locale);
    writeMarker(LOCALE_PENDING_COOKIE, null);
  }
  return saved;
}

/**
 * One session read, reconciled against the cookies this browser holds now. `null` is nobody
 * signed in: the choice stays and both marks are forgotten. Otherwise the account's language is
 * adopted, or the choice made here is sent, or nothing.
 */
export function syncLocale(account: object | null): void {
  if (account === null) {
    writeMarker(LOCALE_SYNCED_COOKIE, null);
    writeMarker(LOCALE_PENDING_COOKIE, null);
    return;
  }

  const outcome = reconcileLocale({
    // `Session` does not declare the field; `lib/session/session.ts` owns that type.
    account: (account as { readonly locale?: string | null }).locale,
    chosen: currentLocaleCookie(),
    synced: readMarker(LOCALE_SYNCED_COOKIE),
    pending: readMarker(LOCALE_PENDING_COOKIE),
  });

  if (outcome.kind === 'apply') adopt(outcome.locale);
  if (outcome.kind === 'push') void pushLocale(outcome.locale);
}
