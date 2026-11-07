import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/i18n/locale';

/**
 * The shape of a localised URL — issue #123, docs/architecture.md §21.1.
 *
 * <h2>Why the language moved into the path</h2>
 *
 * `i18n/request.ts` used to read the language from a cookie, and that decision carried a
 * cost written down in its own docblock: reading a cookie makes a render dynamic, so the
 * account area could be translated for free while `/`, the category landings and the static
 * pages could not — translating their shell would have turned every cached read into a
 * per-request render for a navigation bar.
 *
 * A path segment removes the choice between those two. `/az/discover` and `/ru/discover` are
 * different URLs, so each is a cached render of its own, and neither has to ask who is
 * asking. That is the whole of #123: not a preference about how URLs look, but the only
 * mechanism by which a translated page stays static.
 *
 * <h2>`always`, including for the default language</h2>
 *
 * `as-needed` would leave English un-prefixed — `/discover` in English, `/az/discover` in
 * Azerbaijani. It reads well and it reintroduces exactly the problem this file exists to
 * remove: `/discover` would once again be a page with no locale in its address, so
 * something at request time would have to decide what language it is, and that something
 * makes it dynamic. `always` costs a redirect on the bare path and buys a rule with no
 * exception in it.
 *
 * It also keeps the canonical honest. With `as-needed` the English page has two truthful
 * addresses and one of them has to be declared canonical by hand; with `always` every
 * language has one address and `hreflang` is a straight enumeration.
 *
 * <h2>`localeDetection: false`, WHICH IS THE POINT THAT IS EASY TO GET WRONG</h2>
 *
 * next-intl's own detection reads `Accept-Language`. Turning it on would make the
 * proxy's response vary by that header, and a `Vary: Accept-Language` on the routes a
 * stranger meets first splits the shared CDN cache per browser configuration — the same
 * per-visitor render this file was written to avoid, arriving through the door rather than
 * the window.
 *
 * So detection happens in `proxy.ts` instead, once, on the bare path only, and the
 * pages it redirects to never negotiate anything.
 *
 * <h2>`localeCookie: false`: next-intl's cookie is nobody's</h2>
 *
 * Left on, the middleware writes `NEXT_LOCALE` on any page whose language differs from what
 * the browser's `Accept-Language` prefers, unasked. Nothing reads it: detection is off above,
 * and the proxy's redirect reads `ideanest_locale`, which is written only when the reader picks
 * a language. A cookie the reader did not ask for and the site does not need is one the site
 * would have to ask consent for, so it is not set at all.
 *
 * <h2>The list is imported, never spelled again</h2>
 *
 * `lib/i18n/locale.ts` is the third spelling of a list the API and a check constraint in
 * `V2__create_identity_schema.sql` also hold, and `locale.test.ts` asserts rather than
 * trusts it. A fourth spelling here would be the one nobody updates.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false,
  localeCookie: false,
});
