import type { Money } from '@ideanest/money';

export type { Money } from '@ideanest/money';


/* -------------------------------------------------------------------------
 * The public reward list — GET /v1/projects/{id}/rewards/public (#195)
 * ---------------------------------------------------------------------- */

/**
 * How a tier reaches the person who backed it.
 *
 * The same five values `lib/projects/api.ts` declares for the creator's editor.
 * It is repeated rather than imported because the two clients speak to two
 * different projections of the same table and neither owns the other; the
 * alternative — the backer's checkout importing the creator's editor client —
 * would make a change to the editor's types a change to checkout.
 */
export type ShippingType = 'NONE' | 'DIGITAL' | 'LOCAL_PICKUP' | 'DOMESTIC' | 'INTERNATIONAL';

/**
 * Whether a per-country rate means anything for this line.
 *
 * `DOMESTIC` and `INTERNATIONAL` ship; `NONE`, `DIGITAL` and `LOCAL_PICKUP` do
 * not. This is `ShippingType.isShipped()` on the service and `QuotedLine.shipped`
 * in `pledge/domain`, and it is the only thing that decides whether checkout asks
 * a backer where they live — asking for a postal address in order to deliver a
 * download is the visible half of getting it wrong.
 */
export function isShipped(type: ShippingType): boolean {
  return type === 'DOMESTIC' || type === 'INTERNATIONAL';
}

/**
 * One destination's rate, as the public list carries it.
 *
 * BOTH AMOUNTS ARE STRINGS, because both are added to a total that is charged to
 * a card (§10.3). There is no currency on a rate: the whole table is denominated
 * in the campaign's, which the list carries once.
 *
 * `additionalItemAmount` is optional here even though the contract prints it,
 * because `ShippingRate` on the service treats an omitted additional amount as a
 * flat rate however many are ordered, deliberately rather than by accident.
 */
export interface PublicShippingRate {
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  amount: string;
  additionalItemAmount?: string | null;
}

/** One line of what a tier contains, as a backer reads it. */
export interface PublicRewardItem {
  name: string;
  quantity: number;
  isDigital: boolean;
}

/**
 * A reward tier as the backer's list shows it.
 *
 * DELIBERATELY NARROWER THAN THE CREATOR'S `Reward`. There is no
 * `claimedQuantity`, no `reservedQuantity`, no `secretToken`, no `version` and no
 * `sortOrder`: the public projection does not carry them, the list arrives in
 * sort order already, and a client that reconstructed the reservation counts
 * would be publishing how close a campaign is to selling out of a tier it has
 * deliberately not published.
 */
export interface PublicReward {
  id: string;
  title: string;
  description?: string | null;
  price: Money;
  /** An ISO date, or absent. A month is what a creator can honestly promise. */
  estimatedDelivery?: string | null;
  shippingType: ShippingType;
  /** Absent or null means unlimited, which is the common case. */
  limitQuantity?: number | null;
  /**
   * `limit - (claimed + reserved)`, or absent when there is no limit.
   *
   * ZERO IS A TIER THAT IS SHOWN AND CANNOT BE TAKEN (PL-01). Hiding a sold-out
   * tier tells a backer the campaign never offered it, and the interface then
   * cannot explain why the total they were quoted a minute ago is unavailable.
   */
  remainingQuantity?: number | null;
  isEarlyBird: boolean;
  isFeatured: boolean;
  items: readonly PublicRewardItem[];
  /** Empty when the tier is not shipped. */
  shippingRates: readonly PublicShippingRate[];
}

/**
 * Whether the tier has run out. Absent stock is unlimited, never sold out.
 *
 * <p>Beside `PublicReward` rather than in the radio group that first needed it. Three
 * callers ask it now — the reward list, the add-on list, and the seeding of a `?reward=`
 * preselection in `useCheckout` — and the third would have made `useCheckout` import from a
 * component that imports `useCheckout`. A rule about what the catalogue says does not belong
 * to any one control that draws it.
 */
export function isSoldOut(reward: PublicReward): boolean {
  return reward.remainingQuantity === 0;
}

/**
 * `GET /v1/projects/{id}/rewards/public`.
 *
 * `rewards` and `addons` are two arrays rather than one with a flag because they
 * are two different questions at checkout: a backer chooses exactly one reward
 * and any number of add-ons with quantities.
 */
export interface PublicRewardList {
  currency: string;
  rewards: readonly PublicReward[];
  addons: readonly PublicReward[];
}

/* -------------------------------------------------------------------------
 * The pledge itself — POST /v1/pledges/draft and /confirm (#52)
 * ---------------------------------------------------------------------- */

