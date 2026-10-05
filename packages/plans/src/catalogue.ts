import Decimal from 'decimal.js';

/**
 * What the platform charges a creator to publish, and what one account holds — the wire types of
 * `GET /v1/plans` and `/v1/me/subscription`, and the rules both clients read them by (#164).
 *
 * <h2>Money is a string here and stays one</h2>
 *
 * `"19.00"` and not `19`. CLAUDE.md: a JSON number is an IEEE 754 double in every mainstream
 * parser, and a price that became one would be formatted from a value the service never sent. The
 * one comparison either client makes — is this plan free — goes through `decimal.js`
 * ({@link isFreePrice}).
 *
 * <h2>`null` means "no limit", exactly as it does on the wire</h2>
 *
 * Not `0`, and not a large number: a page that turned `null` into `Infinity` would be one step
 * from rendering "up to Infinity campaigns".
 *
 * <h2>`entitled` is the field to branch on</h2>
 *
 * Not `state`. An `ACTIVE` subscription whose period ended an hour ago entitles nobody, and the
 * service computes the pair for exactly that reason.
 */

export type BillingPeriod = 'MONTHLY' | 'YEARLY';

export type SubscriptionState = 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELED' | 'EXPIRED';

export interface Plan {
  readonly id: string;
  /** Stable, upper case. What an operator and a support conversation agree on. */
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  /** A decimal amount, as text. */
  readonly price: string;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
  /** How many campaigns at once. `null` means no limit. */
  readonly maxActiveCampaigns?: number | null;
  /** The largest goal a campaign may be submitted with, as text. `null` means none. */
  readonly goalCeiling?: string | null;
  readonly listed: boolean;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface HeldSubscription {
  readonly id: string;
  readonly state: SubscriptionState;
  /** The state and the clock together. Branch on this. */
  readonly entitled: boolean;
  /** The plan as it stands now, so a page can say what the subscription currently allows. */
  readonly plan: Plan;
  /** What this account was charged, which may differ from what the plan costs today. */
  readonly price: string;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
  readonly startedAt?: string | null;
  readonly currentPeriodEnd?: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly createdAt: string;
}

export interface Catalogue {
  readonly plans: readonly Plan[];
}

/** The answer to "what do I hold", including when the answer is nothing. */
export interface MySubscription {
  readonly subscription: HeldSubscription | null;
}

const BILLING_PERIODS: readonly string[] = ['MONTHLY', 'YEARLY'];
const STATES: readonly string[] = ['PENDING_PAYMENT', 'ACTIVE', 'CANCELED', 'EXPIRED'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isDecimal(value: string): boolean {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

/**
 * One plan, or `null` for a body a page cannot draw a price from.
 *
 * <p>The id, the name, a decimal price, a currency and a billing period are required: without any
 * one of them the card would print a price with nothing to say what it buys, or a button that
 * subscribes to nothing. The rest default to what the service means by their absence.
 */
export function readPlan(body: unknown): Plan | null {
  if (!isObject(body)) return null;
  const id = text(body.id);
  const name = text(body.name);
  const price = text(body.price);
  const currency = text(body.currency);
  const period = body.billingPeriod;
  if (id === null || name === null || price === null || currency === null) return null;
  if (!isDecimal(price)) return null;
  if (typeof period !== 'string' || !BILLING_PERIODS.includes(period)) return null;

  // Absent or null is "no limit"; a value that is present and unreadable is not a limit to print.
  const ceiling = body.goalCeiling ?? null;
  if (ceiling !== null && (typeof ceiling !== 'string' || !isDecimal(ceiling))) return null;
  const campaigns = body.maxActiveCampaigns ?? null;
  if (campaigns !== null && (typeof campaigns !== 'number' || !Number.isInteger(campaigns) || campaigns < 0)) {
    return null;
  }
  return {
    id,
    code: text(body.code) ?? '',
    name,
    description: optionalText(body.description),
    price,
    currency,
    billingPeriod: period as BillingPeriod,
    maxActiveCampaigns: campaigns,
    goalCeiling: ceiling,
    listed: body.listed !== false,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
    updatedAt: text(body.updatedAt) ?? '',
  };
}

/**
 * The plans on sale, in the service's order, or `null` when the body is not a catalogue.
 *
 * <p>A malformed entry is dropped rather than failing the list: one card the service sent wrong is
 * not a reason to tell a creator there are no plans. A body without a `plans` array is a failure,
 * never an empty catalogue — "there are no plans on sale" is a statement about the platform.
 */
export function readPlanCatalogue(body: unknown): readonly Plan[] | null {
  if (!isObject(body) || !Array.isArray(body.plans)) return null;
  return body.plans.flatMap((entry) => {
    const plan = readPlan(entry);
    return plan === null ? [] : [plan];
  });
}

/**
 * What an account holds, or `null` for a body that does not say.
 *
 * <p>`subscription` absent or `null` is the ordinary answer for somebody who has bought nothing and
 * reads as nothing held. A subscription whose state, entitlement or plan cannot be read is a body
 * this page cannot render a decision from — never "nothing held", which would offer a plan to
 * somebody who already has one.
 */
export function readMine(body: unknown): MySubscription | null {
  if (!isObject(body)) return null;
  const held = body.subscription;
  if (held === undefined || held === null) return { subscription: null };
  if (!isObject(held)) return null;

  const id = text(held.id);
  const state = held.state;
  const plan = readPlan(held.plan);
  if (id === null || plan === null) return null;
  if (typeof state !== 'string' || !STATES.includes(state)) return null;
  if (typeof held.entitled !== 'boolean') return null;

  const period = held.billingPeriod;
  return {
    subscription: {
      id,
      state: state as SubscriptionState,
      entitled: held.entitled,
      plan,
      price: text(held.price) ?? plan.price,
      currency: text(held.currency) ?? plan.currency,
      billingPeriod:
        typeof period === 'string' && BILLING_PERIODS.includes(period)
          ? (period as BillingPeriod)
          : plan.billingPeriod,
      startedAt: optionalText(held.startedAt),
      currentPeriodEnd: optionalText(held.currentPeriodEnd),
      cancelAtPeriodEnd: held.cancelAtPeriodEnd === true,
      createdAt: text(held.createdAt) ?? '',
    },
  };
}

/** Whether a price is zero — through `decimal.js`, never `Number(price) === 0`. */
export function isFreePrice(price: string): boolean {
  try {
    return new Decimal(price).isZero();
  } catch {
    return false;
  }
}

/**
 * Where a holder stands, as the four sentences the page says.
 *
 * <ul>
 *   <li>`pending` — chosen and not yet paid for: a `warning`, never a green tick.</li>
 *   <li>`lapsed` — held and no longer entitling.</li>
 *   <li>`ending` — entitling, and will not renew.</li>
 *   <li>`active` — entitling, and renews.</li>
 * </ul>
 */
export type HeldStanding = 'pending' | 'lapsed' | 'ending' | 'active';

export function standingOf(held: HeldSubscription): HeldStanding {
  if (held.state === 'PENDING_PAYMENT') return 'pending';
  if (!held.entitled) return 'lapsed';
  if (held.cancelAtPeriodEnd) return 'ending';
  return 'active';
}

/**
 * Whether a held subscription rules out choosing another plan: anything but a cancelled one. The
 * service refuses a second plan with `ALREADY_SUBSCRIBED`, and a button that is certain to be
 * refused is not offered.
 */
export function blocksChoice(held: HeldSubscription | null): boolean {
  return held !== null && held.state !== 'CANCELED';
}

/** Whether the plan on this card is the one held (and not cancelled). */
export function isHeldPlan(held: HeldSubscription | null, planId: string): boolean {
  return held !== null && held.plan.id === planId && held.state !== 'CANCELED';
}

/** A refused choice or cancellation, as the catalogue key under `pricing.errors` that says it. */
export type SubscriptionRefusal = 'alreadySubscribed' | 'notOnSale' | 'signedOut' | 'generic';

/**
 * The refusal's sentence, from the problem's `code` and the status — never from its prose, which
 * is in one language while the page is drawn in four (§10.4).
 */
export function refusalOf(status: number | null, code: string | null | undefined): SubscriptionRefusal {
  if (code === 'ALREADY_SUBSCRIBED') return 'alreadySubscribed';
  if (code === 'PLAN_NOT_ON_SALE') return 'notOnSale';
  if (status === 401) return 'signedOut';
  return 'generic';
}
