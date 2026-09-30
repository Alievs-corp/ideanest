import Decimal from 'decimal.js';
import { MONEY_SCALE, formatMoney } from './format';

/*
 * `formatMoney` and `MONEY_SCALE` live in `./format`, which imports nothing, so that a screen that
 * only has to print an amount can import `@ideanest/money/format` without dragging `decimal.js`
 * into its bundle. They are re-exported here, so every existing import of this module is unchanged.
 */
export { MONEY_SCALE, formatMoney } from './format';

/**
 * Money on the client.
 *
 * Floating point is forbidden for money (CLAUDE.md §3): `0.1 + 0.2 !== 0.3`,
 * and on a funding platform that is somebody's pledge. Every amount that comes
 * near arithmetic or a comparison is a `Decimal`, and it crosses the API as a
 * string — never as a JSON number, which is an IEEE 754 double and cannot hold
 * `599.00` exactly (docs/architecture.md §10.3).
 *
 * `parseFloat` and `Number()` are absent from this module on purpose. Both
 * silently accept `'1e5'`, `'0x10'`, `'12abc'`, and `Infinity`, and both lose
 * precision on the way in — so a string that has already been through them can
 * never be trusted again.
 *
 * No global `Decimal.set()` here. This module only parses, compares, and
 * formats to a fixed scale, none of which needs a precision or rounding mode;
 * configuring the constructor globally from a leaf module would change the
 * behaviour of every other consumer that imports it.
 */

/** Money as the API carries it. The amount is a string, always. */
export interface Money {
  /** Fixed-scale decimal string, e.g. `"5000.00"`. */
  amount: string;
  /** ISO 4217 code. */
  currency: string;
}

/**
 * The currencies a creator may choose from.
 *
 * One entry, because phase 1 collects in AZN only (docs/architecture.md §21.2).
 * It is still a list and still a `<select>`: the project currency is a real
 * choice that is immutable after launch, and phase 2 adds USD, EUR, TRY, and
 * RUB. Offering a currency the platform cannot yet collect in would be a
 * promise the payment side does not keep.
 */
export const SUPPORTED_CURRENCIES = ['AZN'] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = 'AZN';

export function isSupportedCurrency(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}


/** Digits before the point, from the same `numeric(14,2)`. */
export const MONEY_MAX_INTEGER_DIGITS = 14 - MONEY_SCALE;

/**
 * Exactly what this accepts: digits, optionally one full stop and one or two
 * more digits. Spaces are stripped first, because a creator typing a large
 * figure often groups it.
 *
 * A comma is NOT accepted, and that is deliberate rather than lazy. The
 * interface ships in Azerbaijani and English (§21.1), and `1,50` is one and a
 * half in one of them and a malformed thousand in the other. Guessing which
 * would mean occasionally reading a goal as a hundredth of what was meant, so
 * the field refuses it and says to use a full stop.
 */
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * Whether a string is an amount this platform would put on the wire.
 *
 * The same rule {@link parseAmount} applies, exported since #91 for the one caller that has to
 * check an amount it did not ask a person for: §12.1's socket carries a delta into a running
 * total, and what arrives there is whatever was sent to the browser.
 *
 * <strong>`Decimal`'s own constructor is not this test.</strong> It accepts `'1e5'`, `'0x10'`
 * and a leading sign, which are all values that would parse into something and then render as a
 * number nobody pledged. The regex is the rule; the constructor is what does arithmetic once
 * the rule has passed.
 */
export function isWireAmount(value: string): boolean {
  return AMOUNT.test(value);
}

export type AmountRejection =
  | 'empty'
  | 'not-a-number'
  | 'comma'
  | 'too-many-decimals'
  | 'too-large'
  | 'not-positive';

export type AmountParse =
  | { readonly ok: true; readonly value: Decimal }
  | { readonly ok: false; readonly reason: AmountRejection };

