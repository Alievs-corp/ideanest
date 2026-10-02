import * as WebBrowser from 'expo-web-browser';
import { siteUrl } from '../../api/config';

export type PaymentReturnHint = 'returned' | 'failed';

export interface PaymentReturn {
  readonly language: string;
  readonly successUrl: string;
  readonly errorUrl: string;
}

/**
 * The provider returns to the site (custom schemes are refused by the API, docs/architecture.md
 * §9.4); `via=app` makes that page forward to {@link appReturnPrefix}, which ends the auth session.
 */
export type ReturnParam = 'payment' | 'raise';

export function paymentReturnFor(
  pledgeId: string,
  language: string,
  site: string = siteUrl(),
  param: ReturnParam = 'payment',
): PaymentReturn {
  const page = `${site.replace(/\/+$/, '')}/${language}/pledges/${encodeURIComponent(pledgeId)}`;
  return {
    language,
    successUrl: `${page}?${param}=returned&via=app`,
    errorUrl: `${page}?${param}=failed&via=app`,
  };
}

export function raiseReturnFor(pledgeId: string, language: string, site: string = siteUrl()): PaymentReturn {
  return paymentReturnFor(pledgeId, language, site, 'raise');
}

export function appReturnPrefix(pledgeId: string): string {
  return `ideanest://pledges/${encodeURIComponent(pledgeId)}`;
}

export function returnHintOf(url: string, param: ReturnParam = 'payment'): PaymentReturnHint | null {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] ?? '' : '';
  const value = new URLSearchParams(query).get(param);
  return value === 'returned' || value === 'failed' ? value : null;
}

export type PaymentSessionOutcome =
  | { readonly kind: 'returned'; readonly hint: PaymentReturnHint }
  | { readonly kind: 'dismissed' };

export async function openPaymentPage(
  redirectUrl: string,
  pledgeId: string,
  param: ReturnParam = 'payment',
): Promise<PaymentSessionOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(redirectUrl, appReturnPrefix(pledgeId));
  if (result.type === 'success') {
    return { kind: 'returned', hint: returnHintOf(result.url, param) ?? 'returned' };
  }
  return { kind: 'dismissed' };
}
