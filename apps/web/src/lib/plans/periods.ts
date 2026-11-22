import type {
  BillingPeriod,
  Plan,
  PlanPrice,
  SubscriptionRefusal,
} from '@ideanest/plans/catalogue';

/**
 * `@ideanest/plans/catalogue`'s period and refusal rules, without `decimal.js` — issue #655.
 *
 * <p>`priceFor`, `offeredPeriods` and `refusalOf` are the contract's, and these say exactly what
 * those say. They are restated here because `catalogue.ts` imports `decimal.js` for
 * `readPlan`/`isFreePrice`, and importing anything from it into the pricing page's client bundle
 * cost `/pricing` 35 KiB of First Load JS that the bundler did not shake out. `choice.ts` is the
 * package's own answer to the same problem (`canChoose` lives apart for this reason); these three
 * belong beside it, and this file goes when they move there. `periods.test.ts` holds the two
 * copies to the same answers.
 */

/** Shortest first — the order the period switch draws them in. */
export const BILLING_PERIODS: readonly BillingPeriod[] = ['MONTHLY', 'SEMIANNUAL', 'YEARLY'];

/** What `period` of this plan costs, or `null` when the plan is not sold for it. */
export function priceFor(plan: Plan, period: BillingPeriod): PlanPrice | null {
  return plan.prices.find((entry) => entry.billingPeriod === period) ?? null;
}

/** The periods some plan in the catalogue is sold for: a switch position nobody can buy is not drawn. */
export function offeredPeriods(plans: readonly Plan[]): readonly BillingPeriod[] {
  return BILLING_PERIODS.filter((period) => plans.some((plan) => priceFor(plan, period) !== null));
}

/** A refused choice, as the catalogue key under `pricing.errors` that says it — by `code`, never prose. */
export function refusalOf(status: number | null, code: string | null | undefined): SubscriptionRefusal {
  if (code === 'ALREADY_SUBSCRIBED') return 'alreadySubscribed';
  if (code === 'PLAN_NOT_ON_SALE') return 'notOnSale';
  if (code === 'PERIOD_NOT_OFFERED') return 'periodNotOffered';
  if (code === 'STUDENT_VERIFICATION_REQUIRED') return 'studentVerificationRequired';
  if (status === 401) return 'signedOut';
  return 'generic';
}

/**
 * A plan with the two fields #655 added, whatever the service sent.
 *
 * <p>Not `readPlan` from `@ideanest/plans/catalogue`, which brings `decimal.js` with it. A plan from
 * a service that predates the periods is sold for the one period `price` and `billingPeriod`
 * describe, and is not a student plan — which is what the shared reader concludes too.
 */
export function withPeriods(plan: Plan): Plan {
  const prices =
    Array.isArray(plan.prices) && plan.prices.length > 0
      ? plan.prices
      : [{ billingPeriod: plan.billingPeriod, price: plan.price, currency: plan.currency }];
  return { ...plan, prices, studentOnly: plan.studentOnly === true };
}
