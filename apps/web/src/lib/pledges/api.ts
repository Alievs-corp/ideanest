import { authorizedFetch, publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * The typed client for the backer's pledge endpoints.
 *
 * ONE MODULE, ONE PLACE, the rule `lib/projects/api.ts` states and
 * `lib/discovery/api.ts` repeats: every `/v1/pledges` and public-reward call the
 * web application makes belongs here, and #56's edit and cancel add functions to
 * this file rather than starting a second client. Two clients drift, and the
 * second one is always the one that forgets that money is a string.
 *
 * Shapes come from the epic #50 pledge API contract, which was derived from
 * docs/architecture.md §4.5, §7.2, §10.2, §10.3 and §10.4. Nothing here invents
 * a field.
 *
 * NULL FIELDS MAY BE ABSENT RATHER THAN NULL. The service serialises with
 * `default-property-inclusion: non_null`, so a tier with no limit has no
 * `limitQuantity` key at all while the contract's example prints it as `null`.
 * Every optional field is typed `?: T | null` so the two readings are the same
 * thing to a caller — the same decision both existing clients took.
 *
 * NOTHING HERE CHARGES A CARD, and nothing here can. §9.2's phase 1 —
 * verification authorisation, 3-D Secure, store the token, void — belongs to
 * #55, which is blocked on #60 (`status: needs-decision`), so there is no
 * provider to call. Confirmation performs the state transition and commits the
 * stock, and that is all it does.
 */

export type { Money } from '../money';

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

export interface PublicRewardOptions {
  /**
   * PL-15's secret tiers: the `secret_token` of each one to unlock.
   *
   * REPEATABLE, as `?token=abc&token=def`, because a campaign may hand out more
   * than one private link and a backer may hold two of them. A single
   * comma-joined parameter would make a token containing a comma unspellable and
   * would put the splitting rule in two places.
   *
   * A tier stays out of the list unless its own token is present, so an empty
   * list here is the ordinary public list and not a degraded one.
   */
  readonly tokens?: readonly string[];
}

/**
 * The tiers a backer may choose from.
 *
 * `publicFetch`, NOT `authorizedFetch`. The endpoint is `permitAll` and the list
 * is what a visitor reads before deciding whether to register at all;
 * `authorizedFetch` throws when there is no token, which would put a sign-in wall
 * in front of the prices.
 *
 * The response carries `ETag` and `Cache-Control: private, no-cache`, so it
 * revalidates on every request — and `publicFetch` sends `cache: 'no-cache'` so
 * that the browser honours precisely that: the stored copy is never used without
 * asking the service first, but a list that has not moved comes back as a bodiless
 * `304` instead of as every tier, item and shipping rule again (#200).
 *
 * Nothing adds a cache of its own on top of it. A second cache in front of live
 * stock is how a tier reads "3 left" after it has sold out; a revalidation that
 * is forced on every read is not one.
 */
export async function getPublicRewards(
  projectId: string,
  options: PublicRewardOptions = {},
  signal?: AbortSignal,
): Promise<PublicRewardList> {
  const query = new URLSearchParams();
  for (const token of options.tokens ?? []) {
    if (token !== '') query.append('token', token);
  }

  const search = query.toString();
  const path = `/v1/projects/${encodeURIComponent(projectId)}/rewards/public${
    search === '' ? '' : `?${search}`
  }`;

  const response = await publicFetch(path, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as PublicRewardList;
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

/**
 * `POST /v1/pledges/{id}/confirm`'s body.
 *
 * `paymentMethodId` is null in every request this build makes, and that is the
 * honest value rather than a placeholder: `/v1/payment-methods/*` is #55, #55 is
 * blocked on #60, and there is no provider, no hosted field and no 3-D Secure to
 * produce an id with. The server accepts null for the same reason — the column is
 * nullable with no foreign key because `payment_methods` is #55's table.
 */
export interface ConfirmPledgeRequest {
  paymentMethodId: string | null;
  /**
   * The version of the backer agreement this checkout showed — #427, §22.3.
   *
   * A version and not a boolean, deliberately. A boolean would say "the client ticked
   * something"; what has to be recorded is which sentence the person read. A page left open
   * across a publication sends the old number and is refused with `AGREEMENT_REQUIRED`,
   * which is the case the field exists for.
   *
   * Null when nothing is published, which is this platform's state until #439 seeds the
   * words — the service treats an unpublished agreement as no requirement.
   */
  acknowledgedAgreementVersion: number | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function readPledge(response: Response): Promise<PledgeResponse> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as PledgeResponse;
}

/**
 * Builds the headers for a payment mutation.
 *
 * `Idempotency-Key` is REQUIRED on every one of them (§10.3), so it is a required
 * parameter of every function below rather than an option with a default. A
 * default would be a key generated per call, which is the one thing the mechanism
 * exists to prevent — see `./idempotency` for what "the same intent" means and
 * why the caller, not this module, is the thing that has to remember it.
 */
function mutationHeaders(idempotencyKey: string): HeadersInit {
  return { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey };
}

/**
 * Reserves stock for five minutes and quotes the selection.
 *
 * `201` with a `PledgeResponse` in `DRAFT`. A replayed `Idempotency-Key` returns
 * the ORIGINAL response — same status, same body — which is what makes a retry
 * after a dropped connection safe, and what makes reusing a key after the
 * reservation expired a mistake rather than a saving.
 *
 * Refusals, as §10.4 problem details: `REWARD_SOLD_OUT` (409, with
 * `meta.availableAlternatives`), `PLEDGE_ALREADY_EXISTS` (409),
 * `IDEMPOTENCY_KEY_REUSED` (409), `SHIPPING_DESTINATION_UNPRICED` (422),
 * `CONTRIBUTION_BELOW_REWARD_PRICE` (422) and `PROJECT_NOT_LIVE` (409). Each is
 * given wording a backer can act on in `./failure`.
 *
 * And four the contract did not name, which #52 answered and both mutations can
 * raise: `IDEMPOTENCY_KEY_REQUIRED` (400), `IDEMPOTENCY_KEY_INVALID` (400),
 * `IDEMPOTENT_REQUEST_IN_PROGRESS` (409, carrying `Retry-After`) and
 * `PLEDGE_MODIFIED` (409). See `./failure` for what each of them means here.
 */
export async function createPledgeDraft(
  body: DraftPledgeRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PledgeResponse> {
  return readPledge(
    await authorizedFetch('/v1/pledges/draft', {
      method: 'POST',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(body),
      signal,
    }),
  );
}

/** The backer's own pledge. 404 for anybody else's. */
export async function getPledge(id: string, signal?: AbortSignal): Promise<PledgeResponse> {
  return readPledge(await authorizedFetch(`/v1/pledges/${encodeURIComponent(id)}`, { signal }));
}

/**
 * `DRAFT` → `CONFIRMED`: commits the reserved stock.
 *
 * NO MONEY MOVES HERE, in either the client or the service. §9.2 is explicit
 * that confirmation writes no ledger entry and charges nothing; collection is
 * phase 2, at campaign close, and it is #64 in epic #59. The confirmation screen
 * says so in as many words, because a backer who believes they have been charged
 * will budget for it.
 *
 * Refused with `RESERVATION_EXPIRED` (409) once the five minutes have elapsed and
 * `PLEDGE_NOT_DRAFT` (409) when the pledge has already moved on. The first is
 * recoverable and the checkout recovers from it; see `useCheckout`. So is
 * `PLEDGE_MODIFIED` (409), which is what §8.4's sweep expiring this draft in the
 * moment it is confirmed looks like from here.
 *
 * `cardVerified` on the response says whether §9.2's phase 1 happened. It is
 * `false` on everything this build can confirm, and the confirmation screen
 * reads it rather than asserting it.
 */
export async function confirmPledge(
  id: string,
  body: ConfirmPledgeRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PledgeResponse> {
  return readPledge(
    await authorizedFetch(`/v1/pledges/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(body),
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * The pledge manager — PATCH and DELETE /v1/pledges/{id} (#287)
 * ---------------------------------------------------------------------- */

/**
 * What §4.5's PL-09 lets a backer change.
 *
 * <h2>ABSENT AND NULL ARE DIFFERENT HERE, AND THE DIFFERENCE IS MONEY</h2>
 *
 * The endpoint takes JSON Merge-Patch semantics (RFC 7396) and `PatchPledgeRequest` on the
 * service is built out of a `Patched<T>` for exactly this reason. `"rewardTierId": null` gives
 * up the reward and makes the pledge support-only (PL-02); **leaving the key out keeps the
 * reward**. A client that sent every field on every save — which is what
 * `lib/fulfilment/api.ts` correctly does for a shipping address — would strip the reward off a
 * pledge whose backer only raised their contribution.
 *
 * TypeScript expresses the distinction the same way the wire does: an optional property that
 * is not set is absent, because `JSON.stringify` drops `undefined`. So a caller builds the
 * object with only the keys it means to change, and `editPledge` does not helpfully fill in
 * the rest.
 *
 * `shippingCountry: null` clears the destination, which is a real edit: a backer who drops the
 * posted item from their selection has nowhere for it to go, and reading that as "leave it
 * alone" would go on charging them postage for a download.
 *
 * `projectId` is not here and never will be. A pledge backs the campaign it was made for, so
 * moving it is not an edit. Neither is `referrerCode`: which link brought somebody is a fact
 * about how they arrived rather than a preference they can revise.
 */
export interface PledgeEdit {
  /** The new tier, or `null` for PL-02. Absent keeps the tier the pledge has. */
  rewardTierId?: string | null;
  /** The whole selection, replaced. An empty array removes every add-on. */
  addons?: readonly PledgeAddon[];
  /** Tier price plus PL-03's bonus, or the whole of a support-only pledge. */
  contribution?: Money;
  /** ISO 3166-1 alpha-2, or `null` to clear it. */
  shippingCountry?: string | null;
  isAnonymous?: boolean;
  paymentMethodId?: string | null;
}

/**
 * §4.5's PL-09 — `PATCH /v1/pledges/{id}`.
 *
 * **The whole pledge comes back, not the fields that changed**, and the caller replaces its
 * copy with it rather than merging. On this endpoint the total is what somebody is about to be
 * charged, and a client that merged a partial response would keep a stale one.
 *
 * Two things decide whether an edit is allowed, and they are owned by two different modules
 * (`PledgeService#requireEditable` composes them):
 *
 *   - the **pledge's** state is `DRAFT` or `CONFIRMED` — anything else is
 *     `PLEDGE_NOT_EDITABLE` (409), carrying `meta.state`;
 *   - the **campaign** is live and before its deadline — anything else is `PROJECT_NOT_LIVE`
 *     (409), carrying `meta.deadline`, which is the same code and body the draft endpoint
 *     gives, so one fact has one answer wherever it is asked.
 *
 * And IDN-EXT-01 (#35) adds one rule of its own: a `CONFIRMED` pledge may only be raised. An edit
 * that would lower its total is `PLEDGE_DECREASE_NOT_ALLOWED` (409), carrying `meta.current` and
 * `meta.requested`. There is no cancel call here any more — a backer cannot withdraw a pledge.
 *
 * A draft whose five minutes have run out is `RESERVATION_EXPIRED` (409): editing it would
 * re-price a place the tier has already promised to give back. Every one of these is worded
 * for a backer in `./failure`.
 *
 * `Idempotency-Key` is required, as it is on every payment mutation (§10.3). See
 * `./idempotency` for why the caller owns the key rather than this function minting one.
 */
export async function editPledge(
  id: string,
  edit: PledgeEdit,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PledgeResponse> {
  return readPledge(
    await authorizedFetch(`/v1/pledges/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: mutationHeaders(idempotencyKey),
      /*
       * `JSON.stringify` drops an `undefined` value, so a key the caller did not set is a key
       * the service never sees — which is precisely Merge-Patch's "leave this alone". Nothing
       * here normalises or back-fills, because both would turn an absence into an instruction.
       */
      body: JSON.stringify(edit),
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * Still to come. This is a function in THIS module, not a new client.
 *
 *   #55  the card                POST /v1/payment-methods, and a real
 *                                `paymentMethodId` on the confirm body
 * ---------------------------------------------------------------------- */
