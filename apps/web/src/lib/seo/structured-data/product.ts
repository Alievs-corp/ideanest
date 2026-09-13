import { parseAmount, toWireAmount, type Money } from '../../money';
import { PLEDGEABLE_PROJECT_STATES } from '../../projects/pledgeable';
import { isFetchableImageUrl, truncateAtWord } from '../metadata';
import { withoutAbsent, type JsonLdNode } from './document';

/**
 * THE `Product` ON A CAMPAIGN PAGE IS THE REWARD TIER, NOT THE CAMPAIGN.
 *
 * This is the decision in the whole directory that is worth getting wrong
 * loudly rather than quietly, so here is the argument in full.
 *
 * The obvious markup for a crowdfunding page is one `Product` for the campaign,
 * with an `Offer` whose price is the funding goal or the amount pledged. It is
 * also false in three separate ways. A campaign has no price — the goal is a
 * threshold and the pledged total is a running sum, and neither is a sum anybody
 * can pay to receive anything. It has no availability — Google's `Offer`
 * requires one, and every value in the enumeration would be a claim about stock
 * that a campaign does not have. And a `Product` whose `offers.price` is a
 * five-figure goal, on a page whose visible price is an 85 AZN tier, breaches
 * the structured data policy that markup must match what the page shows. That
 * combination — a price that is not the page's, an availability that is
 * invented, on a page that cannot be bought from — is the shape that earns a
 * manual action, and a manual action is applied to the whole site rather than
 * to the campaign that caused it.
 *
 * The reward tier survives every one of those objections. It has a price the
 * creator set and the page prints (§4.4's Rewards tab: "price, backer count,
 * shipping destinations, estimated delivery, remaining quantity"). It has a
 * quantity, so "sold out" is a fact rather than a guess. It is the thing a
 * backer chooses, and it is the only thing on the page that anyone commits money
 * to. One `Product` per publicly offered tier, each anchored to the campaign
 * page it is described on.
 *
 * <h2>`PreOrder`, and why nothing else is honest</h2>
 *
 * IdeaNest is all or nothing: nobody is charged unless the campaign reaches its
 * goal by its deadline (docs/architecture.md §4.5). A backer who selects a tier
 * has not bought anything and may never be charged at all. `InStock` would say
 * the opposite of that to every consumer that reads it. `PreOrder` is the one
 * value in `ItemAvailability` that describes money committed now for a thing
 * that does not exist yet — which is the literal definition of a pledge. A tier
 * whose last place is taken is `SoldOut`, which is true in any funding model.
 *
 * <h2>What is never claimed</h2>
 *
 * **No `aggregateRating` and no `review`.** The platform has no reviews. A
 * rating assembled from backer counts or funding percentage would be a
 * fabricated review signal, which is the specific thing Google's structured data
 * policy names as grounds for a manual action.
 *
 * **No `seller`.** The seller of a reward is the creator, and IdeaNest is the
 * escrow between them (§4.5). Naming the platform as the seller would move a
 * fulfilment obligation onto it in machine-readable form.
 *
 * **No stock figure.** `Offer.inventoryLevel` would be accurate for as long as
 * it takes somebody to back the tier. `lib/seo/metadata-card.tsx` refuses to
 * draw a backer count onto a social card for the same reason, and a number in a
 * cached document is a number that will be wrong.
 *
 * **No image the tier does not have.** The campaign's cover is the campaign's,
 * and naming it as the tier's product image would show a photograph of a
 * different thing beside the tier's price.
 */

/** The only fields of a reward tier that structured data may know about. */
export interface PublicRewardTier {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly price: Money;
  /**
   * Places left, or `null` when the tier is unlimited — the shape
   * `Reward.remainingQuantity` already has. `null` is the common case and is not
   * the same as zero.
   */
  readonly remainingQuantity: number | null;
  readonly imageUrl: string | null;
}

export interface RewardProductsInput {
  /** The campaign page's canonical URL in THIS language, from `canonicalUrl`. */
  readonly campaignUrl: string;
  /**
   * The campaign's language-independent address, used only as an identifier — #123.
   *
   * <p>A reward tier is one thing that four documents describe, so it gets one `@id`. Deriving
   * the identifier from `campaignUrl` instead would mint four `Product` nodes for one boxed
   * set, one per language, the same way it would have minted four `Organization` nodes for one
   * company; `identity.ts` sets out that argument and this is the same one, a level down.
   *
   * <p>It is deliberately an address nothing serves — `proxy.ts` answers it with a 307 —
   * because an `@id` is a name and not a link. `url` beside it is the document.
   */
  readonly campaignId: string;
  /** One of §6.1's sixteen states, as text. */
  readonly campaignState: string;
  /** ISO 8601, or `null` for a campaign that has not launched. */
  readonly deadline: string | null;
  /**
   * The tiers the PUBLIC projection returned. Secret tiers are not in it —
   * `GET /v1/projects/{id}/rewards/public` leaves them out, which is what makes
   * them secret — and nothing here would put one back.
   */
  readonly tiers: readonly PublicRewardTier[];
  /** Injected in tests; the wall clock otherwise. */
  readonly now?: Date;
}

