import {
  ALL_MARKETS,
  DEFAULT_MARKET,
  DETECTED_MARKET_COOKIE,
  MARKET_COOKIE,
  marketParameter,
} from '@ideanest/messages/country';
import { MARKET_COOKIE_MAX_AGE_SECONDS } from './market';

/**
 * The market as the browser sees it — issue #533.
 *
 * The proxy is the authority: it checks the reader's cookie against every country and writes
 * the detected one itself. This only mirrors its answer for the controls and the browser's own
 * reads, so it checks the shape of a code rather than carrying the list of every country into
 * the header, which is in every page's first load.
 */
const SHAPE = /^(?:[A-Z]{2}|ALL)$/;

function read(cookieString: string, name: string): string | null {
  for (const pair of cookieString.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    return SHAPE.test(value) ? value : null;
  }
  return null;
}

/** The reader's choice, then where the proxy placed them, then Azerbaijan. */
export function marketFromCookies(cookieString: string): string {
  const chosen = read(cookieString, MARKET_COOKIE);
  if (chosen !== null) return chosen;
  const detected = read(cookieString, DETECTED_MARKET_COOKIE);
  return detected !== null && detected !== ALL_MARKETS ? detected : DEFAULT_MARKET;
}

export function currentMarket(): string {
  return typeof document === 'undefined' ? DEFAULT_MARKET : marketFromCookies(document.cookie);
}

export function writeMarketCookie(market: string): void {
  document.cookie = `${MARKET_COOKIE}=${market}; Path=/; Max-Age=${MARKET_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
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
