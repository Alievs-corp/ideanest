'use client';

import { useEffect } from 'react';
import { announceMarket, rememberPageMarket } from '../../lib/market/cookie';

export interface MarketSeedProps {
  /** The market the proxy resolved for this request (`requestMarket()`), or null. */
  readonly market: string | null;
}

/**
 * Hands the browser the market a page that lists campaigns was rendered for — #641.
 *
 * This replaces the `ideanest_country_detected` cookie: the country Cloudflare places a reader
 * in reaches the header's country control, the empty-list notice and the browser's own list
 * requests from the render that already used it, so nothing is stored on the reader's device.
 *
 * The market is kept while this renders rather than in an effect, because a list's first read
 * can run in an effect of its own, and effects run child first: by then every render on the page
 * has happened. Keeping it is an idempotent assignment of the same value. The controls are told
 * once the page has committed.
 *
 * Rendered first on the page, outside any `Suspense`, so it hydrates with the page's shell.
 */
export function MarketSeed({ market }: MarketSeedProps) {
  rememberPageMarket(market);
  useEffect(() => {
    rememberPageMarket(market);
    announceMarket();
  }, [market]);
  return null;
}
