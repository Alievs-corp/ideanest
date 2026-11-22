import {
  planPaymentDepartureOf,
  readPlanPaymentDeparture,
  type PlanPaymentDeparture,
} from '@ideanest/plans/payment';
import type { HeldSubscription } from '@ideanest/plans/catalogue';

/**
 * What was held when the creator left for the provider, kept across the trip — #660.
 *
 * <p>`sessionStorage`, not the return address: it survives the provider's redirect in the same tab,
 * and nobody can hand somebody a link that makes the page compare against the wrong end. It only
 * says what to compare against — whether anything was paid is still read from the service
 * (`planPaymentReturnOf`). Storage that is refused or empty (another tab, a private window) leaves
 * the page on the older rule, which is right for everything but a monthly plan.
 */
const KEY = 'ideanest.plan-payment-departure';

export function rememberDeparture(held: HeldSubscription | null): void {
  if (held === null) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(planPaymentDepartureOf(held)));
  } catch {
    // Storage refused: the older rule decides on the way back.
  }
}

export function recallDeparture(): PlanPaymentDeparture | null {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    return stored === null ? null : readPlanPaymentDeparture(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** Once the return has an answer, so a later visit to the same address is not compared against it. */
export function forgetDeparture(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