/**
 * The twelve states of docs/architecture.md §6.2, no more.
 *
 * Checkout only ever produces the first two and only ever renders the first
 * three; the rest exist because a `PledgeResponse` read back later carries them,
 * and a union that omitted them would make an honest response a type error. The
 * transitions are the server's business and there is deliberately no client-side
 * copy of the transition table to fall out of step with it — the same decision
 * `ProjectState` took.
 */
export type PledgeState =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'CANCELED_BY_BACKER'
  | 'CANCELED_BY_PROJECT'
  | 'CHARGE_PENDING'
  | 'CHARGE_FAILED'
  | 'COLLECTED'
  | 'DROPPED'
  | 'REFUNDED'
  | 'CHARGEBACK'
  | 'FULFILLED';

/** One add-on and how many of it, in both directions. */
export interface PledgeAddon {
  rewardTierId: string;
  quantity: number;
}

/**
 * The six amounts of `PledgeQuote`, which are §7.2's five columns plus the
 * generated total.
 *
 * ALL SIX ARE ALWAYS PRESENT. `tax` is `"0.00"` until #78 builds a tax model,
 * and that zero is deliberate rather than missing — see `TaxPolicy` in
 * `pledge/domain`. The summary decides separately whether a zero line is worth
 * printing; see `PledgeSummary`.
 */
export interface PledgeAmounts {
  base: Money;
  addons: Money;
  bonus: Money;
  shipping: Money;
  tax: Money;
  total: Money;
}

/**
 * A pledge as the service holds it.
 *
 * The response of the draft, the read and the confirm, so one request both
 * changes the pledge and returns the truth about it — the same arrangement the
 * project client relies on, and the reason nothing here merges a partial
 * response into a local copy.
 */
export interface PledgeResponse {
  id: string;
  projectId: string;
  state: PledgeState;
  rewardTierId?: string | null;
  addons: readonly PledgeAddon[];
  amounts: PledgeAmounts;
  shippingCountry?: string | null;
  isAnonymous: boolean;
  /**
   * ISO 8601, UTC. Five minutes out on a draft, absent once confirmed.
   *
   * PL-13's reservation: the stock is held, not taken, and the hold ends. A
   * client that did not show this would let somebody fill in a form for six
   * minutes and then be told the tier is gone.
   */
  reservationExpiresAt?: string | null;
  confirmedAt?: string | null;
  canceledAt?: string | null;
  /**
   * §21.2's rate retention (#327): the currency this pledge was approximated in at
   * confirmation, and the rate it was approximated at.
   *
   * Both null together for most pledges, and that is the record rather than a gap: a backer
   * reading amounts in the campaign's own currency was shown no approximation, and the
   * service refuses to record a rate of 1 for a conversion that did not happen.
   *
   * **The rate and never the converted amount.** The amount is a product of `amounts.total`
   * and this, and carrying both would be carrying a figure that can disagree with its own
   * inputs. `@ideanest/money`'s `approximate` is what multiplies, once, where it is drawn.
   */
  displayCurrency?: string | null;
  /** A decimal string. Units of `amounts.total`'s currency per ONE unit of `displayCurrency`. */
  displayRate?: string | null;
  /**
   * What the backer said to charge later, echoed back. Null until #55 exists to
   * give them one, and null on every pledge this build can make.
   *
   * Optional in the same way every nullable field here is, and read rather than
   * assumed: the confirmation screen states whether a payment method was
   * collected, and that sentence is only true for as long as somebody keeps
   * remembering to change it. The field is the thing that stops it being a
   * claim this client makes about a service it cannot see.
   */
  paymentMethodId?: string | null;
  /**
   * Whether §9.2's phase 1 happened — the verification authorisation, 3-D
   * Secure, the stored token and the void.
   *
   * ALWAYS PRESENT, and `false` on every confirmed pledge the platform holds
   * until #55 lands. Required rather than optional because the service writes it
   * out unconditionally, and because a client that could read it as `undefined`
   * would need a default — and the only safe default is the value the field
   * exists to stop being guessed.
   *
   * IT DOES NOT MEAN A CHARGE SUCCEEDED OR FAILED. §9.2 moves no money at
   * confirmation under any circumstances; collection is phase 2, at the close of
   * a successful campaign, and belongs to epic #59.
   */
  cardVerified: boolean;
  /**
   * §4.5's PL-16: whether this pledge was taken after the campaign's deadline.
   *
   * Read-only in every sense. It is stamped from what `PledgeAcceptance` answered at the time
   * and is deliberately NOT re-stamped by an edit — a backer changing their shirt size during
   * a late-pledge window does not move their original pledge into the late column, because
   * §5.1's funding decision was made from the number this flag divides.
   */
  latePledge: boolean;
  /**
   * §4.8's PM-09 and PM-10 — what was bought against this pledge after the campaign closed.
   *
   * BESIDE THE PLEDGE AND NEVER INSIDE IT, which is why the amounts above do not include
   * them: V29 froze the comparison §5.1 made at the deadline, and folding a later purchase
   * back into `base_amount` would change a number the platform has already reported. Empty on
   * every pledge until somebody upgrades or buys an add-on late.
   */
  supplements: readonly PledgeSupplement[];
  /**
   * #171: whether this pledge may be raised now with `POST /v1/pledges/{id}/raise` — it is paid for
   * (`COLLECTED`) and its campaign is taking pledges.
   *
   * The service answers it because only the service can: whether a campaign takes pledges depends
   * on windows this client is not shown. Optional so an older response reads as `false`, which is
   * the safe side: a control not offered is refused by nobody.
   */
  raisable?: boolean;
  /** #171: the most recent attempt to raise this pledge, or null when there has been none. */
  latestRaise?: PledgeRaise | null;
}

