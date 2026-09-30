/**
 * The part of the money module that only prints an amount, and needs no arithmetic.
 *
 * <p>Split out of `index.ts` so that a screen which formats an amount it was handed, such as the
 * console's front page, can import `@ideanest/money/format` and stay free of `decimal.js`, which
 * `index.ts` imports at its top and which a bundler will not drop. `index.ts` re-exports both
 * names, so nothing that imports the module as a whole changes.
 *
 * <p>This file imports nothing, and a test says so: the day it does, the reason it exists is gone.
 */

/** Digits after the point. `numeric(14,2)` on the server side. */
export const MONEY_SCALE = 2;

/**
 * An amount as a reader sees it: grouped, at the scale the column holds, with
 * its currency after it.
 *
 * FORMATTED FROM THE DIGITS, NOT FROM A NUMBER. `Intl.NumberFormat` takes a
 * `number`, and putting `999999999999.99` through one loses the last digit
 * before any formatting happens — which is the entire reason this module
 * refuses to parse with `Number()` in the first place. So the grouping is done
 * on the integer digits as a string and the fraction is copied across
 * untouched.
 *
 * Grouping in threes with a comma, and the code after the amount rather than a
 * symbol before it. There is no agreed symbol for the manat in either of the
 * two languages the product ships in (docs/architecture.md §21.1), and
 * `Intl`'s own answer differs by locale — so the ISO code, which is the same
 * string the API sent, is what is shown. Consumers that render this into a
 * table cell get a pre-formatted string, which is what docs/ui-kit.md §7.15
 * asks for: a table that formats is a table that rounds.
 */
export function formatMoney(
  money: { readonly amount: string; readonly currency: string } | null | undefined,
): string {
  if (money == null) return '';

  const [whole = '', fraction] = money.amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const scaled = (fraction ?? '').padEnd(MONEY_SCALE, '0').slice(0, MONEY_SCALE);

  return `${grouped}.${scaled} ${money.currency}`.trim();
}
