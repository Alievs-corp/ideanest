import { type Locale } from './locale';
import {
  azerbaijaniDateTimeFormat,
  azerbaijaniNumberFormat,
  azerbaijaniRelativeTimeFormat,
  type AzerbaijaniDateTimeFormat,
  type AzerbaijaniNumberFormat,
  type AzerbaijaniRelativeTimeFormat,
} from './azerbaijani';

/**
 * What the platform's four language tags mean to `Intl` — issue #324, §21.1.
 *
 * <h2>Why this is not the identity function</h2>
 *
 * `az`, `ru` and `tr` are handed to `Intl` unchanged, and English is not. A bare `en`
 * resolves to `en-US` inside every `Intl` constructor, which is a twelve-hour clock and a
 * month-first date — `Mar 14, 2026, 2:05 PM`. The other three languages this platform ships
 * all render `14 mar 2026, 14:05`, and so does the market it ships into.
 *
 * So the English reader of an Azerbaijani crowdfunding platform gets `en-GB`: the same clock
 * and the same field order as everybody else on the page, and the difference between the two
 * is invisible to anyone who is not looking for it. It was `'en-GB'` hard-coded in eight
 * modules before this file existed, which is where the decision actually was — the modules
 * simply had no way to say it for the other three languages.
 *
 * <h2>Region subtags stop here</h2>
 *
 * `lib/i18n/locale.ts` carries primary subtags and nothing else, because that is what the
 * service's RFC 4647 lookup folds to and what `users_locale_supported` will accept. This map
 * is the one place a region may appear, and it appears only where a formatter needs one.
 *
 * <h2>`az` is in this table and is not read from it — #401</h2>
 *
 * <p>Chromium claims `az` and formats it from root-locale data: `-3 w`, `2026 M08 14`, and a
 * twelve-hour clock on a page whose whole reason for existing is the opposite. Node does not,
 * so it is right on the server, right in every test, and wrong in front of the reader — and
 * `supportedLocalesOf` reports support, so no feature test can see it.
 *
 * <p>So the two constructors below send Azerbaijani to `lib/i18n/azerbaijani.ts` instead, on
 * every engine, and that file has the argument for why it is every engine rather than the
 * broken one. The entry stays because it is still what `az` means to `Intl` — the surrogate
 * that module renders its numbers with is `en-GB`, for the same reason English is.
 */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  az: 'az',
  en: 'en-GB',
  ru: 'ru',
  tr: 'tr',
};

/**
 * What a timestamp reads as when it cannot be parsed at all.
 *
 * <h2>Why one word lives here rather than in `messages/*.json`</h2>
 *
 * The formatters that print it — `lib/time.ts`, `lib/projects/deadline.ts` — are pure
 * functions called from client components that have no `NextIntlClientProvider` above them.
 * That absence is deliberate and measured: a provider in a shared layout added up to 27.4 KiB
 * to every route in its group, so copy is resolved on the server and handed down as props.
 * A formatter cannot be handed props.
 *
 * The alternative was to make every one of the seventy call sites pass a word in, for a
 * string that renders only when an instant the service sent will not parse — a defect path
 * that should never be reached. Four words in a checked-in table, tested against the same
 * catalogue rules, is the smaller thing to be wrong about.
 */
export const UNKNOWN_TIME: Readonly<Record<Locale, string>> = {
  az: 'Naməlum',
  en: 'Unknown',
  ru: 'Неизвестно',
  tr: 'Bilinmiyor',
};

/**
 * What a group of rows is headed when the instant behind it will not parse.
 *
 * `UNKNOWN_TIME`'s argument, one word over. "Unknown" answers *when did this happen*;
 * this answers *which day are these rows from*, and the two read differently in every
 * language even where they read the same in English.
 */
export const UNDATED: Readonly<Record<Locale, string>> = {
  az: 'Tarixsiz',
  en: 'Undated',
  ru: 'Без даты',
  tr: 'Tarihsiz',
};

