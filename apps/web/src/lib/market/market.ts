import { SUPPORTED_LOCALES } from '../i18n/locale';

/**
 * The reader's market on the web — issue #533.
 *
 * The proxy decides it (the reader's choice, then Cloudflare's country, then Azerbaijan; see
 * `resolveMarket`) and hands it to the render in this request header, which it always
 * overwrites so that a client cannot choose it for somebody else's cached page. The server
 * reads (`lib/api/server.ts`) add it to the service's campaign lists as `market`.
 */
export const MARKET_HEADER = 'x-ideanest-market';

/**
 * The sections whose pages list campaigns, and so differ by market.
 *
 * These pages are no longer the same document for every reader in a language, so they leave
 * `lib/cache/publicRoutes.ts`'s shared cache and are answered `private`. A campaign's own page,
 * a profile and the documents stay shared: a link to a campaign works whatever country the
 * reader browses.
 */
const MARKET_SECTIONS: ReadonlySet<string> = new Set(['', 'discover', 'search', 'categories', 'collections']);

export function isMarketPage(pathname: string): boolean {
  const segments = pathname.split('/');
  const locale = segments[1];
  if (locale === undefined || !(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return false;
  return MARKET_SECTIONS.has(segments[2] ?? '');
}

/** What a page that differs by market tells every cache between it and the reader. */
export const MARKET_PAGE_CACHE_CONTROL = 'private, no-cache';

/** A year, as the language cookie is kept. */
export const MARKET_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
