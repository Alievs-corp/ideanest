import Decimal from 'decimal.js';
import { toMoney, type Money } from '@ideanest/money';
import { isShipped, type PledgeAmounts, type PublicReward } from './types';

/**
 * PL-06's total, computed on the client so the figure moves as the backer
 * chooses.
 *
 * <h2>THIS IS A PREVIEW. THE SERVER'S QUOTE IS THE AUTHORITY</h2>
 *
 * Every number this produces is replaced by `PledgeResponse.amounts` the moment
 * the draft comes back, and the checkout never adds the two together or prefers
 * one field of one to one field of the other. The reason is not politeness about
 * layering: the client is working from a reward list it fetched some seconds ago,
 * and a price, a rate or a tier's availability may have changed since. The server
 * quotes against the row it is about to reserve, inside the transaction that
 * reserves it. So this exists to make the figure respond to a keystroke, and it
 * stops existing the instant a real one is available.
 *
 * <h2>It mirrors `PledgeQuote` line for line, on purpose</h2>
 *
 * The rules below are `az.ideanest.pledge.domain.PledgeQuote.of` — already merged
 * by #194 — restated in `decimal.js`:
 *
 *   - **base** is the tier's price, or, with no tier, the whole contribution.
 *     Not zero-with-everything-as-bonus: that would make every report of "raised
 *     through rewards versus raised as support" read a support-only pledge as a
 *     bonus on a reward nobody took
 *   - **bonus** is `contribution - base`, and a negative one is a refusal rather
 *     than a clamp — clamping would quietly charge the higher figure, which is
 *     more than the number the backer was looking at
 *   - **add-ons** are the sum of price × quantity
 *   - **shipping** is summed over every shipped line: the first unit at the
 *     destination's rate, each unit after it at the additional rate
 *   - **tax** is zero until #78, from `TaxPolicy.NONE`
 *   - **total** is the five added up, which is what §7.2's generated column does
 *
 * A preview that used a different rule would be worse than no preview, because
 * the backer would see one number, press the button, and be shown another.
 *
 * <h2>No floating point, anywhere</h2>
 *
 * Every amount arrives as a string and is read with `Decimal` (CLAUDE.md §3).
 * Quantities are counts rather than money — a whole number of mugs — and they
 * reach the arithmetic only as the operand of `Decimal.times`, which is exact for
 * an integer.
 */

/** One add-on and how many of it the backer chose. */
export interface AddonSelection {
  reward: PublicReward;
  quantity: number;
}

/** Everything PL-01 to PL-05 let a backer decide — `PledgeSelection`, on the client. */
export interface Selection {
  currency: string;
  /** The tier chosen, or null for PL-02: support with no reward. */
  reward: PublicReward | null;
  /** Only entries with a quantity of one or more; a zero is not a selection. */
  addons: readonly AddonSelection[];
  /** What the backer chose to give. Tier price plus PL-03's bonus, or the lot. */
  contribution: Decimal;
  /** ISO 3166-1 alpha-2, or null when they have not said yet. */
  destination: string | null;
}

/**
 * Why a selection cannot be quoted.
 *
 * A reason rather than a message, exactly as `parseAmount` returns one: the
 * wording belongs to the surface that renders it, and "the creator does not ship
 * there" reads differently beside a country select than it does in a summary
 * panel.
 */
export type QuoteRefusal =
  | { readonly reason: 'contribution-below-price'; readonly price: Money }
  /** Something in the selection is posted and no destination has been chosen. */
  | { readonly reason: 'destination-missing' }
  /** The creator has priced no rate to this destination for these lines. */
  | { readonly reason: 'destination-unpriced'; readonly destination: string; readonly lines: readonly string[] }
  /** A total of nothing. `PledgeQuote` refuses it, and so does a card. */
  | { readonly reason: 'nothing-pledged' };

/** The six amounts, as `Decimal` rather than as strings. */
export interface PreviewQuote {
  readonly currency: string;
  readonly base: Decimal;
  readonly addons: Decimal;
  readonly bonus: Decimal;
  readonly shipping: Decimal;
  readonly tax: Decimal;
  readonly total: Decimal;
}

export type QuoteResult =
  | { readonly ok: true; readonly quote: PreviewQuote }
  | { readonly ok: false; readonly refusal: QuoteRefusal };

const ZERO = new Decimal(0);

/** Every line the backer selected, the reward first — `PledgeSelection.lines()`. */
function lines(selection: Selection): readonly AddonSelection[] {
  const addons = selection.addons.filter((addon) => addon.quantity > 0);
  return selection.reward === null
    ? addons
    : [{ reward: selection.reward, quantity: 1 }, ...addons];
}

/** The selected lines that are posted somewhere, in selection order. */
export function shippedLines(selection: Selection): readonly AddonSelection[] {
  return lines(selection).filter((line) => isShipped(line.reward.shippingType));
}

/**
 * Whether checkout should ask where the pledge is going.
 *
 * PL-05, and the one question that must not be asked when the answer cannot
 * matter: a pledge of a digital file has no destination, and a form that demands
 * a country before it will hand over a download is asking for a postal address in
 * order to deliver an email.
 */
