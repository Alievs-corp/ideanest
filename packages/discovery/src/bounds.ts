import Decimal from 'decimal.js';
import { parseAmount } from '@ideanest/money';

/**
 * The custom money range, checked before it is applied.
 *
 * A FILTER BOUND IS MONEY. It is compared against `goal_amount` and
 * `pledged_amount` server-side, and the binder reads it with `BigDecimal` for
 * exactly the reason CLAUDE.md §3 gives: `Double.parseDouble` puts a campaign
 * whose goal is exactly 5,000 on the wrong side of a boundary it sits on. So
 * nothing here goes near `Number()` or `parseFloat` either — `parseAmount`
 * refuses `1e5`, `0x10`, `12abc` and `Infinity`, all of which `Number()`
 * silently accepts, and the comparison below is `Decimal`.
 *
 * ZERO IS ALLOWED, unlike a goal or a reward price. "Raised up to 0" is a
 * legitimate question — it asks for the campaigns nobody has backed yet — and
 * `AmountBand.UNDER_1000` starts at zero for the same reason.
 *
 * The checks exist to stop a request the service would answer with
 * `400 DISCOVERY_VALUE_UNKNOWN`. They are not a second opinion about what the
 * bounds mean: `goalMin=5000&goalMax=1000` is refused by the service and is
 * refused here first, with a sentence rather than an error page.
 */

/** True when this is an amount the API will accept. Blank is not a bound. */
export function isValidBound(value: string | null): boolean {
  if (value === null || value.trim() === '') return true;
  return parseAmount(value, { allowZero: true }).ok;
}

/**
 * True when a minimum does not exceed its maximum.
 *
 * Compared as decimals, never as numbers: `'9.99'` and `'10'` order correctly
 * as strings only by accident, and `'100'` sorts below `'99'`.
 */
export function boundsAreOrdered(min: string | null, max: string | null): boolean {
  if (min === null || max === null || min.trim() === '' || max.trim() === '') return true;

  const low = parseAmount(min, { allowZero: true });
  const high = parseAmount(max, { allowZero: true });
  if (!low.ok || !high.ok) return true; // A malformed bound is a different complaint.

  return new Decimal(low.value).lessThanOrEqualTo(high.value);
}
