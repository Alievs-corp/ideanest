import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_COOKIE } from '@ideanest/messages/country';
import { COUNTRY_HEADER } from './lib/i18n/country';
import { LOCALE_COOKIE } from './lib/i18n/locale';
import { platformStatus } from './lib/maintenance/gate';
import proxy from './proxy';

/**
 * Which cookies a page answer sets — #641.
 *
 * `proxy.test.ts` stubs next-intl's middleware to test this file's own decisions. This one runs
 * the real middleware with the real `routing.ts`, because the cookie the audit found on every
 * localised page (`NEXT_LOCALE`) was next-intl's, written by a default nobody had turned off.
 *
 * The site goes without a consent banner on one condition: nothing it sets is neither strictly
 * necessary nor chosen by the reader. The proxy sets nothing at all, so the assertion is the
 * absence of any `Set-Cookie`, not of two names: a third cookie added later fails here too.
 */
const statusMock = vi.spyOn(platformStatus, 'current');
beforeEach(() => {
  statusMock.mockReset();
  statusMock.mockResolvedValue(null);
});

/*
 * A Russian browser in Germany with no choice made: the page's language differs from the
 * `Accept-Language` best match, which is exactly when next-intl's default wrote its cookie.
 */
function visit(path: string, cookie?: string): NextRequest {
  const headers = new Headers({ 'accept-language': 'ru-RU,ru;q=0.9', [COUNTRY_HEADER]: 'DE' });
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new NextRequest(`https://ideyanest.com${path}`, { headers });
}

const PAGES = [
  '/',
  '/discover',
  '/az',
  '/az/discover',
  '/en/search?q=lamp',
  '/tr/categories/games',
  '/az/collections',
  '/az/projects/aysel/kilims',
  '/en/pricing',
];

describe('the cookies a page answer sets (#641)', () => {
  it('sets none, on a bare path, a page that lists campaigns or any other page', async () => {
    for (const path of PAGES) {
      const response = await proxy(visit(path));
      expect(response.headers.get('set-cookie'), path).toBeNull();
      expect(response.cookies.getAll(), path).toEqual([]);
    }
  });

  it('sets none for a reader who has chosen a language and a country either', async () => {
    for (const path of PAGES) {
      const response = await proxy(visit(path, `${LOCALE_COOKIE}=ru; ${MARKET_COOKIE}=GE`));
      expect(response.headers.get('set-cookie'), path).toBeNull();
    }
  });

  it('still sends a bare path to the language the country speaks', async () => {
    const response = await proxy(visit('/discover'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://ideyanest.com/en/discover');

    const fromBaku = new NextRequest('https://ideyanest.com/discover', { headers: { [COUNTRY_HEADER]: 'AZ' } });
    expect((await proxy(fromBaku)).headers.get('location')).toBe('https://ideyanest.com/az/discover');
  });

  it('still sends a bare path to the language the reader chose', async () => {
    const response = await proxy(visit('/discover', `${LOCALE_COOKIE}=tr`));
    expect(response.headers.get('location')).toBe('https://ideyanest.com/tr/discover');
  });

  it('renders a localised page in its own language, whatever the browser prefers', async () => {
    const response = await proxy(visit('/az/discover'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite') ?? response.headers.get('x-middleware-next')).not.toBeNull();
  });
});
