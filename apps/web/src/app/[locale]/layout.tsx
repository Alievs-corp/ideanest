import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { WebVitals } from '../../components/rum/WebVitals';
import { SessionProvider } from '../../components/session/SessionProvider';
import { routing } from '../../i18n/routing';
import { DEFAULT_LOCALE, localeOrDefault } from '../../lib/i18n/locale';
import { followMaintenanceSource } from '../../lib/maintenance/script';
import { rootMetadata } from '../../lib/seo/metadata';
import { MAINTENANCE_PROBLEM_TYPE } from '@ideanest/api-client/maintenance';
import '../globals.css';

/**
 * The body and numeral face (docs/ui-kit.md §5.1). Until this existed the token
 * file named `'Inter'` in `--font-sans` and nothing ever served it, so every
 * surface fell through to `system-ui` — Segoe UI on Windows, Roboto on Android.
 * The type scale and the negative tracking in §5.3 were measured against Inter's
 * metrics, so the product was rendering a design nobody had approved.
 *
 * `next/font` self-hosts the file out of `/_next/static/media` at build time.
 * That is not only a request saved: a `fonts.googleapis.com` stylesheet is a
 * blocking round trip to a third origin before the browser even learns which
 * `.woff2` to ask for, and it hands a third party a log line per visitor.
 *
 * SUBSETS. `latin`, `latin-ext` and `cyrillic` — and deliberately not the
 * `cyrillic-ext`, `greek`, `greek-ext` or `vietnamese` cuts Google also
 * publishes, because nothing in this product is written in them and each one
 * is another file preloaded against the largest contentful paint.
 *
 * **`cyrillic` WAS MISSING AND RUSSIAN WAS RENDERING IN THE FALLBACK FACE.**
 * `messages/ru.json` has shipped since #324 and the account rail has been
 * drawing Russian out of it, in Segoe UI on Windows and Roboto on Android,
 * because Inter's `latin` and `latin-ext` cuts carry no Cyrillic at all. It
 * did not look broken — it looked like a slightly different font — which is
 * why it survived review. The type scale and the negative tracking in
 * docs/ui-kit.md §5.3 were measured against Inter's metrics, so a quarter of
 * the platform's readers were being shown a design nobody approved.
 *
 * The cut is `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116` — the
 * modern Russian alphabet, the stressed vowel, the Ukrainian ghe and the
 * numero sign. It is preloaded like the others, and the cost is real: it is
 * the price of the language being legible rather than approximately legible.
 *
 * Both of the two are needed, which is worth stating because dropping
 * `latin-ext` looks free and is not. Azerbaijani needs `ə ğ ı ö ş ü ç` and
 * their capitals; Google's `latin` cut carries `ı` (U+0131), `ö`, `ü` and `ç`,
 * but `ə` (U+0259), `Ə` (U+018F), `ğ`, `Ğ`, `ş`, `Ş` and `İ` all sit in
 * `U+0100-02BA`, which only `latin-ext` declares. A missing `ə` is a broken
 * product in this market, and `font-subsets.test.ts` fails if this list stops
 * covering those code points.
 *
 * `display: 'swap'` because text that is invisible for three seconds is worse
 * than text in the wrong face for one. `preload` and `adjustFontFallback` are
 * left at their defaults, which are both `true`: Next emits
 * `<link rel="preload">` for the two subset files — the only preloads on the
 * page, and they are on the critical path because every glyph above the fold is
 * set in this family — and it synthesises a metric-matched local fallback so the
 * swap does not move the layout. That fallback is what keeps cumulative layout
 * shift under the 0.05 that docs/motion-system.md §8 asks for.
 *
 * Only `--font-sans` is bound here. `--font-display` still asks for General
 * Sans first (docs/ui-kit.md §5.1's first choice), which is a Fontshare licence
 * and a vendored binary rather than a build-time download; until somebody makes
 * that call it resolves to Inter, which is exactly the substitution §5.1 names.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * The defaults every page inherits — the title template, the site description,
 * `metadataBase`, and the Open Graph and X blocks. `lib/seo/metadata.ts` holds
 * them and explains each one; in particular it explains why there is deliberately
 * NO canonical here.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  /*
   * A function rather than the `const` this used to be, because the defaults now include
   * `og:locale` and that is a property of the route rather than of the build.
   * `localeOrDefault` narrows here as well as in the component: metadata is generated for a
   * segment before the component that calls `notFound()` ever runs.
   */
  return rootMetadata(localeOrDefault(locale));
}

