import { DEFAULT_MARKET, MARKET_COOKIE, marketParameter } from '@ideanest/messages/country';
import { MARKET_COOKIE_MAX_AGE_SECONDS } from './market';

/**
 * The market as the browser sees it — issue #533.
 *
 * The proxy is the authority: it checks the reader's cookie against every country and hands
 * the render its answer. This only mirrors that answer for the controls and the browser's own
 * reads, so it checks the shape of a code rather than carrying the list of every country into
 * the header, which is in every page's first load.
 *
 * <h2>Where the reader is, without a cookie</h2>
 *
 * The country Cloudflare places a reader in used to reach the browser as a session cookie the
 * proxy wrote on the pages that list campaigns. The reader never asked for it, so it went
 * (#641): a page that lists campaigns now renders its market into a `MarketSeed`, which keeps it
 * here, in memory, for this document. The reader's own cookie still outranks it, and with
 * neither the market is Azerbaijan, as it always was before a list had been seen.
 */
const SHAPE = /^(?:[A-Z]{2}|ALL)$/;

/** The market the last page that lists campaigns was rendered for; null before one has been. */
let pageMarket: string | null = null;
const listeners = new Set<() => void>();

/**
 * Keeps the market a page was rendered for. Called while `MarketSeed` renders, so a list's first
 * read in an effect already has it; {@link announceMarket} then tells the controls.
 */
export function rememberPageMarket(market: string | null): void {
  pageMarket = market !== null && SHAPE.test(market) ? market : null;
}

export function announceMarket(): void {
  for (const listener of listeners) listener();
}

export function subscribeMarket(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(cookieString: string, name: string): string | null {
  for (const pair of cookieString.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    return SHAPE.test(value) ? value : null;
  }
  return null;
}

/** The reader's choice, then the market a page was rendered for, then Azerbaijan. */
export function marketFromCookies(cookieString: string, rendered: string | null = null): string {
  return read(cookieString, MARKET_COOKIE) ?? rendered ?? DEFAULT_MARKET;
}

export function currentMarket(): string {
  return typeof document === 'undefined' ? DEFAULT_MARKET : marketFromCookies(document.cookie, pageMarket);
}

export function writeMarketCookie(market: string): void {
  document.cookie = `${MARKET_COOKIE}=${market}; Path=/; Max-Age=${MARKET_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  announceMarket();
}

/**
 * `params` with the reader's market added, for a request the browser makes itself (#533).
 * Every country is the parameter left out.
 */
export function withMarket(params: URLSearchParams, market: string = currentMarket()): URLSearchParams {
  const code = marketParameter(market);
  if (code !== null) params.set('market', code);
  return params;
}
