import { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { siteUrl } from '../../../api/config';
import type { CardRegistrationRequest } from './api';

/** The web's `PayoutDetailsPanel`: the destination is re-read every three seconds for a minute. */
export const CHECKS = 20;
export const CHECK_INTERVAL_MS = 3000;

export type CardReturnHint = 'returned' | 'failed';

/** Where the browser session ends: the address the site's `via=app` return answers with. */
export const CARD_RETURN_PREFIX = 'ideanest://settings/payout';

/**
 * The web's `cardReturnFor`, with `via=app`. The provider may only return to the site
 * (docs/architecture.md §9.4, and #139: the service forwards these unchecked), so the site's proxy
 * answers that page with {@link CARD_RETURN_PREFIX}, which ends the in-app browser session — the
 * pledge payment return's mechanism (`features/checkout/payment.ts`), not a universal link.
 */
export function cardReturnFor(language: string, site: string = siteUrl()): CardRegistrationRequest {
  const page = `${site.replace(/\/+$/, '')}/${language}/settings/payout`;
  return {
    language,
    successUrl: `${page}?card=returned&via=app`,
    errorUrl: `${page}?card=failed&via=app`,
  };
}

export function readCardHint(value: unknown): CardReturnHint | null {
  return value === 'returned' || value === 'failed' ? value : null;
}

export function cardHintOf(url: string): CardReturnHint | null {
  const query = url.includes('?') ? (url.slice(url.indexOf('?') + 1).split('#')[0] ?? '') : '';
  return readCardHint(new URLSearchParams(query).get('card'));
}

export type CardSessionOutcome =
  | { readonly kind: 'returned'; readonly hint: CardReturnHint }
  | { readonly kind: 'dismissed' };

/** Opens the provider's page in the in-app browser. The card number is entered there, never here. */
export async function openCardRegistration(redirectUrl: string): Promise<CardSessionOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(redirectUrl, CARD_RETURN_PREFIX);
  if (result.type === 'success') return { kind: 'returned', hint: cardHintOf(result.url) ?? 'returned' };
  return { kind: 'dismissed' };
}

/**
 * Re-reads every {@link CHECK_INTERVAL_MS} while `settling` and `active`, at most {@link CHECKS}
 * times per `epoch`, and returns how many checks have run. The timer is cleared on unmount.
 */
export function useCardSettling(settling: boolean, active: boolean, reread: () => unknown, epoch: number): number {
  const [count, setCount] = useState({ epoch, checks: 0 });
  const checks = count.epoch === epoch ? count.checks : 0;
  const latest = useRef(reread);
  latest.current = reread;

  useEffect(() => {
    if (!settling || !active || checks >= CHECKS) return;
    const timer = setTimeout(() => {
      setCount((current) => ({ epoch, checks: (current.epoch === epoch ? current.checks : 0) + 1 }));
      void latest.current();
    }, CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [settling, active, checks, epoch]);

  return checks;
}
