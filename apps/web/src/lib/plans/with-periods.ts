import type { Plan } from '@ideanest/plans/catalogue';

/**
 * A plan with the two fields #655 added, whatever the service sent.
 *
 * <p>For the reads that cast rather than narrow — the held subscription and the console's plan
 * list — where `readPlan` from `@ideanest/plans/catalogue` would bring `decimal.js` into a client
 * bundle. A plan from a service that predates the periods is sold for the one period `price` and
 * `billingPeriod` describe, and is not a student plan — which is what the shared reader concludes
 * too, and `with-periods.test.ts` holds the two to the same answer.
 */
export function withPeriods(plan: Plan): Plan {
  const prices =
    Array.isArray(plan.prices) && plan.prices.length > 0
      ? plan.prices
      : [{ billingPeriod: plan.billingPeriod, price: plan.price, currency: plan.currency }];
  return { ...plan, prices, studentOnly: plan.studentOnly === true };
}