/**
 * The two states in which a pledge can actually be taken.
 *
 * NOT THE SAME QUESTION AS "IS THIS PAGE PUBLIC", and not the same question as
 * "may this page be indexed" (`lib/seo/indexability.ts` owns that one). A
 * `SUCCESSFUL` campaign is public, indexable, and closed: its rewards are still
 * printed on the page, and an `Offer` on them would invite a crawler to send
 * somebody to buy a thing that cannot be bought. So a campaign outside these two
 * states gets no `Product` node at all — Google requires a product snippet to
 * carry `offers`, `review` or `aggregateRating`, and with no offer to make and
 * no reviews to cite there is nothing left that would be valid.
 *
 * A state this build has never heard of is not one of them. Same rule as
 * `projectStateIndexability`: fail closed, because the state a future
 * deployment adds first is more likely to be a restriction than a permission.
 *
 * <p><strong>It is declared in `lib/projects/pledgeable.ts` now, and re-exported here.</strong>
 * The list stopped being a structured-data concern the moment the campaign page grew controls
 * that lead to the checkout: the markup saying a tier is on offer and the button that takes
 * the offer have to agree, and two frozen arrays in two files agree only until one of them is
 * edited. The re-export is kept because this is where the list has always been imported from.
 */
export { PLEDGEABLE_PROJECT_STATES };

/**
 * 500 characters.
 *
 * A reward description is free prose in a form and routinely runs to several
 * paragraphs. Unlike a `<meta>` description it is not truncated by anybody, so
 * the only cost of the whole of it is bytes — in the document, on every request
 * for every campaign page, multiplied by every tier. 500 characters is enough to
 * say what a tier contains and short enough that ten tiers are kilobytes rather
 * than tens of them. `truncateAtWord` cuts between words, so the result reads as
 * a sentence that continues rather than as a fault.
 */
export const REWARD_DESCRIPTION_MAX_LENGTH = 500;

/**
 * ISO 4217 by shape, rather than by the list phase 1 collects in.
 *
 * `isSupportedCurrency` answers "may a creator choose this", which is one
 * currency today (§21.2). This asks the narrower question of whether the string
 * the API sent is a currency code at all, so that the day a second currency is
 * enabled the structured data does not have to be redeployed to notice.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/u;

function collapsed(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * The moment the offers stop standing, as a date, or `undefined`.
 *
 * `priceValidUntil` IN THE PAST IS WORSE THAN NONE: Google treats an expired
 * offer as a reason to drop the markup, and a campaign in `CLOSING_WINDOW` or
 * `EXTENDED` is past its first deadline by definition. A deadline that does not parse is treated as
 * absent rather than guessed at.
 */
function priceValidUntil(deadline: string | null, now: Date): string | undefined {
  if (deadline === null || deadline === '') return undefined;

  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() <= now.getTime()) return undefined;

  return date.toISOString().slice(0, 10);
}

/** One tier's node, or `null` when the tier cannot be described truthfully. */
function rewardProductNode(
  tier: PublicRewardTier,
  input: RewardProductsInput,
  expiry: string | undefined,
): JsonLdNode | null {
  const name = collapsed(tier.title);
  if (name === '') return null;

  /*
   * PARSED WITH THE MONEY MODULE, NEVER WITH `Number()`. The amount goes into
   * the document as the decimal string it arrived as, because a JSON number
   * here would be an IEEE 754 double — `85.00` serialises back as `85`, and the
   * scale that says this is money is gone (CLAUDE.md §3, §10.3). schema.org's
   * `price` accepts Text, so the string is not a workaround; it is the
   * representation that cannot lose a digit. Parsing at all is what refuses an
   * empty, negative, comma-separated or free amount before it is offered.
   */
  const amount = parseAmount(tier.price.amount);
  if (!amount.ok) return null;
  if (!CURRENCY_CODE.test(tier.price.currency)) return null;

  const description = truncateAtWord(tier.description ?? '', REWARD_DESCRIPTION_MAX_LENGTH);
  const image =
    tier.imageUrl !== null && isFetchableImageUrl(tier.imageUrl) ? tier.imageUrl : undefined;

  /* `null` is unlimited and is not zero; only a tier with no places left is sold out. */
  const soldOut = tier.remainingQuantity !== null && tier.remainingQuantity <= 0;

  return withoutAbsent({
    '@type': 'Product',
    // The identifier is a fragment on the campaign's URL. Encoded, because an
    // identifier that arrived from the service is not a URL component until it
    // has been made into one.
    '@id': `${input.campaignId}#reward-${encodeURIComponent(tier.id)}`,
    name,
    description: description === '' ? undefined : description,
    image,
    // The page the tier is described on. There is no per-tier address to point
    // at, and inventing one would be a link to a 404.
    url: input.campaignUrl,
    offers: withoutAbsent({
      '@type': 'Offer',
      price: toWireAmount(amount.value),
      priceCurrency: tier.price.currency,
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/PreOrder',
      url: input.campaignUrl,
      priceValidUntil: expiry,
    }),
  });
}

/**
 * A `Product` for every tier this campaign can honestly offer, and nothing for
 * a campaign that cannot offer anything.
 */
export function rewardProductNodes(input: RewardProductsInput): readonly JsonLdNode[] {
  if (!PLEDGEABLE_PROJECT_STATES.includes(input.campaignState)) return [];

  const expiry = priceValidUntil(input.deadline, input.now ?? new Date());

  return input.tiers
    .map((tier) => rewardProductNode(tier, input, expiry))
    .filter((node): node is JsonLdNode => node !== null);
}
