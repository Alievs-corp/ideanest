import type { HeldSubscription } from './catalogue';

/**
 * Paying for a plan by card and coming back from it — #449, #451.
 *
 * <h2>A module of its own so that it imports nothing</h2>
 *
 * `./catalogue` imports `decimal.js` at its top for `isFreePrice`, and a bundler will not drop it.
 * The web pricing page otherwise reads only types from there, so putting these two rules beside
 * them would have added the whole library to a route with a first-load budget for the sake of
 * two string comparisons. Nothing here does arithmetic.
 */

/**
 * A refused plan payment (#449), as the catalogue key under `pricing.errors` that says it.
 *
 * <p>`SUBSCRIPTION_PAYMENT_NOT_DUE` carries a `reason`, and each one asks the reader for something
 * different: nothing at all for a free plan, patience until the window opens, a new purchase for a
 * plan that has ended. `PAYMENT_UNAVAILABLE` is the provider out of reach — ours to fix, theirs to
 * retry, and nothing was charged.
 */
export type PlanPaymentRefusal =
  | 'freePlan'
  | 'renewalNotOpen'
  | 'lapsed'
  | 'notDue'
  | 'paymentUnavailable'
  | 'signedOut'
  | 'generic';

export function planPaymentRefusalOf(
  status: number | null,
  code: string | null | undefined,
  reason: unknown,
): PlanPaymentRefusal {
  if (code === 'SUBSCRIPTION_PAYMENT_NOT_DUE') {
    if (reason === 'FREE_PLAN') return 'freePlan';
    if (reason === 'RENEWAL_NOT_OPEN') return 'renewalNotOpen';
    if (reason === 'LAPSED') return 'lapsed';
    return 'notDue';
  }
  if (code === 'PAYMENT_UNAVAILABLE' || status === 503) return 'paymentUnavailable';
  if (status === 401) return 'signedOut';
  return 'generic';
}

/** What the provider's return address may say: `?payment=returned` or `?payment=failed`. */
export type PlanPaymentReturnHint = 'returned' | 'failed';

/**
 * What to tell somebody who has just come back from paying for a plan.
 *
 * <ul>
 *   <li>`paid` — the plan entitles them and nothing is due any more: the first period opened, or
 *       the renewal moved the end out of the window.</li>
 *   <li>`waiting` — back through the success door and the same payment is still due. The
 *       provider's callback is asynchronous and can land after the browser, so the page asks
 *       again.</li>
 *   <li>`unconfirmed` — still due after the page stopped asking. Not `failed`: the money may have
 *       left their account and the callback may still arrive.</li>
 *   <li>`failed` — back through the error door and the payment is still due.</li>
 * </ul>
 *
 * <p>The subscription decides, not the word in the address, as a pledge's state does on the
 * pledge page: the word only says that somebody has just come back. `null` when there is nothing
 * to add — no subscription, or one that has lapsed, about which the held panel already speaks.
 */
export type PlanPaymentReturn = 'paid' | 'waiting' | 'unconfirmed' | 'failed';

export function planPaymentReturnOf(
  hint: PlanPaymentReturnHint,
  held: HeldSubscription | null,
  stoppedAsking: boolean,
): PlanPaymentReturn | null {
  if (held === null) return null;
  if ((held.paymentDue ?? null) === null) return held.entitled ? 'paid' : null;
  if (hint === 'failed') return 'failed';
  return stoppedAsking ? 'unconfirmed' : 'waiting';
}
