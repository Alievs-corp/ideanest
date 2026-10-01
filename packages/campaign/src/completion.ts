import Decimal from 'decimal.js';
import type { Money } from '@ideanest/money';

/**
 * `pledged / goal × 100`, to two places, rounded down.
 *
 * Rounded DOWN, deliberately and to match the service's own `completionPercent`: a campaign at
 * 99.996% must not be reported as 100%, because 100% is the word "funded" on this platform and
 * it would be a claim about somebody's money.
 *
 * A goal of zero is `null` rather than infinity. §5.3 does not permit one, and a page that
 * divided by it would render `Infinity%`.
 *
 * <h2>Why this is a module of its own</h2>
 *
 * It lived in `publicPage.ts` until #91, which needed it in a client component: the live counter
 * adds a delta to the pledged total and has to recompute the percentage beside it, or the two
 * numbers disagree on the same page.
 *
 * Importing it from `publicPage.ts` worked and cost 86 KiB. **A client component pulls its
 * whole import graph into the browser bundle**, and that module reasonably imports the campaign
 * page's response types, its reward projections and the readers for all of them — none of which
 * a percentage needs. The campaign page is the platform's most performance-sensitive route and
 * `performance/budgets.json` is what noticed.
 *
 * So the function moved to a leaf whose only dependencies are `decimal.js` and a type. It is the
 * same function with the same rounding rule, imported by both sides, which is the property that
 * mattered: two implementations of "what percent funded" is how a card and a page come to
 * disagree by one point.
 *
 * <p>It moved into `@ideanest/campaign` with #155, still a leaf, so the app's live counter
 * recomputes the percent with the same rule as the browser's.
 */
export function completionOf(pledged: Money, goal: Money | null): Decimal | null {
  if (goal === null) return null;

  try {
    const target = new Decimal(goal.amount);
    if (target.lessThanOrEqualTo(0)) return null;

    return new Decimal(pledged.amount).dividedBy(target).times(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  } catch {
    // A malformed amount is a page without a progress bar, not a page that throws. The amounts
    // come from the service and cannot be malformed today; the branch is what keeps a future
    // one from taking the route down.
    return null;
  }
}