/**
 * #171: where one attempt to raise a paid pledge has got to.
 *
 * `PENDING` is a payment the provider has not settled; `SUCCEEDED` is applied and is in the
 * amounts above; `FAILED`, `EXPIRED` and `ABANDONED` changed nothing and charged nothing; and
 * `UNAPPLIED` was charged after the pledge had changed, so it was not applied and is refunded.
 */
export type PledgeRaiseState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'ABANDONED' | 'UNAPPLIED';

export interface PledgeRaise {
  id: string;
  /** Widened to `string` on the wire; the union above is what this build knows how to word. */
  state: PledgeRaiseState | string;
  /** The difference charged, or to be charged. */
  amount: Money;
  /** What the pledge comes to once the raise is applied. */
  total: Money;
  holdExpiresAt: string;
  createdAt: string;
  endedAt?: string | null;
  /**
   * The provider’s page for this raise, to go back to and finish paying. Present only while the
   * raise is `PENDING` and its hold has not run out; null (or absent, from an older service) otherwise,
   * and then there is no way back to that page from here.
   */
  resumeUrl?: string | null;
}

/**
 * One post-campaign purchase recorded against a pledge — a `pledge_supplements` row.
 *
 * `collectedAt` is null on every row this platform holds: PM-16's charge is epic #59's, and a
 * client that rendered "paid" from a non-null field nobody writes would be inventing a
 * receipt. It is read rather than assumed for that reason.
 */
export interface PledgeSupplement {
  id: string;
  /** `UPGRADE` or `ADDONS`. Widened, so an unknown kind renders as itself. */
  kind: string;
  /** The two tiers of an upgrade. Null on an add-on purchase, which has `addons` instead. */
  fromRewardTierId?: string | null;
  toRewardTierId?: string | null;
  /** Always positive. A downgrade is a refund, and refunds are #67's. */
  amount: Money;
  addons: readonly PledgeAddon[];
  createdAt: string;
  /** Null on every supplement this platform holds — see the interface comment. */
  collectedAt?: string | null;
}

/**
 * `POST /v1/pledges/draft`'s body.
 *
 * `contribution` is what the backer chose to give: the tier's price plus PL-03's
 * bonus, or — with no tier — the whole of a support-only pledge. Add-ons,
 * shipping and tax are added on top of it and are NOT part of it. That is
 * exactly `PledgeSelection.contributionAmount` in `pledge/domain`, and a client
 * that folded the add-ons into it would send a number the server would then add
 * them to again.
 */
export interface DraftPledgeRequest {
  projectId: string;
  /** Null for PL-02: support with no reward, which is a first-class choice. */
  rewardTierId: string | null;
  addons: readonly PledgeAddon[];
  contribution: Money;
  /** ISO 3166-1 alpha-2, or null when nothing in the selection ships. */
  shippingCountry: string | null;
  isAnonymous: boolean;
  referrerCode: string | null;
}

/* -------------------------------------------------------------------------
 * The payment page — POST /v1/pledges/{id}/payment (IDN-EXT-01, #39 and #44)
 * ---------------------------------------------------------------------- */

/**
 * What paying for a draft sends.
 *
 * The same acknowledgement `ConfirmPledgeRequest` carries, because the payment endpoint makes
 * confirmation's refusals and records the backer agreement in its place. `successUrl` and
 * `errorUrl` are where the provider sends the backer back; `language` is the page's, so the
 * provider's page speaks the one the backer was reading.
 */
export interface PayPledgeRequest {
  acknowledgedAgreementVersion: number | null;
  language: string;
  successUrl: string;
  errorUrl: string;
}

/**
 * The provider's page for this pledge.
 *
 * `redirectUrl` is the whole answer: the browser goes there and the card is entered on the
 * provider's page, never here (§17.2's SAQ A). The pledge stays `DRAFT` until the provider's
 * webhook settles it `COLLECTED`, so nothing on this side may read the response as "paid".
 */
export interface PaymentPageResponse {
  pledgeId: string;
  providerTransactionId: string;
  redirectUrl: string;
}
