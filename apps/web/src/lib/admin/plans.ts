import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { BillingPeriod, Plan } from '../plans/api';
import type { PlanTranslations } from '@ideanest/plans/catalogue';
import type { PaymentMethod } from './revenue';

/**
 * AD-11's second half: what the platform charges a creator to publish.
 *
 * <h2>Filed under AD-11 rather than a seventeenth module</h2>
 *
 * §4.11's table has sixteen rows and the fee editor is the one about what the platform
 * charges. A fee comes out of a backer's pledge and this comes out of a creator's pocket, so
 * it is the same authority over the same subject — `lib/admin/navigation.ts` files it under
 * AD-11 the way `/admin/staff` is filed under AD-04, and a seventeenth row would make the
 * console and the specification disagree about how many modules there are.
 *
 * <h2>A plan is edited in place, which the fee schedule beside it is not</h2>
 *
 * That difference is worth carrying, because the two screens look alike and behave
 * oppositely. A rate may not be edited: a payout was priced against it, and §22.1 asks what
 * the rate was in March with a seven-year retention rule attached. A plan may be, because
 * what a subscriber was charged is copied onto their own subscription at purchase — so
 * editing a plan cannot reach backwards into anybody's bill.
 *
 * <p>What it does reach is the limits of everybody currently on the plan, which are read live.
 * The screen says so, because an operator lowering a limit should know who it applies to.
 *
 * <h2>There is no delete</h2>
 *
 * A plan leaves the catalogue by being unlisted. The service refuses a delete against any
 * plan anybody has ever bought, and a plan nobody bought is one nobody misses when it is
 * taken off sale.
 *
 * <h2>Money is a string, both ways</h2>
 *
 * `"19.00"`, never `19`. A JSON number is an IEEE 754 double in every mainstream parser.
 */

export type { Plan, BillingPeriod } from '../plans/api';
export type { PlanText, PlanTranslations } from '@ideanest/plans/catalogue';
export type { PaymentMethod } from './revenue';

/** The ways a plan can be paid that staff record, in the order the form offers them. */
export const PLAN_PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'] as const;

export type SubscriptionState = 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELED' | 'EXPIRED';

export interface PlanCatalogue {
  readonly plans: readonly Plan[];
}

/** One row of the console's subscription list. */
export interface ConsoleSubscription {
  readonly id: string;
  readonly accountId: string;
  readonly state: SubscriptionState;
  /** The state and the clock together. Branch on this, never on `state` alone. */
  readonly entitled: boolean;
  readonly planCode?: string | null;
  readonly planName?: string | null;
  readonly price: string;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
  readonly startedAt?: string | null;
  readonly currentPeriodEnd?: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly activatedBy?: string | null;
  readonly note?: string | null;
  readonly createdAt: string;
}

export interface ConsoleSubscriptionList {
  readonly subscriptions: readonly ConsoleSubscription[];
}

