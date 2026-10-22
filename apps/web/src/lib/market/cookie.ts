import {
  DETECTED_MARKET_COOKIE,
  MARKET_COOKIE,
  isMarket,
  marketParameter,
  resolveMarket,
} from '@ideanest/messages/country';
import { MARKET_COOKIE_MAX_AGE_SECONDS } from './market';

function read(cookieString: string, name: string): string | null {
  for (const pair of cookieString.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return null;
}

/** The market this reader browses in, as the proxy resolved it for the page they are on. */
export function marketFromCookies(cookieString: string): string {
  return resolveMarket(read(cookieString, MARKET_COOKIE), read(cookieString, DETECTED_MARKET_COOKIE));
}

/** Whether the reader has chosen, as opposed to being placed by where they are. */
export function chosenMarket(cookieString: string): string | null {
  const value = read(cookieString, MARKET_COOKIE);
  return isMarket(value) ? value : null;
}

export function currentMarket(): string {
  return typeof document === 'undefined' ? resolveMarket(null, null) : marketFromCookies(document.cookie);
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
