'use client';

import { localeHref, useLocale, usePathname } from '../../i18n/navigation';
import { writeLocaleCookie } from '../../lib/i18n/cookie';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';

/**
 * The language control in the footer — §4.13 WS-02, issue #123's last mile.
 *
 * <h2>Why this can exist now, when the footer's docblock said it could not</h2>
 *
 * That docblock was right when it was written and is quoted here because the reasoning is
 * worth keeping: a control in the footer meant reading a cookie to know what to show, and
 * reading a cookie makes a render dynamic — on `/`, the category landings and every static
 * page, paid on the largest contentful paint of the pages a stranger meets first.
 *
 * #123 removed the premise rather than the cost. The language is a path segment, so this
 * control reads nothing at render time: `/ru/discover` is a different address from
 * `/az/discover`, and switching is a link from one to the other. `src/i18n/request.ts`
 * states the consequence outright — "there is no longer a performance argument for leaving
 * any surface in English".
 *
 * <h2>The footer stays a Server Component. Only this is a client boundary</h2>
 *
 * The hooks below need the route's own parameters, so this much has to run in the browser.
 * It is four links and a cookie write; the footer's navigation, headings and copy are still
 * rendered once on the server and shipped as HTML.
 *
 * <h2>Anchors, not `Link`, and the guard test knows</h2>
 *
 * `Link` from `src/i18n/navigation` keeps the CURRENT language, which is exactly the wrong
 * behaviour here — it would render four links to the page you are already on. So these are
 * plain anchors that prefix the path themselves with `localeHref`, which is the exception
 * `navigation.guard.test.ts` allows and checks for.
 *
 * A full-document navigation is also the honest mechanism. Everything a language changes is
 * server-rendered — the shell, the navigation, the page body, the `<html lang>` — so there
 * is no client state worth carrying across, and a soft navigation would only make the swap
 * look partial while it happened.
 *
 * <h2>The cookie is written, and it is not what makes the switch work</h2>
 *
 * The link does that on its own. The cookie is the one job `proxy.ts` left it: answering
 * the bare path. Somebody who chooses Russian here and later arrives at `/` should be sent
 * to `/ru` rather than to whatever they had before, and without this write that redirect
 * keeps answering with a preference this control has just contradicted.
 *
 * <h2>Every language is named in itself</h2>
 *
 * `LOCALE_NAMES`, never translated into the language the page happens to be drawn in — the
 * argument `LanguagePanel` makes at length. The reader this control exists for is the one
 * who landed in a language they cannot read, and "Russian" spelled in Azerbaijani is a dead
 * end for exactly that person. Each anchor carries its own `lang` so a screen reader
 * pronounces `Русский` with Russian phonemes instead of reading it as mangled English, and
 * `hrefLang` says the same thing to anything that parses the markup.
 *
 * <h2>The query string is deliberately dropped</h2>
 *
 * Reading it would mean `useSearchParams`, and a component that calls it sits on every route
 * in the shell — which opts those routes out of static rendering unless each one wraps this
 * in its own `Suspense` boundary. That is the whole of #123 undone to keep a filter across a
 * language change. The path is preserved; `/ru/discover?sort=ending` becomes `/ru/discover`.
 */
export interface LanguageSwitcherProps {
  /** Names the group for assistive technology. The visible heading is the footer's. */
  label: string;
}

export function LanguageSwitcher({ label }: LanguageSwitcherProps) {
  const current = useLocale();
  const path = usePathname();

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {SUPPORTED_LOCALES.map((locale: Locale) => {
          const active = locale === current;

          return (
            <li key={locale}>
              <a
                href={localeHref(path, locale)}
                lang={locale}
                hrefLang={locale}
                /*
                 * `page` rather than `true`: this is a set of links to the same page in
                 * other languages, and the one that is current IS the page being read.
                 */
                aria-current={active ? 'page' : undefined}
                onClick={() => writeLocaleCookie(locale)}
                className={
                  active
                    ? 'text-white'
                    : 'text-white/64 transition-colors duration-150 ease-in-out hover:text-white'
                }
              >
                {LOCALE_NAMES[locale]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
