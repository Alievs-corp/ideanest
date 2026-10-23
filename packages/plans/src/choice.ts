/**
 * Kept apart from `catalogue` so a page that only needs this does not load `decimal.js` with it.
 */
import type { HeldSubscription } from './catalogue';

/**
 * Whether this plan's card may be chosen. The service refuses only an entitling plan and the same
 * plan again while it waits for payment (`ALREADY_SUBSCRIBED`), and a button that is certain to be
 * refused is not offered. A different plan replaces an unpaid choice, and a lapsed one is retired.
 */
export function canChoose(held: HeldSubscription | null, planId: string): boolean {
  if (held === null || held.state === 'CANCELED') return true;
  if (held.state === 'PENDING_PAYMENT') return held.plan.id !== planId;
  return !held.entitled;
}
