import Decimal from 'decimal.js';
import type { Money } from '../money';

/**
 * §5.1's success threshold — IDN-EXT-01 (#44).
 *
 * <p>80% of the goal. The service reads it from `ideanest.project.success-threshold` and the
 * product owner fixed it at 0.80 in edition 6; this is the same figure written down for the
 * sentences that state it, not a second decision. It is never used to decide an outcome — the
 * campaign's state does that — only to name the amount a campaign must raise.
 */
export const SUCCESS_THRESHOLD = new Decimal('0.80');

/**
 * The amount a campaign must raise to succeed, rounded UP to the cent.
 *
 * Up rather than half-even, because the service succeeds a campaign whose pledged amount is at
 * least goal × 0.80: a figure rounded down would name an amount a cent short of success.
 */
export function successThresholdOf(goal: Money): Money {
  return {
    amount: new Decimal(goal.amount).times(SUCCESS_THRESHOLD).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2),
    currency: goal.currency,
  };
}
