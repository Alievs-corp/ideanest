/**
 * The language vocabulary, in one place — docs/architecture.md §21.1, issue #324.
 *
 * <h2>Why this file exists at all</h2>
 *
 * The service has been able to answer in four languages since V11, and this client has
 * never asked for one. `Taxonomy.SUPPORTED_LOCALES` on the API side and the check
 * constraint `users_locale_supported` in `V2__create_identity_schema.sql` both spell the
 * same four tags; this is the third spelling and the only one the browser can read. They
 * are kept in step by `locale.test.ts`, which asserts the list rather than trusting it,
 * because a fifth language added on one side and not the other is a 400 from a control
 * that looked like it worked.
 *
 * <h2>The tags are BCP 47 primary subtags and nothing more</h2>
 *
 * `az`, not `az-Latn-AZ`. The service resolves `Accept-Language` with RFC 4647 lookup, so
 * a region-tagged request already folds to the primary subtag on arrival, and carrying the
 * region here would mean storing a value the column's check constraint refuses.
 */

/**
 * §21.1's four, in the document's own order: the primary language first, then phase 1,
 * then phase 3. The order is what the preference screen lists them in, so it is data
 * rather than presentation — a screen that sorted them alphabetically would put Azerbaijani
 * first by accident and English second by accident, and the next language added would move
 * both.
 */
export const SUPPORTED_LOCALES = ['az', 'en', 'ru', 'tr'] as const;

/** One of §21.1's languages. Anything else is not a locale this platform has. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * WHAT AN UNSTATED PREFERENCE MEANS IN THIS CLIENT, AND WHY IT IS NOT `az`.
 *
 * §21.1 makes Azerbaijani the primary language and the service agrees — `users.locale`
 * defaults to `'az'` and `Taxonomy.PRIMARY_LOCALE` is `'az'`. This client deliberately
 * disagrees, and the disagreement is temporary and documented rather than accidental.
 *
 * The catalogue this constant is read beside covers the account area and nothing else yet.
 * Defaulting a visitor who has expressed no preference into Azerbaijani would hand them an
 * Azerbaijani navigation wrapped around English page bodies — a worse page than the
 * consistent English one they get today, and one they never asked for. A default is the
 * experience of everybody who never opens the preference screen, so it is the one value
 * that must not be aspirational.
 *
 * `en` therefore means "what this client can actually render end to end", and it moves to
 * `az` in the change that finishes the catalogue, not before. Nothing else in the codebase
 * needs to change when it does: every other file asks this constant.
 *
 * Since #125 it is also the language of a first visit from anywhere `lib/i18n/country.ts`
 * does not name: a visitor from Azerbaijan already starts in `az`, from Turkey in `tr` and
 * from the CIS in `ru`, so this constant is what the rest of the world is met with. That is
 * a second reason for it to stay English after the catalogue is finished.
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Where a chosen language is remembered in the browser.
 *
 * A cookie rather than `localStorage` because the server renders the account area and has
 * to know the language before the first byte — `localStorage` is unreadable at that point,
 * so the frame would render in one language and correct itself in another, which is a
 * flash of the wrong navigation on every load.
 *
 * NOT `httpOnly`. The browser-side API client reads it to set `Accept-Language` on its own
 * requests (`lib/api/client.ts`), and a language is not a credential — the worst a script
 * that can read this learns is which of four languages somebody prefers.
 */
export const LOCALE_COOKIE = 'ideanest_locale';

/**
 * A year. The preference is stated rarely and changed almost never, and a session-length
 * cookie would ask somebody to choose their language again every time they close the
 * browser. The account's own `users.locale` is the durable record for anybody signed in;
 * this cookie is what makes the choice survive for a visitor who is not.
 */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Each language named in itself.
 *
 * ENDONYMS, NOT TRANSLATIONS. A language list is the one piece of copy that must not be
 * translated into the language the reader is currently stuck in: somebody who has landed
 * in a language they cannot read needs to find their own, and "Azerbaijani" spelled in
 * Russian is unreadable to precisely the person who needs it most. This is why the list is
 * a constant here rather than four entries in each message file.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe',
};

/**
 * `og:locale`, in Open Graph's underscored spelling.
 *
 * Open Graph wants a language and a territory, so each of §21.1's primary subtags is
 * paired with the territory this platform actually serves it in. `en_US` rather than
 * `en_GB` only because it is the value already shipped in `lib/seo/metadata.ts` and
 * changing it is an unrelated decision about which English the copy is written in.
 */
export const LOCALE_OG: Record<Locale, string> = {
  az: 'az_AZ',
  en: 'en_US',
  ru: 'ru_RU',
  tr: 'tr_TR',
};

/** Whether a value is one of §21.1's languages. The type guard every boundary uses. */
export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * A locale from an untrusted value, or {@link DEFAULT_LOCALE}.
 *
 * Every value this client reads a language out of is untrusted in the same way — a cookie
 * a user can edit, a field on an API response, a value in a form post — and all of them
 * want the same answer to a value that is missing, empty, or not a language: fall back
 * silently rather than throw. A language that cannot be honoured is not an error worth
 * taking a page down for; it is a page in English.
 */
export function localeOrDefault(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