export interface AmountOptions {
  /**
   * Whether zero is an amount rather than a mistake.
   *
   * Off by default, because the two amounts that existed before this option —
   * a funding goal and a reward price — are both meaningless at zero.
   *
   * On for a shipping rate. "Free to Azerbaijan" is an offer a creator makes on
   * purpose, and the server stores it as `0.00` rather than as an absent rule
   * (see `ShippingRule.additionalItemAmount`). Refusing it here would leave the
   * creator no way to say the thing the data model is built to express.
   */
  readonly allowZero?: boolean;
}

/**
 * Reads a typed amount without ever converting it to a number.
 *
 * The result carries a reason rather than a message: the wording belongs to the
 * field that renders it, and the same rejection reads differently on a goal
 * than it does on a reward price or a shipping rate.
 */
export function parseAmount(input: string, options: AmountOptions = {}): AmountParse {
  // Ordinary spaces, non-breaking spaces, and the narrow no-break space that
  // `Intl.NumberFormat` itself emits as a group separator.
  const cleaned = input.replace(/[\s  ]/g, '');

  if (cleaned === '') return { ok: false, reason: 'empty' };
  if (cleaned.includes(',')) return { ok: false, reason: 'comma' };

  if (!AMOUNT.test(cleaned)) {
    // A well-formed number with too much scale is a different mistake from
    // gibberish, and the creator can fix it without retyping the figure.
    const tooPrecise = /^\d+\.\d{3,}$/.test(cleaned);
    return { ok: false, reason: tooPrecise ? 'too-many-decimals' : 'not-a-number' };
  }

  const [whole = ''] = cleaned.split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > MONEY_MAX_INTEGER_DIGITS) {
    return { ok: false, reason: 'too-large' };
  }

  const value = new Decimal(cleaned);
  // A negative cannot reach this line — the pattern above carries no sign — so
  // with `allowZero` there is nothing left for this check to refuse.
  if (options.allowZero !== true && value.lessThanOrEqualTo(0)) {
    return { ok: false, reason: 'not-positive' };
  }

  return { ok: true, value };
}

/**
 * The string the API receives.
 *
 * Always two decimal places, so `5000` and `5000.00` are the same request and
 * the server never sees a scale it has to guess at.
 */
export function toWireAmount(value: Decimal): string {
  return value.toFixed(MONEY_SCALE);
}

/** A `Money` body from a parsed amount. */
export function toMoney(value: Decimal, currency: string): Money {
  return { amount: toWireAmount(value), currency };
}

/**
 * The amount as an editable string.
 *
 * The wire value is returned verbatim rather than reformatted: it is already a
 * decimal string of the right scale, and putting it through a formatter on the
 * way into a text field is how a trailing zero or a group separator ends up in
 * the next request body.
 */
export function amountFieldValue(money: Money | null | undefined): string {
  return money?.amount ?? '';
}

/**
 * §21.2's display currency — issue #327.
 *
 * A reader who thinks in dollars wants to know roughly what a manat campaign
 * costs. What follows converts one amount, once, and every function in it
 * carries `approximate` in its name so that a value produced here can never be
 * mistaken at a call site for something chargeable.
 *
 * **NOTHING HERE DECIDES WHAT ANYBODY PAYS.** §21.2: the display currency is an
 * approximation and collection occurs in the project's currency. A converted
 * figure must never be summed, put on a receipt, or sent back to the API.
 */

/**
 * A rate as `/v1/exchange-rates` carries it.
 *
 * **One unit of `currency` is worth `rate` of the base**, so an amount in the
 * base currency is *divided*. That direction is the one mistake this feature
 * can make: it is invisible on a rate near one and a factor of thirty on the
 * lira, which is why the field is documented here and asserted in the tests.
 *
 * The rate is a **string** for the reason every amount on this platform is: a
 * JSON number is an IEEE 754 double, and `1.7000000000` parsed as one and
 * multiplied out is the same class of error as an amount, one step earlier.
 */
