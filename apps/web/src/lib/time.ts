import { relativeTimeFormat, dateTimeFormat, UNKNOWN_TIME } from './i18n/formats';
import type { Locale } from './i18n/locale';

/**
 * Rendering an instant for a reader.
 *
 * Lifted out of `lib/sessions/describe.ts` when the notification inbox (#88) needed the
 * same two functions. Nothing about "3 hours ago" is about a session, and the alternative
 * — a second module importing `lib/sessions` for a formatter — would have made the inbox
 * depend on the device list for no reason anybody could find later.
 *
 * The rest of that module — naming a device — is `@ideanest/account/sessions` now (#161), shared
 * with the app; the session row imports these two from here.
 *
 * <h2>THE LOCALE IS A PARAMETER NOW, AND IT IS NOT OPTIONAL — #324</h2>
 *
 * Both functions were pinned to English with the limitation written down: "these strings are
 * the only record on screen of when something happened, and a reader in Azerbaijani currently
 * gets them in English." The pin was waiting on #123's locale-prefixed routing, which has
 * landed, so it is gone.
 *
 * <p>It is a required parameter rather than one defaulting to `DEFAULT_LOCALE` on purpose. A
 * default would have compiled every existing call site unchanged and left seventy of them
 * quietly English — the same defect, now invisible instead of documented. Making it required
 * is what turned "find every screen that prints a time" from an audit into a typecheck.
 *
 * <p>Server components read the locale from `getLocale()`; client components read it from
 * `useRouteLocale()`, which takes it off the matched route segment. Neither reads a cookie,
 * so neither makes a render dynamic.
 */

const DIVISIONS: ReadonlyArray<readonly [amount: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.34524, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

/**
 * "3 hours ago", "dünən", "5 месяцев назад".
 *
 * `now` is a parameter rather than a call to `Date.now()` so that the function is pure and
 * the tests do not have to freeze the clock.
 */
export function formatRelativeTime(iso: string, now: Date, locale: Locale): string {
  const relative = relativeTimeFormat(locale, { numeric: 'auto' }, 'relative');

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return UNKNOWN_TIME[locale];

  let duration = (then.getTime() - now.getTime()) / 1000;

  /*
   * Under a minute, a rounded figure is noise.
   *
   * `format(0, 'second')` rather than the literal "just now" this used to return: with
   * `numeric: 'auto'` it is the language's own word for the present moment — "now", "indi",
   * "сейчас", "şimdi" — which is one fewer string to translate and one fewer to get wrong.
   * It is lower case in all four, which matters because every string this returns is read
   * inside a sentence: "Last active just now", "3 hours ago".
   */
  if (Math.abs(duration) < 45) return relative.format(0, 'second');

  for (const [amount, unit] of DIVISIONS) {
    if (Math.abs(duration) < amount) return relative.format(Math.round(duration), unit);
    duration /= amount;
  }

  return relative.format(Math.round(duration), 'year');
}

/**
 * The day, with no time on it — issue #401.
 *
 * <p>For the console's list rows, where "joined 27 July 2026" is the whole of what anybody
 * wants and the hour is noise. Those rows called `Date.prototype.toLocaleDateString` with no
 * argument, which is not the reader's language at all: it is the browser's, so an
 * Azerbaijani console on an American laptop rendered `7/27/2026`. There was no locale in
 * scope to pass, which is what a helper is for.
 */
export function formatDate(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN_TIME[locale];

  return dateTimeFormat(locale, { dateStyle: 'medium' }, 'date').format(at);
}

/** The exact timestamp, for the `title` of the relative one. */
export function formatExactTime(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN_TIME[locale];

  return dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }, 'exact').format(at);
}