/**
 * `text` with its first character upper-cased in the reader's own language.
 *
 * <h2>Why `toLocaleUpperCase` and not `toUpperCase`</h2>
 *
 * Turkish. A dotless `i` upper-cases to `I` and a dotted one to `İ`, and the invariant
 * `toUpperCase` gets the second case wrong — `içinde` becomes `Içinde`, which is a different
 * word and reads to a Turkish speaker exactly as `Ínside` would to an English one. `Intl`'s
 * own relative-time output is lower case in all four languages, so anything that puts one of
 * its phrases at the head of a sentence has to come through here.
 */
export function capitalised(text: string, locale: Locale): string {
  const first = text.slice(0, 1);
  return first === '' ? text : first.toLocaleUpperCase(INTL_LOCALE[locale]) + text.slice(1);
}

/**
 * A cache of formatters, keyed by locale and by what the formatter is for.
 *
 * `new Intl.DateTimeFormat(...)` parses a locale and loads its data on construction, which is
 * expensive enough that every module in this application already hoisted one into a module
 * constant. Four languages turns each of those constants into four, and a list of two hundred
 * rows would otherwise construct two hundred of them.
 */
const CACHE = new Map<string, unknown>();

function cached<T>(key: string, build: () => T): T {
  const existing = CACHE.get(key);
  if (existing !== undefined) return existing as T;

  const made = build();
  CACHE.set(key, made);
  return made;
}

/**
 * A date and time formatter for one language, built once.
 *
 * <p>The return type is the one method every caller uses rather than `Intl.DateTimeFormat`,
 * because Azerbaijani is not one — see {@link azerbaijaniDateTimeFormat} and #401.
 */
export function dateTimeFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
  key: string,
): AzerbaijaniDateTimeFormat {
  return cached(`d:${key}:${locale}`, () =>
    locale === 'az'
      ? azerbaijaniDateTimeFormat(options)
      : new Intl.DateTimeFormat(INTL_LOCALE[locale], options),
  );
}

/** A relative-time formatter for one language, built once. */
export function relativeTimeFormat(
  locale: Locale,
  options: Intl.RelativeTimeFormatOptions,
  key: string,
): AzerbaijaniRelativeTimeFormat {
  return cached(`r:${key}:${locale}`, () =>
    locale === 'az'
      ? azerbaijaniRelativeTimeFormat(options)
      : new Intl.RelativeTimeFormat(INTL_LOCALE[locale], options),
  );
}

/**
 * A number formatter for one language, built once — issue #403.
 *
 * <p><strong>Not for money.</strong> `@ideanest/money` formats an amount from its digits and
 * never through a number, because `999999999999.99` loses its last digit on the way into an
 * IEEE 754 double — and it formats the same way in all four languages deliberately. This is
 * for the figures that are not money and do belong to the reader's language: a rate, a count,
 * a percentage.
 */
export function numberFormat(
  locale: Locale,
  options: Intl.NumberFormatOptions,
  key: string,
): AzerbaijaniNumberFormat {
  return cached(`n:${key}:${locale}`, () =>
    locale === 'az'
      ? azerbaijaniNumberFormat(options)
      : new Intl.NumberFormat(INTL_LOCALE[locale], options),
  );
}

/**
 * A known region and what every real set of region names calls it. `DE` because its name
 * differs in all four languages and from its own code.
 */
const REGION_CANARY = 'DE';

/**
 * Country names in the reader's language — issue #133.
 *
 * <p>The checkout and the pledge page name a shipping destination, and they used to name it
 * with `Intl.DisplayNames(['en'])` whatever the route's language was. This asks for the
 * route's language first and falls back to English only when the runtime cannot name
 * regions in it.
 *
 * <p>"Cannot" is tested rather than trusted, for the reason #401 gives for dates: an engine
 * may accept a locale it has no data for. Such an engine answers a region's code with the
 * code itself, so a canary that comes back unnamed sends the reader to English, which is
 * still a name. `null` when not even English is there, and `countryName` then shows codes.
 */
export function regionNames(locale: Locale): Intl.DisplayNames | null {
  return cached(`region:${locale}`, () => {
    for (const tag of [INTL_LOCALE[locale], INTL_LOCALE.en]) {
      try {
        const names = new Intl.DisplayNames([tag], { type: 'region' });
        if (names.of(REGION_CANARY) !== REGION_CANARY) return names;
      } catch {
        // A runtime built without the locale's display names; try the next.
      }
    }
    return null;
  });
}