export interface ExchangeRate {
  /** The currency being priced. */
  currency: string;
  /** Units of the base currency per ONE unit of `currency`, as a decimal string. */
  rate: string;
  /** The day the source says it is in force from, `YYYY-MM-DD`. */
  publishedFor: string;
}

/**
 * The constructor the conversion uses, with its own precision and rounding.
 *
 * `Decimal.clone` and NOT `Decimal.set`. The module note at the top forbids the
 * second — configuring the shared constructor from a leaf module changes the
 * behaviour of every other consumer that imports `decimal.js` — and this is the
 * escape it leaves open: a separate constructor, configured once, affecting
 * nothing outside this file.
 *
 * It matters because a division is the one operation here whose answer depends
 * on a global setting. Twenty significant digits is `decimal.js`'s own default,
 * so this changes nothing today; what it buys is that the figure beside
 * somebody's pledge does not move because an application somewhere called
 * `Decimal.set({ precision: 7 })` for a chart.
 *
 * `ROUND_HALF_EVEN` because §21.2 declares it once, in `MoneyRounding`, and
 * applies it to everything that touches money. A display currency that rounded
 * away from zero would be a second rule nobody wrote down.
 */
const Approximating = Decimal.clone({
  precision: 20,
  rounding: Decimal.ROUND_HALF_EVEN,
});

/**
 * What `money` is roughly worth in `rate.currency`.
 *
 * Rounded once, at the end, to two decimal places — the same scale and the same
 * `ROUND_HALF_EVEN` §21.2 applies to every charged amount, so the display
 * currency obeys the platform's rounding rule rather than a second one.
 *
 * @returns the approximate amount, or `null` when there is nothing honest to
 *     show: no rate, a rate that is not a number, a non-positive rate, or an
 *     amount that is already in the target currency. **A figure computed from a
 *     rate that is not there is worse than no figure**, because a backer acts on
 *     it, so every failure here is an absence rather than a fallback.
 */
export function approximate(
  money: Money | null | undefined,
  rate: ExchangeRate | null | undefined,
): Money | null {
  if (money == null || rate == null) return null;
  if (money.currency === rate.currency) return null;
  if (!isWireAmount(money.amount)) return null;

  // The rate is not a wire amount: it has ten decimal places, and `isWireAmount`
  // allows two. It still must not reach `Decimal` unchecked, for that
  // constructor's own reasons — it accepts `'1e5'` and `'0x10'`.
  if (!/^\d+(\.\d+)?$/.test(rate.rate)) return null;

  const divisor = new Approximating(rate.rate);
  if (divisor.lessThanOrEqualTo(0)) return null;

  const converted = new Approximating(money.amount)
    .dividedBy(divisor)
    .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN);
  return { amount: converted.toFixed(MONEY_SCALE), currency: rate.currency };
}

/**
 * The approximation as a reader sees it: `≈ 29.41 USD`.
 *
 * **The almost-equal sign is not decoration.** It is the only thing on the
 * screen that says this figure is not what will be charged, and it is a
 * character rather than a word so that it needs no translation in any of
 * §21.1's four languages.
 *
 * @returns the formatted string, or `''` when there is no approximation to
 *     show — so a component can render it unconditionally and draw nothing.
 */
export function formatApproximate(money: Money | null | undefined): string {
  const formatted = formatMoney(money);
  return formatted === '' ? '' : `≈ ${formatted}`;
}

/**
 * The rate for one currency out of what `/v1/exchange-rates` answered.
 *
 * A helper rather than a `find` at each call site, because the case that
 * matters is the one that returns nothing: a currency somebody chose last month
 * whose source has since stopped publishing. Every caller has to handle it, and
 * a `find` that returned `undefined` invites a `!`.
 */
export function rateFor(
  rates: readonly ExchangeRate[] | null | undefined,
  currency: string | null | undefined,
): ExchangeRate | null {
  if (rates == null || currency == null) return null;
  return rates.find((rate) => rate.currency === currency) ?? null;
}
