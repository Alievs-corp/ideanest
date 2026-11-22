/**
 * The periods a plan is sold for, and the refusals of a choice — #655.
 *
 * <h2>A module of its own so that it imports nothing</h2>
 *
 * `./catalogue` imports `decimal.js` at its top for `readPlan` and `isFreePrice`, and a bundler
 * will not drop it: importing `priceFor` from there cost the web pricing page 35 KiB of first-load
 * JavaScript. These rules compare strings and look things up, so they live here, and `./catalogue`
 * re-exports them for every caller that already imports them from there. `./choice` and
 * `./payment` are the same arrangement for the same reason.
 */

/** One month, six months or a year. Every plan may be sold for any of them (`Plan.prices`). */
export type BillingPeriod = 'MONTHLY' | 'SEMIANNUAL' | 'YEARLY';

/** What one period of a plan costs. A decimal amount, as text, in the plan's currency. */
export interface PlanPrice {
  readonly billingPeriod: BillingPeriod;
  readonly price: string;
  readonly currency: string;
}

/** Shortest first — the order the period switch draws them in. */
export const BILLING_PERIODS: readonly BillingPeriod[] = ['MONTHLY', 'SEMIANNUAL', 'YEARLY'];

/** How many months a period runs. For "per month" comparisons; never for computing a charge. */
export const MONTHS_IN: Readonly<Record<BillingPeriod, number>> = { MONTHLY: 1, SEMIANNUAL: 6, YEARLY: 12 };

/** Whether a value is one of the three periods. */
export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return typeof value === 'string' && (BILLING_PERIODS as readonly string[]).includes(value);
}

/** The one thing these rules read off a plan, so this module needs nothing from `./catalogue`. */
interface Priced {
  readonly prices: readonly PlanPrice[];
}

/** What `period` of this plan costs, or `null` when the plan is not sold for it. */
export function priceFor(plan: Priced, period: BillingPeriod): PlanPrice | null {
  return plan.prices.find((entry) => entry.billingPeriod === period) ?? null;
}

/** Whether any plan in the catalogue is sold for `period` — a switch position nobody can buy is not drawn. */
export function offeredPeriods(plans: readonly Priced[]): readonly BillingPeriod[] {
  return BILLING_PERIODS.filter((period) => plans.some((plan) => priceFor(plan, period) !== null));
}

/**
 * Whether a decimal amount, as text, is zero — `"0"`, `"0.00"`, `"-0.0"`. Without `decimal.js`:
 * a string the service sends as money is digits with at most one point, and that is all this
 * reads. Anything else is not zero, which is the answer that keeps a price on the card.
 */
export function isZeroAmount(amount: string): boolean {
  return /^[-+]?0*(\.0*)?$/.test(amount.trim()) && /\d/.test(amount);
}

/**
 * A decimal amount, as text, in one spelling: `"060.50"`, `"60.5"` and `"60.500"` are all `"60.5"`;
 * `"60.00"` and `"60"` are `"60"`. `null` for text that is not a plain decimal. Without
 * `decimal.js`, for the screens that only need to know whether two amounts are the same one.
 */
export function canonicalAmount(amount: string): string | null {
  const match = /^([-+]?)(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (match === null) return null;
  const [, sign = '', whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;
  const integer = whole.replace(/^0+(?=\d)/u, '') || '0';
  const decimals = fraction.replace(/0+$/u, '');
  const body = decimals === '' ? integer : `${integer}.${decimals}`;
  return body === '0' ? '0' : `${sign === '-' ? '-' : ''}${body}`;
}

/** Whether two decimal amounts, as text, are the same amount. */
export function sameAmount(left: string, right: string): boolean {
  const one = canonicalAmount(left);
  return one !== null && one === canonicalAmount(right);
}

/** A refused choice or cancellation, as the catalogue key under `pricing.errors` that says it. */
export type SubscriptionRefusal =
  | 'alreadySubscribed'
  | 'notOnSale'
  | 'periodNotOffered'
  | 'studentVerificationRequired'
  | 'signedOut'
  | 'generic';

/**
 * The refusal's sentence, from the problem's `code` and the status — never from its prose, which
 * is in one language while the page is drawn in four (§10.4).
 */
export function refusalOf(status: number | null, code: string | null | undefined): SubscriptionRefusal {
  if (code === 'ALREADY_SUBSCRIBED') return 'alreadySubscribed';
  if (code === 'PLAN_NOT_ON_SALE') return 'notOnSale';
  if (code === 'PERIOD_NOT_OFFERED') return 'periodNotOffered';
  if (code === 'STUDENT_VERIFICATION_REQUIRED') return 'studentVerificationRequired';
  if (status === 401) return 'signedOut';
  return 'generic';
}
