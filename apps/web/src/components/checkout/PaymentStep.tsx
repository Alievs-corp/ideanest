'use client';

import { InlineAlert } from '@ideanest/ui';
import type { CheckoutCopy } from '../../lib/i18n/checkout-copy';

/**
 * PL-07 and PL-08, as IDN-EXT-01 built them (#39, #44).
 *
 * <h2>There is still no card form here, and there never will be</h2>
 *
 * The pledge is charged on the payment provider's own page. Continuing from the review step
 * asks the service to open that page (`POST /v1/pledges/{id}/payment`) and sends the browser
 * to it; the card is entered there, 3-D Secure happens there, and the provider tells the
 * service the outcome by webhook. Nothing about the card ever reaches this application, which
 * is what keeps §17.2's assessment at SAQ A — and a field here that looked as though it took a
 * card would teach somebody that this is where a card goes on this site, which is the lesson a
 * phishing page relies on.
 *
 * <h2>What the step says</h2>
 *
 * Where the payment happens, that it happens once, and what happens to the money if the
 * campaign does not succeed. `info`, not `warning`: nothing is wrong, and docs/ui-kit.md §7.15
 * keeps `role="alert"` for the variants that must interrupt.
 */
export interface PaymentStepProps {
  /**
   * The words this control draws, resolved on the server and handed down by `CheckoutView`.
   * `lib/i18n/checkout-copy.ts` explains why the checkout's copy travels as a prop.
   */
  copy: CheckoutCopy['payment'];
}

export function PaymentStep({ copy }: PaymentStepProps) {
  return (
    <section aria-labelledby="checkout-payment" className="flex flex-col gap-3">
      <h3 id="checkout-payment" className="text-sm font-medium text-white">
        {copy.heading}
      </h3>

      <InlineAlert variant="info" title={copy.none}>
        <p>{copy.body}</p>
        <p className="mt-2">{copy.later}</p>
      </InlineAlert>
    </section>
  );
}
