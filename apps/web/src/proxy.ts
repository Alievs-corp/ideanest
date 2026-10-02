import createIntlMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { publicCacheControl } from './lib/cache/publicRoutes';
import { maintenanceHeaders, maintenancePageFor, platformStatus } from './lib/maintenance/gate';
import { COUNTRY_HEADER, localeForCountry } from './lib/i18n/country';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from './lib/i18n/locale';
import { routing } from './i18n/routing';
import { appPaymentReturn } from './lib/pledges/app-return';

/**
 * Where a request with no language in its path is sent — issue #123.
 *
 * <h2>Why this is not just `createIntlMiddleware`</h2>
 *
 * next-intl's middleware can pick a language on its own, and `routing.ts` turns that off.
 * Its detection reads `Accept-Language`, which makes the response vary by that header, and
 * a `Vary: Accept-Language` on the front door fragments the shared CDN cache per browser
 * configuration. The whole reason the language moved into the path was to stop paying a
 * per-visitor cost on cached routes; negotiating on a header would put it back.
 *
 * So this file answers the one question detection existed to answer — *a request arrived
 * at `/discover` with no language, which language did this person mean?* — from the stored
 * preference, then from the country Cloudflare says the request came from (#125,
 * `lib/i18n/country.ts`), and delegates everything else. Both are read only on this redirect,
 * which is never cached, so neither reaches a localised page.
 *
 * <h2>The cookie's job changed, and shrank</h2>
 *
 * It used to be what a render read to know what language to draw. It is not that any more:
 * the path says the language, and a render that needed the cookie would be dynamic again.
 * All the cookie does now is answer the redirect above — *last time, this person chose
 * Russian* — so a returning reader who types the bare domain is not met by English.
 *
 * `users.locale` remains the durable record and this remains its cache. `SessionProvider`
 * still mirrors the account's column into it on bootstrap, so the preference survives a new
 * device; that mechanism is untouched.
 *
 * <h2>It is also where a public page is marked cacheable — #127</h2>
 *
 * Every server render in this application is anonymous: the refresh cookie lives on
 * `Path=/v1/auth`, so a page request carries no session, and nothing under `src/` reads
 * `next/headers` at all. That makes the HTML of a public page shareable, which the framework
 * cannot infer — a dynamic route is `private, no-store` by default, whatever it rendered.
 *
 * `lib/cache/publicRoutes.ts` decides which paths qualify and why the decision is a function
 * rather than a pattern in `next.config.mjs`. It is applied here because this is the one place
 * every request already passes through, and because a header set beside the redirect that
 * created the address cannot drift away from it.
 *
 * <h2>307 AND NOT 308, DELIBERATELY</h2>
 *
 * The destination depends on a cookie and a country, so it is not permanent and must never be
 * recorded as such. A browser that cached a 308 from `/` to `/en` would keep sending itself to English
 * after the reader chose Azerbaijani — from its own cache, without asking, in a way that
 * clearing the site's cookies does not fix and that no server-side change can reach.
 */
const intlMiddleware = createIntlMiddleware(routing);

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const appReturn = appPaymentReturn(request.nextUrl);
  if (appReturn !== null) {
    return new NextResponse(null, {
      status: 303,
      headers: { location: appReturn, 'cache-control': 'private, no-store' },
    });
  }

  /*
   * `/az/discover` splits to `['', 'az', 'discover']`, so the candidate is always index 1.
   * A path that already names a language is next-intl's to handle.
   */
  if (isLocale(pathname.split('/')[1])) {
    /*
     * DURING A MAINTENANCE WINDOW, BEFORE ANYTHING ELSE — #214. `lib/maintenance/gate.ts` has
     * the argument: a page cannot choose its own status once it has started rendering, and a
     * maintenance answer has to be a `503` with a `Retry-After` for a crawler to keep the page.
     * A rewrite rather than a redirect, so the address stays the one the reader asked for and
     * the maintenance page can take them back to it.
     */
    const closed = await maintenanceAnswer(request);
    if (closed !== null) return closed;

    const response = intlMiddleware(request);

    const cacheControl = publicCacheControl(pathname);
    if (cacheControl !== null) response.headers.set('cache-control', cacheControl);

    return response;
  }

  const locale = firstLocale(request);
  const destination = request.nextUrl.clone();

  /*
   * `/` must become `/az` rather than `/az/`. Every other path is appended whole, which
   * preserves the query string and hash because `clone()` carries them and only `pathname`
   * is being replaced.
   */
  destination.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;

  const response = NextResponse.redirect(destination, 307);

  /*
   * The destination depends on a cookie and on where the request came from, so one visitor's
   * redirect must never be replayed to another by a shared cache in front of this one.
   */
  response.headers.set('cache-control', 'private, no-store');

  return response;
}

