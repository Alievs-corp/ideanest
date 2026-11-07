'use client';

import { useSyncExternalStore } from 'react';
import { currentMarket, subscribeMarket } from './cookie';

/**
 * The reader's market for a control, or null until the page has hydrated — #533, #641.
 *
 * Null on the server and during hydration, because the header is the same render for every
 * reader. After that it follows the reader's choice and the market a page that lists campaigns
 * was rendered for, including one that hydrates after the header or arrives by a client-side
 * navigation.
 */
export function useMarket(): string | null {
  return useSyncExternalStore(subscribeMarket, currentMarket, serverMarket);
}

function serverMarket(): null {
  return null;
}