export function requiresDestination(selection: Selection): boolean {
  return shippedLines(selection).length > 0;
}

/**
 * The countries offered in the destination control.
 *
 * The UNION of what every shipped line prices, not the intersection. The
 * intersection would be smaller and would never produce a refusal — but it would
 * also silently hide a country the creator genuinely ships the reward to, because
 * one add-on in the selection is not posted there, and the backer would be left
 * looking for a destination the campaign page told them existed. Offering it and
 * explaining which line refuses it is the difference between "we do not ship
 * there" and "remove the enamel mug and we do".
 */
export function destinationOptions(selection: Selection): readonly string[] {
  const codes = new Set<string>();
  for (const line of shippedLines(selection)) {
    for (const rate of line.reward.shippingRates) codes.add(rate.countryCode.toUpperCase());
  }
  return [...codes].sort();
}

/**
 * The selected lines that are posted but have no rate to this destination.
 *
 * Named lines rather than a boolean, because the backer's next move depends on
 * which one it is — a refusal that cannot say what to remove is a dead end.
 */
export function unpricedLines(selection: Selection, destination: string): readonly string[] {
  return shippedLines(selection)
    .filter((line) => rateFor(line.reward, destination) === null)
    .map((line) => line.reward.title);
}

function rateFor(reward: PublicReward, destination: string) {
  return (
    reward.shippingRates.find(
      (rate) => rate.countryCode.trim().toUpperCase() === destination.trim().toUpperCase(),
    ) ?? null
  );
}

/**
 * What the selection costs, or why it cannot be priced.
 *
 * Refusals rather than best guesses, for the reason `PledgeQuote` gives: the
 * alternative in each case is charging a card an amount nobody agreed to.
 */
export function quoteSelection(selection: Selection): QuoteResult {
  const currency = selection.currency;

  const base =
    selection.reward === null ? selection.contribution : new Decimal(selection.reward.price.amount);

  const bonus = selection.contribution.minus(base);
  if (bonus.isNegative()) {
    return {
      ok: false,
      refusal: {
        reason: 'contribution-below-price',
        price: selection.reward?.price ?? toMoney(base, currency),
      },
    };
  }

  let addons = ZERO;
  for (const addon of selection.addons) {
    if (addon.quantity <= 0) continue;
    addons = addons.plus(new Decimal(addon.reward.price.amount).times(addon.quantity));
  }

  const shipped = shippedLines(selection);
  const destination = selection.destination;

  if (shipped.length > 0 && destination === null) {
    return { ok: false, refusal: { reason: 'destination-missing' } };
  }

  let shipping = ZERO;
  if (destination !== null) {
    const unpriced = unpricedLines(selection, destination);
    if (unpriced.length > 0) {
      return { ok: false, refusal: { reason: 'destination-unpriced', destination, lines: unpriced } };
    }

    for (const line of shipped) {
      const rate = rateFor(line.reward, destination);
      // Unreachable: `unpricedLines` above has already refused every line
      // without a rate. The check is here because the alternative to it is a
      // non-null assertion, and an assertion is a promise the type system stops
      // checking the first time this loop changes.
      if (rate === null) continue;

      // An absent additional amount is a flat rate however many are ordered —
      // `ShippingRate` on the service says that is deliberate rather than
      // missing, so it is read as zero here rather than as "same as the first".
      const additional = new Decimal(rate.additionalItemAmount ?? '0');
      shipping = shipping.plus(
        new Decimal(rate.amount).plus(additional.times(line.quantity - 1)),
      );
    }
  }

  // `TaxPolicy.NONE`. Zero until #78 builds a tax model, and spelled out rather
  // than left implicit so that the line exists to be filled in.
  const tax = ZERO;

  const total = base.plus(addons).plus(bonus).plus(shipping).plus(tax);
  if (total.lessThanOrEqualTo(0)) {
    // `PledgeQuote` refuses it too: a zero total reaches the payment provider as
    // an authorisation for zero, which some decline and some approve, and either
    // way it is a backer in the count who gave nothing.
    return { ok: false, refusal: { reason: 'nothing-pledged' } };
  }

  return { ok: true, quote: { currency, base, addons, bonus, shipping, tax, total } };
}

/**
 * The preview in the shape the server answers with, so one renderer draws both.
 *
 * The summary panel takes `PledgeAmounts` and does not know whether it is looking
 * at a guess or at the truth — which is what stops the two being formatted
 * differently and read as two different numbers.
 */
export function toAmounts(quote: PreviewQuote): PledgeAmounts {
  return {
    base: toMoney(quote.base, quote.currency),
    addons: toMoney(quote.addons, quote.currency),
    bonus: toMoney(quote.bonus, quote.currency),
    shipping: toMoney(quote.shipping, quote.currency),
    tax: toMoney(quote.tax, quote.currency),
    total: toMoney(quote.total, quote.currency),
  };
}
