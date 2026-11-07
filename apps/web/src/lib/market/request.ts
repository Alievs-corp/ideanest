import { headers } from 'next/headers';
import { MARKET_HEADER } from './market';

/**
 * The market the proxy put on this request, or null — #533, #641.
 *
 * Present only on the pages that list campaigns (`isMarketPage`); the proxy removes it from
 * every other, so a page every reader shares reads null here. Outside a request (a test, a
 * build step) `headers()` throws, and that is null too.
 */
export async function requestMarket(): Promise<string | null> {
  try {
    return (await headers()).get(MARKET_HEADER);
  } catch {
    return null;
  }
}
