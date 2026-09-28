import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { COUNTRY_HEADER } from './lib/i18n/country';
import { LOCALE_COOKIE } from './lib/i18n/locale';

/*
 * next-intl's middleware is stubbed rather than run.
 *
 * Two reasons, and the second is the real one. It resolves `next/server` through its own
 * package directory, which this repository's module layout does not satisfy under Vitest —
 * but even if it did, running it here would be testing next-intl. What this file is
 * responsible for is the code in `proxy.ts`: which requests get a redirect, where to,
 * with what status, and — the loop guard — which ones are passed through untouched. The stub
 * makes "passed through" observable as a response with no `location` on it.
 */
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}));

const { default: proxy, config } = await import('./proxy');

/**
 * What happens to a request with no language in its path — issue #123.
 *
 * <h2>Why these are worth asserting</h2>
 *
 * The redirect is the only place a cookie is still read, and every one of its properties is
 * a defect that does not look like one: a 308 instead of a 307 pins a reader's first language
 * in their own browser cache forever, a dropped query string loses a `?category=` a link was
 * shared with, and a path that already names a language being redirected again is an
 * infinite loop that only reproduces for people who have a cookie set.
 */
function request(path: string, cookie?: string, country?: string): NextRequest {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', `${LOCALE_COOKIE}=${cookie}`);
  if (country !== undefined) headers.set(COUNTRY_HEADER, country);
  return new NextRequest(`https://ideanest.az${path}`, { headers });
}

