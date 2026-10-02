import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const { platformStatus } = await import('./lib/maintenance/gate');

/*
 * The status endpoint is not asked from a unit test. Unknown by default, which is what an
 * unreachable service reads as — every page open, exactly as before #214.
 */
const statusMock = vi.spyOn(platformStatus, 'current');
beforeEach(() => {
  statusMock.mockReset();
  statusMock.mockResolvedValue(null);
});

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
  it('sends the bare path to the default language when nothing is stored', async () => {
    const response = await proxy(request('/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://ideanest.az/en');
  });

  it('sends the bare path to the language the reader last chose', async () => {
    const response = await proxy(request('/', 'az'));

    expect(response.headers.get('location')).toBe('https://ideanest.az/az');
  });

  it('never answers with a permanent redirect', async () => {
    /*
     * A 308 is cached by the browser itself. One recorded from `/` to `/en` would keep
     * sending a reader to English after they chose Azerbaijani — from their own cache,
     * without asking, in a way that no server-side change can reach and that clearing the
     * site's cookies does not fix.
     */
    for (const path of ['/', '/discover', '/projects/aysel/kilims']) {
      expect((await proxy(request(path))).status).toBe(307);
    }
  });

  it('keeps the rest of the path and the query string', async () => {
    const response = await proxy(request('/discover?category=games&page=2', 'ru'));

    expect(response.headers.get('location')).toBe(
      'https://ideanest.az/ru/discover?category=games&page=2',
    );
  });

  it('does not put a trailing slash on the language root', async () => {
    /* `/az/` and `/az` would be two addresses for one page. */
    expect((await proxy(request('/', 'tr'))).headers.get('location')).toBe('https://ideanest.az/tr');
  });

  it('falls back to English rather than trusting a cookie a reader can edit', async () => {
    for (const value of ['xx', '', '../../etc/passwd', 'EN']) {
      expect((await proxy(request('/', value))).headers.get('location')).toBe(
        'https://ideanest.az/en',
      );
    }
  });

  it('starts a first visit in the language of the country it came from (#125)', async () => {
    const cases: [string, string][] = [
      ['AZ', 'az'],
      ['TR', 'tr'],
      ['RU', 'ru'],
      ['KZ', 'ru'],
      ['DE', 'en'],
      ['US', 'en'],
    ];
    for (const [country, locale] of cases) {
      expect((await proxy(request('/', undefined, country))).headers.get('location')).toBe(
        `https://ideanest.az/${locale}`,
      );
    }
  });

  it('lets the reader’s own choice outrank their country', async () => {
    /* Somebody in Baku who picked English meant it. */
    expect((await proxy(request('/', 'en', 'AZ'))).headers.get('location')).toBe(
      'https://ideanest.az/en',
    );
  });

  it('falls through to the country when the stored cookie is not a language', async () => {
    expect((await proxy(request('/', 'xx', 'AZ'))).headers.get('location')).toBe(
      'https://ideanest.az/az',
    );
  });

  it('keeps the path when the language comes from the country', async () => {
    expect((await proxy(request('/discover?page=2', undefined, 'TR'))).headers.get('location')).toBe(
      'https://ideanest.az/tr/discover?page=2',
    );
  });

  it('never lets a shared cache replay one visitor’s redirect to another', async () => {
    /*
     * The destination is decided by a cookie and a country. A CDN that stored the `307`
     * a visitor from Baku was given would send the next visitor, from Berlin, to `/az`.
     */
    for (const response of await Promise.all([proxy(request('/')), proxy(request('/', 'ru', 'AZ'))])) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('leaves a path that already names a language alone', async () => {
    /*
     * The loop guard. next-intl's middleware answers these, and what matters here is that
     * this file does not send them round again — a second redirect on `/az/discover` would
     * be an infinite one, reproducing only for readers who have a cookie set.
     */
    for (const path of ['/az', '/en/discover', '/ru/projects/aysel/kilims', '/tr/settings']) {
      expect((await proxy(request(path, 'az', 'TR'))).headers.get('location')).toBeNull();
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

/**
 * The maintenance gate — §19.6, issue #214.
 *
 * <h2>Why a rewrite's status is asserted here and again against a running server</h2>
 *
 * These assert what the proxy hands Next. Whether Next then sends that status for a page it
 * renders is a property of the framework, and the pull request that added this checked it
 * with a real request against `next start` rather than trusting the object below.
 */
describe('the maintenance gate', () => {
  const WINDOW = {
    state: 'maintenance' as const,
    maintenance: {
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: '2026-10-04T22:30:00Z',
      source: 'api' as const,
      retryAfterSeconds: 1200,
    },
    upcoming: null,
  };

  it('answers a page with the maintenance page, a 503 and the contract’s headers', async () => {
    statusMock.mockResolvedValue(WINDOW);

    const response = await proxy(request('/az/discover?category=games'));

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1200');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // A rewrite, not a redirect: the reader's address stays, so the page can take them back.
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://ideanest.az/az/maintenance');
    // In the reader's language: the page is told which one, as next-intl's middleware would.
    expect(response.headers.get('x-middleware-request-x-next-intl-locale')).toBe('az');
  });

  it('closes the account pages too, because a page render cannot tell staff from a reader', async () => {
    statusMock.mockResolvedValue(WINDOW);

    for (const path of ['/en', '/ru/settings', '/tr/projects/aysel/kilims', '/az/maintenance']) {
      expect((await proxy(request(path))).status).toBe(503);
    }
  });

  it('keeps the console and the sign-in page open, so staff can work through a window', async () => {
    statusMock.mockResolvedValue(WINDOW);

    for (const path of ['/az/admin', '/en/admin/maintenance', '/ru/sign-in']) {
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    }
  });

  it('leaves every page open when the platform is operational', async () => {
    statusMock.mockResolvedValue({ state: 'operational', maintenance: null, upcoming: null });

    const response = await proxy(request('/az/discover'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('never reads "not known" as maintenance', async () => {
    /*
     * An unreachable status endpoint, a bare 503: a page rendering its own failure state is
     * honest, and a calm "planned maintenance" over an incident is not.
     */
    const response = await proxy(request('/az/discover'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('sends a path with no language to its language first, and closes it there', async () => {
    statusMock.mockResolvedValue(WINDOW);

    const response = await proxy(request('/discover', 'az'));

    expect(response.status).toBe(307);
    expect(statusMock).not.toHaveBeenCalled();
  });
});

describe('the native app payment return', () => {
  it('answers via=app on a pledge page with the app scheme, before the locale or maintenance', async () => {
    statusMock.mockResolvedValue({ state: 'maintenance', maintenance: null } as never);
    const response = await proxy(request('/az/pledges/abc-1?payment=returned&via=app'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('ideanest://pledges/abc-1?payment=returned');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('leaves a pledge page without via=app to the site', async () => {
    const response = await proxy(request('/az/pledges/abc-1?payment=returned'));

    expect(response.headers.get('location')).toBeNull();
  });
});
