/**
 * Kept apart from `catalogue` so a page that only needs this does not load `decimal.js` with it.
 */
import type { BillingPeriod, HeldSubscription } from './catalogue';

/**
 * Whether this plan's card may be chosen. The service refuses only an entitling plan and the same
 * plan again while it waits for payment (`ALREADY_SUBSCRIBED`), and a button that is certain to be
 * refused is not offered. A different plan — or the same plan for a different period — replaces an
 * unpaid choice, and a lapsed one is retired.
 *
 * @param period the period the card is offering. Omitted, any period of the held plan counts as
 *     the same choice
 */
export function canChoose(held: HeldSubscription | null, planId: string, period?: BillingPeriod): boolean {
  if (held === null || held.state === 'CANCELED') return true;
  if (held.state === 'PENDING_PAYMENT') {
    return held.plan.id !== planId || (period !== undefined && held.billingPeriod !== period);
  }
  return !held.entitled;
}