/**
 * The maintenance page, with the contract's status and headers, when a window is in force and
 * this page is not one of the few that stay open; null otherwise.
 */
async function maintenanceAnswer(request: NextRequest): Promise<NextResponse | null> {
  const page = maintenancePageFor(request.nextUrl.pathname);
  if (page === null) return null;

  const status = await platformStatus.current();
  if (status?.state !== 'maintenance' || status.maintenance === null) return null;

  const destination = request.nextUrl.clone();
  destination.pathname = page;
  destination.search = '';

  /*
   * The language travels as next-intl's own middleware hands it on, because that middleware is
   * not run for this request: without it the page renders before the layout has said which
   * language this is, and an Azerbaijani reader is told about the outage in English.
   */
  const headers = new Headers(request.headers);
  headers.set(NEXT_INTL_LOCALE_HEADER, page.split('/')[1] ?? '');

  return NextResponse.rewrite(destination, {
    status: 503,
    headers: maintenanceHeaders(status.maintenance),
    request: { headers },
  });
}

/** next-intl's `HEADER_LOCALE_NAME`, which its request config reads the language from. */
const NEXT_INTL_LOCALE_HEADER = 'X-NEXT-INTL-LOCALE';

/**
 * The language a request with none in its path is sent to — #123, then #125.
 *
 * The reader's own choice first: a stored cookie outranks everything, including the country,
 * because somebody in Baku who picked English meant it. Then the country Cloudflare says the
 * request came from. Then {@link DEFAULT_LOCALE}.
 *
 * A cookie that is not a language is treated as absent rather than as English, so it falls
 * through to the country instead of pinning its holder to the default.
 */
function firstLocale(request: NextRequest): Locale {
  const stored = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;

  return localeForCountry(request.headers.get(COUNTRY_HEADER)) ?? DEFAULT_LOCALE;
}

export const config = {
  /*
   * WHAT IS DELIBERATELY NOT MATCHED, EACH FOR ITS OWN REASON.
   *
   * `api/` is the RUM beacon. It is called by `WebVitals` from every page including the
   * localised ones, and a redirect on a `sendBeacon` is a measurement silently lost.
   *
   * `v1/` is the service. `next.config.mjs` rewrites it to the API origin, and the proxy
   * runs before that rewrite — so a match here does not delay the call, it replaces it. While
   * this prefix was missing, every request the browser made to the API was answered with a
   * `307` to `/en/v1/...`, which matches no route and no rewrite. `fetch` follows the
   * redirect, is handed a 404 page, and the form reports that the service could not be
   * reached: a network failure with a healthy service behind it. Sign-in and register were
   * both unusable in the browser while both worked when called directly.
   *
   * `_next/` and anything with a dot in the last segment are build output and static files.
   * Prefixing a hashed chunk with a language would 404 it.
   *
   * `robots.txt`, `sitemap.xml` and `sitemap_index.xml` are addresses fixed by convention
   * rather than by this application, and a crawler that follows a redirect to `/en/robots.txt`
   * has been given a file at an address it will not treat as authoritative. They stay at the
   * root and enumerate the localised pages from there.
   *
   * `.well-known/` is the same rule with sharper consequences — issue #114. It carries the
   * two files that let a link on this site open the mobile application, and one of them,
   * `apple-app-site-association`, has NO EXTENSION: the `.*\.[\w]+$` clause above is what
   * spares every other fixed address, and it is precisely what does not spare this one.
   * Apple's fetcher does not follow a redirect, so a `307` to `/en/.well-known/...` reads to
   * it as "this site has no association" — universal links then never activate, silently,
   * with nothing broken on the site itself to notice. The whole prefix is excluded rather
   * than that one file, because every address under it is fixed by a specification rather
   * than by this application and none of them may be localised.
   *
   * `icon` and `apple-icon` are the same trap as `apple-app-site-association` — issue #112.
   * `app/icon.tsx` is a metadata route, and Next serves it at `/icon?<hash>` with no
   * extension, so the extension clause does not spare it. While it was missing, every page's
   * `<link rel="icon">` was answered with a `307` to `/en/icon`, which is a 404, and the site
   * had no favicon anywhere. They are matched whole (`icon$`) rather than as a prefix so that
   * a page whose address merely starts with the word is still localised.
   */
  matcher: [
    '/((?!api|v1|_next|\\.well-known|robots\\.txt|sitemap\\.xml|sitemap_index\\.xml|icon$|apple-icon$|.*\\.[\\w]+$).*)',
  ],
};