/** Every plan, listed or not. The unlisted ones are the point of the console's own read. */
export async function readPlanCatalogue(signal?: AbortSignal): Promise<PlanCatalogue> {
  const response = await authorizedFetch('/v1/admin/plans', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PlanCatalogue;
}

export interface AddPlanRequest {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  /** Every language but Azerbaijani, which is `name` and `description`. */
  readonly translations: PlanTranslations;
  readonly price: string;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
  readonly maxActiveCampaigns: number | null;
  readonly goalCeiling: string | null;
  readonly sortOrder: number;
  readonly signal?: AbortSignal;
}

/** Adds a plan. It is on sale from the moment it is written. */
export async function addPlan(request: AddPlanRequest): Promise<Plan> {
  const response = await authorizedFetch('/v1/admin/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: request.code,
      name: request.name,
      description: request.description,
      translations: request.translations,
      price: request.price,
      currency: request.currency,
      billingPeriod: request.billingPeriod,
      maxActiveCampaigns: request.maxActiveCampaigns,
      goalCeiling: request.goalCeiling,
      sortOrder: request.sortOrder,
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Plan;
}

/**
 * A change to a plan. Omitted means "leave it alone".
 *
 * <p><strong>Removing a limit needs its own flag.</strong> `null` already means "leave it
 * alone" on this endpoint, and a plan with no ceiling is a plan whose ceiling is null — two
 * meanings for one absent field is the ambiguity that makes a PATCH untestable. So
 * `clearMaxActiveCampaigns` and `clearGoalCeiling` say which the caller meant.
 */
export interface ChangePlanRequest {
  readonly planId: string;
  readonly name?: string;
  readonly description?: string;
  /** Replaces every translation: a language left out is read in Azerbaijani from then on. */
  readonly translations?: PlanTranslations;
  readonly price?: string;
  readonly currency?: string;
  readonly maxActiveCampaigns?: number;
  readonly clearMaxActiveCampaigns?: boolean;
  readonly goalCeiling?: string;
  readonly clearGoalCeiling?: boolean;
  readonly listed?: boolean;
  readonly sortOrder?: number;
  readonly signal?: AbortSignal;
}

export async function changePlan(request: ChangePlanRequest): Promise<Plan> {
  const { planId, signal, ...body } = request;

  const response = await authorizedFetch(`/v1/admin/plans/${planId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Plan;
}

/**
 * Who is on what.
 *
 * @param awaitingPayment the queue rather than the archive. The screen opens on the queue,
 *   because that is the only part of this that is somebody's work.
 */
export async function readSubscriptions(
  awaitingPayment: boolean,
  signal?: AbortSignal,
): Promise<ConsoleSubscriptionList> {
  const response = await authorizedFetch(`/v1/admin/subscriptions?awaitingPayment=${awaitingPayment}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as ConsoleSubscriptionList;
}

/**
 * What staff say about a payment that arrived for a subscription.
 *
 * @param method how it was paid. The service defaults to a bank transfer when it is absent, which is
 *   why the console always sends it: a cash payment recorded as a transfer is a wrong revenue report
 * @param receivedAt when the money arrived, as an instant. Absent means now
 * @param reference the transfer or invoice number, which the service keeps on the payment itself
 */
export interface ActivateSubscriptionRequest {
  readonly method: PaymentMethod;
  readonly receivedAt?: string;
  readonly reference?: string;
  readonly note?: string;
}

/**
 * Records that a subscription's payment arrived, which is what starts the entitlement.
 *
 * <p>A card payment on the provider's page records itself (#449); this is every other way a plan is
 * paid, and the action is audited under the name of whoever recorded it.
 */
export async function activateSubscription(
  subscriptionId: string,
  request: ActivateSubscriptionRequest,
  signal?: AbortSignal,
): Promise<ConsoleSubscription> {
  const response = await authorizedFetch(`/v1/admin/subscriptions/${subscriptionId}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: request.method,
      ...(request.receivedAt === undefined ? {} : { receivedAt: request.receivedAt }),
      ...(request.reference === undefined ? {} : { reference: request.reference }),
      ...(request.note === undefined ? {} : { note: request.note }),
    }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as ConsoleSubscription;
}

/**
 * The instant to record for money that arrived on a Baku calendar day: now when the day is today,
 * otherwise noon in Baku that day, which no zone can move into a neighbouring day or month.
 */
export function receivedAtFor(day: string, today: string, now: Date = new Date()): string | undefined {
  if (day === today) return undefined;
  const at = new Date(`${day}T12:00:00+04:00`);
  return Number.isNaN(at.getTime()) || at.getTime() > now.getTime() ? undefined : at.toISOString();
}

/** Ends a subscription outright — a reversed payment, a fraud finding, a mistake. */
export async function cancelSubscriptionAsStaff(
  subscriptionId: string,
  reason: string,
  signal?: AbortSignal,
): Promise<ConsoleSubscription> {
  const response = await authorizedFetch(`/v1/admin/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as ConsoleSubscription;
}
