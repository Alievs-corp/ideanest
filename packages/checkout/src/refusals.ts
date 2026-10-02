import { formatMoney, type AmountRejection } from '@ideanest/money';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { QuoteRefusal } from './quote';


/**
 * Two refusals worded for the contribution field, wherever that field is drawn — issue #81.
 *
 * <h2>Why they left `CheckoutView`</h2>
 *
 * They were local functions there, and `PledgeEditor` — which is the same form over a pledge
 * that already exists — had its own English copies of both. That is the shape the whole of
 * `components/checkout` was built to avoid: the editor imports `RewardChoice`, `AddonChoice`,
 * `DestinationField` and `PledgeSummary` rather than rewriting them, precisely so there is
 * one sold-out rule and one destination union. The sentences those controls refuse with
 * belong in the same place for the same reason. A second wording would be one nobody looks
 * at, on the screen a backer reaches weeks after the checkout.
 *
 * <h2>The parser returns a reason, never a message</h2>
 *
 * `parseAmount` answers with an `AmountRejection` so that each field can say what it means
 * here: the same `not-positive` is "a goal has to be more than nothing" on a campaign form
 * and "a pledge has to be more than nothing" on this one. These two turn a reason into the
 * checkout's vocabulary; a different field writes its own function over the same reasons.
 */

export interface RefusalCopy {
  readonly errors: {
    readonly amountMissing: string;
    readonly amountMissingMinimum: string;
    readonly amountComma: string;
    readonly amountNotANumber: string;
    readonly amountPrecision: string;
    readonly amountTooLarge: string;
    readonly amountTooSmall: string;
    readonly belowRewardPrice: string;
    readonly destinationMissing: string;
    readonly destinationUnpriced: string;
    readonly totalTooSmall: string;
  };
}

/** `parseAmount`'s rejection reasons, worded for the contribution field. */
export function contributionMessage(
  reason: AmountRejection,
  minimum: string | null,
  copy: RefusalCopy,
): string {
  switch (reason) {
    case 'empty':
      return minimum === null
        ? copy.errors.amountMissing
        : fillPlaceholders(copy.errors.amountMissingMinimum, { minimum });
    case 'comma':
      return copy.errors.amountComma;
    case 'not-a-number':
      return copy.errors.amountNotANumber;
    case 'too-many-decimals':
      return copy.errors.amountPrecision;
    case 'too-large':
      return copy.errors.amountTooLarge;
    case 'not-positive':
      return copy.errors.amountTooSmall;
  }
}

/** A quote refusal, worded for the control it belongs to. */
export function refusalMessage(refusal: QuoteRefusal, copy: RefusalCopy): string {
  switch (refusal.reason) {
    case 'contribution-below-price':
      return fillPlaceholders(copy.errors.belowRewardPrice, {
        price: formatMoney(refusal.price),
      });
    case 'destination-missing':
      return copy.errors.destinationMissing;
    case 'destination-unpriced':
      return fillPlaceholders(copy.errors.destinationUnpriced, {
        lines: refusal.lines.join(', '),
      });
    case 'nothing-pledged':
      return copy.errors.totalTooSmall;
  }
}
