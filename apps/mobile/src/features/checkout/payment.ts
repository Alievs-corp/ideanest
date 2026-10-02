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
export function paymentReturnFor(pledgeId: string, language: string, site: string = siteUrl()): PaymentReturn {
  const page = `${site.replace(/\/+$/, '')}/${language}/pledges/${encodeURIComponent(pledgeId)}`;
  return {
    language,
    successUrl: `${page}?payment=returned&via=app`,
    errorUrl: `${page}?payment=failed&via=app`,
  };
}

export function appReturnPrefix(pledgeId: string): string {
  return `ideanest://pledges/${encodeURIComponent(pledgeId)}`;
}

export function returnHintOf(url: string): PaymentReturnHint | null {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] ?? '' : '';
  const value = new URLSearchParams(query).get('payment');
  return value === 'returned' || value === 'failed' ? value : null;
}

export type PaymentSessionOutcome =
  | { readonly kind: 'returned'; readonly hint: PaymentReturnHint }
  | { readonly kind: 'dismissed' };

export async function openPaymentPage(redirectUrl: string, pledgeId: string): Promise<PaymentSessionOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(redirectUrl, appReturnPrefix(pledgeId));
  if (result.type === 'success') {
    return { kind: 'returned', hint: returnHintOf(result.url) ?? 'returned' };
  }
  return { kind: 'dismissed' };
}
