import { BILLING_PERIODS, MONTHS_IN, isBillingPeriod } from '@ideanest/plans/periods';
import type { BillingPeriod, HeldSubscription, PlanPrice } from '@ideanest/plans/catalogue';

/**
 * Extending a running subscription — #660.
 *
 * <p>Inside the renewal window (the last calendar month of a period) the service lists what extending
 * by each period costs now in `renewalPrices`: the held period at the price this account bought at,
 * another period at the plan's current price for it. The pricing page offers exactly those, and
 * sends the one chosen as `billingPeriod` with the payment.
 *
 * <p>Nothing here does arithmetic with money: a price is a string the page formats. The only sum is
 * a date, and `decimal.js` stays out of the pricing route (`@ideanest/plans/periods` explains why).
 */

/**
 * The periods this subscription can be extended by now, shortest first, one per period.
 *
 * <p>Empty unless a renewal is due and the plan still entitles — the same condition the panel's
 * renew button has — and empty for a service that predates #660 and sends no list, which leaves the
 * panel renewing the held period at the held price as before. An entry naming no known period or
 * no price is dropped rather than drawn.
 */
export function extensionChoices(held: HeldSubscription): readonly PlanPrice[] {
  if (held.paymentDue !== 'RENEWAL' || !held.entitled) return [];
  const listed = Array.isArray(held.renewalPrices) ? held.renewalPrices : [];
  const byPeriod = new Map<BillingPeriod, PlanPrice>();
  for (const entry of listed) {
    if (!isBillingPeriod(entry?.billingPeriod) || typeof entry.price !== 'string' || entry.price === '') continue;
    byPeriod.set(entry.billingPeriod, {
      billingPeriod: entry.billingPeriod,
      price: entry.price,
      currency: typeof entry.currency === 'string' && entry.currency !== '' ? entry.currency : held.currency,
    });
  }
  return BILLING_PERIODS.flatMap((period) => {
    const found = byPeriod.get(period);
    return found === undefined ? [] : [found];
  });
}

/**
 * The option the panel shows selected: the reader's pick while it is offered, else the period they
 * hold, else the shortest offered. `null` when there is nothing to choose from.
 */
export function extensionShown(
  choices: readonly PlanPrice[],
  chosen: BillingPeriod | null,
  held: BillingPeriod,
): PlanPrice | null {
  return (
    choices.find((choice) => choice.billingPeriod === chosen) ??
    choices.find((choice) => choice.billingPeriod === held) ??
    choices[0] ??
    null
  );
}

/**
 * When the subscription would end after extending it by `period` — the service's own arithmetic.
 *
 * <p>`BillingPeriod.endOf` on the service: the current end in UTC, plus whole calendar months, with
 * the day clamped to the last day of a shorter month (31 January plus one month is 28 or 29
 * February), as `java.time` does. From the current end and not from today, because inside the window
 * the period is still running: extending early costs the creator no days. `null` for an end that is
 * missing or not a date.
 */
export function extendedEnd(currentEnd: string | null | undefined, period: BillingPeriod): string | null {
  if (currentEnd == null) return null;
  const end = new Date(currentEnd);
  if (Number.isNaN(end.getTime())) return null;

  const months = end.getUTCMonth() + MONTHS_IN[period];
  const year = end.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const moved = new Date(end.getTime());
  moved.setUTCFullYear(year, month, Math.min(end.getUTCDate(), lastDay));
  return moved.toISOString();
}