/**
 * The four documents this layout is built into, named ahead of the build.
 *
 * Without it Next has no way to know what a `[locale]` can be, so it would render each
 * language on first request and cache it after — every language's first visitor paying for
 * a render, forever, including the crawler that is usually first. Four is the whole list and
 * it is not a sample: `routing.locales` is `lib/i18n/locale.ts`, which `locale.test.ts`
 * holds level with the API and the `users_locale_supported` check constraint.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * `color-scheme: dark` is declared on `:root` by the token file
 * (docs/ui-kit.md §9.4), so browser chrome, scrollbars, and native controls
 * follow the system without anything further here.
 *
 * `lang` IS THE ROUTE'S OWN SEGMENT (#123). It used to be a module constant, which was
 * honest while the site was English and would now be a lie on three quarters of its pages:
 * a document served at `/ru/discover` announcing `lang="en"` tells a screen reader to
 * pronounce Russian with English phonetics, which does not read as a translation defect to
 * the person hearing it — it reads as noise. `lib/seo/metadata.ts` builds `og:locale` from
 * the same value, so what the page tells an assistive technology and what it tells an
 * unfurler still cannot drift apart (docs/architecture.md §21.1).
 *
 * The font variable class goes on `<html>` rather than `<body>` so that
 * `--font-inter` is in scope for anything portalled to `document.body` — every
 * overlay in the kit renders there, and a modal in a different typeface than the
 * page under it is the kind of defect nobody reports and everybody sees.
 *
 * `<WebVitals />` renders nothing at all — it is a client boundary that
 * subscribes to the browser's performance observers and returns `null`, so it
 * adds no element, no text and no layout. It is here rather than in a page
 * because a field measurement of one route is not a measurement; see
 * `docs/observability/real-user-monitoring.md`. It sits before `{children}` so
 * that the boundary is established before anything that could throw inside it.
 *
 * `<SessionProvider>` IS HERE AND NOT IN `app/(site)/layout.tsx`, which is the decision #267
 * turns on. Three groups of routes need to know who is reading — the public shell, the
 * authentication screens, and every private route the guard covers — and they do not share a
 * layout below this one. A provider per group would mean the session is bootstrapped again on
 * every navigation between them, which is a `/v1/auth/refresh` per crossing, and refresh
 * tokens rotate: two of those racing is precisely what the single-flight in
 * `lib/api/access-token.ts` exists to prevent. One provider, at the root, read once.
 *
 * It renders `{children}` unchanged and adds no element of its own. What it costs every route
 * is a context and one effect; what it buys is that no page has to remember to guard itself.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  /*
   * A `[locale]` segment is a wildcard: `/xx/discover` matches this route and only then
   * fails. Answering with the 404 the address deserves is better than rendering the English
   * page under a language tag that is a lie to every assistive technology reading it.
   */
  if (!hasLocale(routing.locales, locale)) notFound();

  /*
   * WITHOUT THIS LINE EVERY LOCALISED ROUTE IS DYNAMIC, which would undo the entire point of
   * #123. `getTranslations` reaches for the request-scoped locale, and outside a static
   * render there is no request to scope it to — so next-intl opts the segment out of static
   * generation unless it is told, before anything renders, which language this pass is for.
   * The cost of forgetting it is invisible in development and shows up as `f (Dynamic)` in
   * the build output for routes that used to be cached.
   */
  setRequestLocale(locale);

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-dvh bg-surface-1">
        {/*
          A call to the service that meets the maintenance problem sends the reader to the
          maintenance page — #214. An inline script that wraps `fetch`, first in the body so it
          is in place before any bundle runs; `lib/maintenance/script.ts` has why it is not a
          line in `lib/api/client.ts`, measured.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: followMaintenanceSource({
              type: MAINTENANCE_PROBLEM_TYPE,
              locales: [...routing.locales],
              fallbackLocale: DEFAULT_LOCALE,
            }),
          }}
        />
        <WebVitals />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
