import { localeOrDefault, type Locale } from '../i18n/locale';

/**
 * Leaving for the payment provider's page and coming back — IDN-EXT-01 (#44).
 *
 * <h2>Where the provider sends the backer back</h2>
 *
 * To the pledge's own page, in the language the checkout was read in, with `?payment=` saying
 * which door they came through: `returned` when the provider reports the payment finished and
 * `failed` when it reports it did not. That word is a hint and not a fact — the provider's
 * webhook is what settles the pledge, and it can arrive before or after the browser does — so
 * the pledge page decides what to say from the pledge's state and uses the word only to know
 * that somebody has just come back from paying.
 *
 * Absolute URLs, because the provider redirects from its own domain. `localePrefix` is
 * `always` in `i18n/routing.ts`, so the first path segment of the checkout is its locale.
 */
export interface PaymentReturn {
  readonly language: Locale;
  readonly successUrl: string;
  readonly errorUrl: string;
}

export function paymentReturnFor(pledgeId: string, location: Pick<Location, 'origin' | 'pathname'> = window.location): PaymentReturn {
  const language = localeOrDefault(location.pathname.split('/')[1]);
  const page = `${location.origin}/${language}/pledges/${encodeURIComponent(pledgeId)}`;
  return {
    language,
    successUrl: `${page}?payment=returned`,
    errorUrl: `${page}?payment=failed`,
  };
}

/** What `?payment=` may say. Anything else is not a return from the payment page. */
export type PaymentReturnHint = 'returned' | 'failed';

export function paymentReturnHint(search: string): PaymentReturnHint | null {
  const value = new URLSearchParams(search).get('payment');
  return value === 'returned' || value === 'failed' ? value : null;
}

/**
 * Sends the browser to the provider's page.
 *
 * A function of its own so a test can observe the navigation instead of attempting it: jsdom
 * implements no navigation, and a checkout test that silently failed to leave would pass for
 * the wrong reason.
 */
export function leaveForPaymentPage(url: string): void {
  window.location.assign(url);
}