describe('the locale proxy', () => {
  it('sends the bare path to the default language when nothing is stored', () => {
    const response = proxy(request('/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://ideanest.az/en');
  });

  it('sends the bare path to the language the reader last chose', () => {
    const response = proxy(request('/', 'az'));

    expect(response.headers.get('location')).toBe('https://ideanest.az/az');
  });

  it('never answers with a permanent redirect', () => {
    /*
     * A 308 is cached by the browser itself. One recorded from `/` to `/en` would keep
     * sending a reader to English after they chose Azerbaijani — from their own cache,
     * without asking, in a way that no server-side change can reach and that clearing the
     * site's cookies does not fix.
     */
    for (const path of ['/', '/discover', '/projects/aysel/kilims']) {
      expect(proxy(request(path)).status).toBe(307);
    }
  });

  it('keeps the rest of the path and the query string', () => {
    const response = proxy(request('/discover?category=games&page=2', 'ru'));

    expect(response.headers.get('location')).toBe(
      'https://ideanest.az/ru/discover?category=games&page=2',
    );
  });

  it('does not put a trailing slash on the language root', () => {
    /* `/az/` and `/az` would be two addresses for one page. */
    expect(proxy(request('/', 'tr')).headers.get('location')).toBe('https://ideanest.az/tr');
  });

  it('falls back to English rather than trusting a cookie a reader can edit', () => {
    for (const value of ['xx', '', '../../etc/passwd', 'EN']) {
      expect(proxy(request('/', value)).headers.get('location')).toBe(
        'https://ideanest.az/en',
      );
    }
  });

  it('starts a first visit in the language of the country it came from (#125)', () => {
    const cases: [string, string][] = [
      ['AZ', 'az'],
      ['TR', 'tr'],
      ['RU', 'ru'],
      ['KZ', 'ru'],
      ['DE', 'en'],
      ['US', 'en'],
    ];
    for (const [country, locale] of cases) {
      expect(proxy(request('/', undefined, country)).headers.get('location')).toBe(
        `https://ideanest.az/${locale}`,
      );
    }
  });

  it('lets the reader’s own choice outrank their country', () => {
    /* Somebody in Baku who picked English meant it. */
    expect(proxy(request('/', 'en', 'AZ')).headers.get('location')).toBe(
      'https://ideanest.az/en',
    );
  });

  it('falls through to the country when the stored cookie is not a language', () => {
    expect(proxy(request('/', 'xx', 'AZ')).headers.get('location')).toBe(
      'https://ideanest.az/az',
    );
  });

  it('keeps the path when the language comes from the country', () => {
    expect(proxy(request('/discover?page=2', undefined, 'TR')).headers.get('location')).toBe(
      'https://ideanest.az/tr/discover?page=2',
    );
  });

  it('never lets a shared cache replay one visitor’s redirect to another', () => {
    /*
     * The destination is decided by a cookie and a country. A CDN that stored the `307`
     * a visitor from Baku was given would send the next visitor, from Berlin, to `/az`.
     */
    for (const response of [proxy(request('/')), proxy(request('/', 'ru', 'AZ'))]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('leaves a path that already names a language alone', () => {
    /*
     * The loop guard. next-intl's middleware answers these, and what matters here is that
     * this file does not send them round again — a second redirect on `/az/discover` would
     * be an infinite one, reproducing only for readers who have a cookie set.
     */
    for (const path of ['/az', '/en/discover', '/ru/projects/aysel/kilims', '/tr/settings']) {
      expect(proxy(request(path, 'az', 'TR')).headers.get('location')).toBeNull();
    }
  });
});

/**
 * Which requests this file is asked about at all — the matcher.
 *
 * <h2>Why the matcher needs tests of its own</h2>
 *
 * Everything above tests the function. The function only ever sees the paths the matcher
 * let through, so a path wrongly *inside* the matcher is invisible to those tests: the
 * redirect they assert is correct is the very thing that breaks it.
 *
 * That is not hypothetical. `/v1/:path*` is rewritten to the service by `next.config.mjs`,
 * and the proxy runs before that rewrite. While `v1` was missing from the exclusions here,
 * every call the browser made to the API was answered with `307 → /en/v1/...`, which matches
 * no route and no rewrite. The sign-in and register forms both reported "the service could
 * not be reached" — a network failure with a healthy service behind it, because `fetch`
 * followed the redirect and was handed a 404 page instead of JSON.
 *
 * A page route is reachable in a browser, so a mistake in one is found by opening it. An
 * excluded prefix is only ever exercised by a `fetch` that has already failed by the time
 * anybody looks, which is why these are asserted rather than reviewed.
 */
describe('the paths the locale proxy is asked about', () => {
  /*
   * Next compiles the matcher itself. Anchoring the source is close enough to catch what
   * this is for — a prefix that is in the exclusion list, or is missing from it.
   */
  const matches = (path: string): boolean => new RegExp(`^${config.matcher[0]}$`).test(path);

  it('never sees a call to the service, because a redirect there is a failed request', () => {
    for (const path of [
      '/v1/auth/login',
      '/v1/auth/register',
      '/v1/auth/refresh',
      '/v1/projects',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });

  it('never sees the beacon, build output or the addresses fixed by convention', () => {
    for (const path of [
      '/api/vitals',
      '/_next/static/chunks/main.js',
      '/robots.txt',
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/icon.svg',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });

  /*
   * The regression this exists for is not the redirect. It is that
   * `apple-app-site-association` is the one fixed address on the site with no
   * extension, so the clause that spares `/robots.txt` and `/icon.svg` does not
   * spare it — and Apple's fetcher does not follow redirects, so the failure is
   * "universal links stopped working" with nothing on the site to look at.
   */
  it('never sees the mobile association files, which cannot be localised (#114)', () => {
    for (const path of [
      '/.well-known/apple-app-site-association',
      '/.well-known/assetlinks.json',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });

  /*
   * `/icon.svg` above is spared by its extension. The favicon Next actually generates from
   * `app/icon.tsx` is `/icon`, with none — and a redirect on it left the site with no favicon
   * at all (#112).
   */
  it('never sees the generated icons, which have no extension to spare them (#112)', () => {
    for (const path of ['/icon', '/apple-icon']) {
      expect(matches(path)).toBe(false);
    }
  });

  it('still localises a page whose address only starts with the word icon', () => {
    for (const path of ['/iconography', '/icons/new']) {
      expect(matches(path)).toBe(true);
    }
  });

  it('still sees every page, which is the whole point of it', () => {
    for (const path of [
      '/',
      '/discover',
      '/az/discover',
      '/projects/aysel/kilims',
      '/collections',
      '/admin/payouts',
    ]) {
      expect(matches(path)).toBe(true);
    }
  });
});
