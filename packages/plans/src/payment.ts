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
 * retry, and nothing was charged. `STUDENT_VERIFICATION_REQUIRED` is a student plan whose renewal or
 * first period is refused because the student approval has lapsed or was revoked (#655): the
 * reader sends their card again, and nothing was charged.
 */
export type PlanPaymentRefusal =
  | 'freePlan'
  | 'renewalNotOpen'
  | 'lapsed'
  | 'notDue'
  | 'paymentUnavailable'
  | 'studentVerificationRequired'
  | 'periodNotOffered'
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
  if (code === 'STUDENT_VERIFICATION_REQUIRED') return 'studentVerificationRequired';
  if (code === 'PERIOD_NOT_OFFERED') return 'periodNotOffered';
  if (code === 'PAYMENT_UNAVAILABLE' || status === 503) return 'paymentUnavailable';
  if (status === 401) return 'signedOut';
  return 'generic';
}

/** What the provider's return address may say: `?payment=returned` or `?payment=failed`. */
export type PlanPaymentReturnHint = 'returned' | 'failed';

/**
 * What was held when the creator left for the provider (#660): the subscription, its state and the
 * end of its period, read from the service on the page they left from.
 *
 * <p>With a renewal window of a month, a monthly plan has a renewal due from the moment its first
 * period is paid, and an extension leaves the next one due straight away; so "nothing is due any
 * more" no longer says a payment went through. What changed since leaving does: the plan left
 * `PENDING_PAYMENT`, or its end moved past the one remembered. The remembered values only say what
 * to compare against; the claim that something was paid is still the service's data.
 */
export interface PlanPaymentDeparture {
  readonly subscriptionId: string;
  readonly state: HeldSubscription['state'];
  readonly currentPeriodEnd: string | null;
}

/** What to remember of `held` before leaving to pay for it. */
export function planPaymentDepartureOf(held: HeldSubscription): PlanPaymentDeparture {
  return { subscriptionId: held.id, state: held.state, currentPeriodEnd: held.currentPeriodEnd ?? null };
}

/** Reads a remembered departure back, or `null` for anything that is not one. */
export function readPlanPaymentDeparture(value: unknown): PlanPaymentDeparture | null {
  if (typeof value !== 'object' || value === null) return null;
  const { subscriptionId, state, currentPeriodEnd } = value as Record<string, unknown>;
  if (typeof subscriptionId !== 'string' || typeof state !== 'string') return null;
  if (currentPeriodEnd !== null && typeof currentPeriodEnd !== 'string') return null;
  return { subscriptionId, state: state as HeldSubscription['state'], currentPeriodEnd };
}

/**
 * What to tell somebody who has just come back from paying for a plan.
 *
 * <ul>
 *   <li>`paid` — the plan entitles them and the payment shows: the first period opened, or the end
 *       moved (#660). Without a remembered departure — another tab, storage refused — the older rule
 *       stands: entitled with nothing due.</li>
 *   <li>`waiting` — back through the success door and nothing has changed yet. The provider's
 *       callback is asynchronous and can land after the browser, so the page asks again.</li>
 *   <li>`unconfirmed` — still unchanged after the page stopped asking. Not `failed`: the money may
 *       have left their account and the callback may still arrive.</li>
 *   <li>`failed` — back through the error door and nothing has changed.</li>
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
  departure: PlanPaymentDeparture | null = null,
): PlanPaymentReturn | null {
  if (held === null) return null;
  const left = departure !== null && departure.subscriptionId === held.id ? departure : null;
  if (left === null) {
    if ((held.paymentDue ?? null) === null) return held.entitled ? 'paid' : null;
  } else {
    if (held.entitled && paidSince(left, held)) return 'paid';
    if (!held.entitled && held.state !== 'PENDING_PAYMENT') return null;
  }
  if (hint === 'failed') return 'failed';
  return stoppedAsking ? 'unconfirmed' : 'waiting';
}

/** Whether the subscription shows a payment since `left`: out of `PENDING_PAYMENT`, or a later end. */
function paidSince(left: PlanPaymentDeparture, held: HeldSubscription): boolean {
  if (left.state === 'PENDING_PAYMENT') return held.state !== 'PENDING_PAYMENT';
  const before = left.currentPeriodEnd === null ? Number.NaN : Date.parse(left.currentPeriodEnd);
  const now = held.currentPeriodEnd == null ? Number.NaN : Date.parse(held.currentPeriodEnd);
  return Number.isFinite(before) && Number.isFinite(now) && now > before;
}

/** How close to its end a renewal becomes something to act on rather than an option (#660). */
export const RENEWAL_URGENT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where a held plan stands against its renewal (#660).
 *
 * <ul>
 *   <li>`none` — nothing to renew now: pending, lapsed, free, or the window is not open.</li>
 *   <li>`early` — the window is open (the last calendar month) and the end is more than seven days
 *       away: the plan is simply active, and extending it is an option offered calmly.</li>
 *   <li>`urgent` — seven days or fewer left: the plan ends soon, said as a warning.</li>
 * </ul>
 *
 * <p>A monthly plan has a renewal due for its whole month, so "due" alone cannot be the warning.
 */
export type RenewalStanding = 'none' | 'early' | 'urgent';

export function renewalStandingOf(held: HeldSubscription, now: number = Date.now()): RenewalStanding {
  if (held.paymentDue !== 'RENEWAL' || !held.entitled) return 'none';
  const end = held.currentPeriodEnd == null ? Number.NaN : Date.parse(held.currentPeriodEnd);
  return Number.isFinite(end) && end - now > RENEWAL_URGENT_MS ? 'early' : 'urgent';
}
