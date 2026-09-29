import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from '../lib/i18n/locale';
import { routing } from './routing';

/**
 * How a server render learns which language to draw — issues #324 and #123,
 * docs/architecture.md §21.1.
 *
 * <h2>This file used to read a cookie, and the change is the whole of #123</h2>
 *
 * The previous version negotiated the language from `ideanest_locale`, and the docblock it
 * carried was mostly an apology for what that cost: `cookies()` marks a render dynamic, so
 * only the account area — authenticated, per-person, dynamic already — could afford to be
 * translated. `/`, the category landings and the static pages were left in English literals
 * because translating their shell would have turned every cached read into a per-request
 * render, and the bill would have arrived on the largest contentful paint of the pages a
 * stranger meets first.
 *
 * That trade is gone rather than improved. The language is a path segment now, so
 * `requestLocale` resolves from the route's own `[locale]` parameter — a value the router
 * already knows before this function is called, that no header or cookie was read to learn,
 * and that leaves the render as static as it was. `/az/discover` and `/ru/discover` are two
 * cached documents instead of one dynamic one.
 *
 * The consequence worth stating plainly: **there is no longer a performance argument for
 * leaving any surface in English.** `proxy.ts` owns the one remaining cookie read, on
 * the bare path only, where a redirect is the whole response.
 *
 * <h2>Trusting `requestLocale`, and still checking it</h2>
 *
 * The value arrives from the matched route segment, and `generateStaticParams` only ever
 * produces the four. It is still validated, because a `[locale]` segment is a wildcard —
 * `/xx/discover` matches the route before it fails anything — and the line below feeds a
 * dynamic import. An unchecked value there is an attacker-chosen path into the module
 * graph, which is a different class of problem from a page in the wrong language.
 */
/* Four static imports, so the bundler sees each catalogue instead of a template it cannot follow. */
const CATALOGUES = {
  az: () => import('@ideanest/messages/az.json'),
  en: () => import('@ideanest/messages/en.json'),
  ru: () => import('@ideanest/messages/ru.json'),
  tr: () => import('@ideanest/messages/tr.json'),
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,

    /* One catalogue per language, loaded by the tag that was just narrowed to one of four. */
    messages: (await CATALOGUES[locale]()).default,

    /*
     * WHAT A MISSING KEY DOES. In development it throws, so a key that was never added is
     * found by the person adding it. In production it renders the key's own name rather
     * than taking the route down: a navigation item reading `account.nav.saved` is a
     * defect, and a 500 on the settings page because one string was not translated into
     * Turkish is an outage. `onError` is left at its default, which logs.
     */
    getMessageFallback: ({ key, namespace }) => (namespace === undefined ? key : `${namespace}.${key}`),

    /*
     * NO `timeZone` AND NO `formats` HERE, DELIBERATELY. §21.1 asks that dates and numbers
     * use the platform internationalisation APIs, and they already do — `lib/time.ts` and
     * `lib/projects/deadline.ts` own that formatting and both are pinned to English with
     * the limitation written down. Declaring a zone in this file would silently change how
     * every date those modules render behaves the moment one of them started asking
     * next-intl instead, which is a migration with its own tests rather than a default set
     * in passing. Money never goes through here at all: `lib/money.ts` formats against the
     * campaign's currency, which is a property of the project and never of the reader.
     */
  };
});

/**
 * Re-exported so that the one place that decides the fallback and the one place that names
 * the default are visibly the same module to anybody reading this file alone.
 */
export { DEFAULT_LOCALE };
