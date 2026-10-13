import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { localeOrDefault, type Locale } from '../i18n/locale';
import type { HeldSubscription, MySubscription, PlanPaymentReturnHint } from '@ideanest/plans/catalogue';

/**
 * What the platform charges a creator to publish, and what one account holds.
 *
 * <h2>Money is a string here and stays one</h2>
 *
 * `"19.00"` and not `19`. §10.3 and CLAUDE.md: a JSON number is an IEEE 754 double in every
 * mainstream parser, and 19.90 is not representable in one. Nothing on the pricing page does
 * arithmetic with a price — it formats one — so the string travels intact to
 * `Intl.NumberFormat` and no `decimal.js` is needed. The moment something here adds two
 * prices together, it uses `decimal.js`, which is what CLAUDE.md requires of the frontend.
 *
 * <h2>`null` means "no limit", exactly as it does on the wire</h2>
 *
 * Not `0`, and not a large number. The service is deliberate about this and the client keeps
 * the convention rather than normalising it at the edge: a page that turned `null` into
 * `Infinity` would be one place away from rendering "up to Infinity campaigns".
 *
 * <h2>`entitled` is the field to branch on</h2>
 *
 * Not `state`. An `ACTIVE` subscription whose period ended an hour ago entitles nobody, and
 * the service computes the pair for exactly that reason. A page deriving it from `state` and
 * `currentPeriodEnd` would get the boundary wrong once, on a page about money.
 */

// The wire types are `@ideanest/plans`' (#164), so the app reads the same shapes.
export type {
  BillingPeriod,
  Catalogue,
  HeldSubscription,
  MySubscription,
  PaymentDue,
  Plan,
  PlanPaymentReturn,
  PlanPaymentReturnHint,
  SubscriptionState,
} from '@ideanest/plans/catalogue';

/**
 * What this account holds, or nothing.
 *
 * <p>A 200 with a null subscription is the ordinary case for a signed-in visitor who has not
 * bought anything, so this returns `{ subscription: null }` rather than throwing.
 */
export async function readMySubscription(signal?: AbortSignal): Promise<MySubscription> {
  const response = await authorizedFetch('/v1/me/subscription', { signal });
  if (!response.ok) throw await errorFrom(response);

  return normaliseMine((await response.json()) as { subscription?: HeldSubscription | null });
}

/**
 * `subscription` as `null`, never `undefined`.
 *
 * A body that omits the key — an intermediary that drops a JSON `null`, a future response
 * that forgets the field — must not read as "held", which is what `undefined` would do at
 * every `held !== null` check in `PlanChooser`. Coercing here keeps that check sufficient
 * rather than requiring `!= null` everywhere the value is read.
 */
function normaliseMine(body: { subscription?: HeldSubscription | null }): MySubscription {
  return { subscription: body.subscription ?? null };
}

/**
 * Buys a plan.
 *
 * <p>What comes back is not necessarily an entitlement. A priced plan arrives
 * `PENDING_PAYMENT` with `entitled: false`, and opens when it is paid — by card through
 * {@link payForPlan}, or by a bank transfer staff record (#449). The caller renders what it is given
 * rather than assuming a purchase succeeded.
 */
export async function subscribeToPlan(planId: string, signal?: AbortSignal): Promise<MySubscription> {
  const response = await authorizedFetch('/v1/me/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return normaliseMine((await response.json()) as { subscription?: HeldSubscription | null });
}

/**
 * Cancels: keeps the period that was paid for, stops the renewal.
 *
 * <p>The response carries the date the entitlement actually stops, which is the one thing the
 * creator wants to know and cannot work out from the request.
 */
export async function cancelSubscription(signal?: AbortSignal): Promise<MySubscription> {
  const response = await authorizedFetch('/v1/me/subscription', { method: 'DELETE', signal });
  if (!response.ok) throw await errorFrom(response);

  return normaliseMine((await response.json()) as { subscription?: HeldSubscription | null });
}

/** Where the provider sends the creator back to, and the language its page is drawn in. */
export interface PlanPaymentRequest {
  readonly language: Locale;
  readonly successUrl: string;
  readonly errorUrl: string;
}

/** Where to send the browser to pay. Nothing has been paid when this arrives. */
export interface PlanPaymentPage {
  readonly providerTransactionId: string;
  readonly redirectUrl: string;
}

/**
 * Opens the provider's page for whatever the caller owes now — #449.
 *
 * <p>The first period of a pending plan, or the next period of one inside its renewal window: the
 * service decides which, and answers `409 SUBSCRIPTION_PAYMENT_NOT_DUE` with a `reason` when it is
 * neither. `Idempotency-Key` is required, as on every payment mutation (§10.3), and the caller owns
 * it: one key per press of the button, so a retried request answers with the page the first one
 * opened rather than opening a second.
 */
export async function payForPlan(
  body: PlanPaymentRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PlanPaymentPage> {
  const response = await authorizedFetch('/v1/me/subscription/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PlanPaymentPage;
}

/**
 * Where the provider returns the creator: the pricing page, in the language it was read in, with
 * `?payment=` saying which door they came through — the same shape as a pledge's return
 * (`lib/pledges/payment.ts`). The word is a hint and not a fact: the provider's callback is what
 * opens the period, and it can land before or after the browser, so the page re-reads the
 * subscription rather than believing the address.
 *
 * <p>`from` and `project` are carried through when a refused submission sent the creator here, so
 * the banner and the way back to their campaign survive the trip to the provider. Absolute URLs,
 * because the provider redirects from its own domain; `localePrefix` is `always`, so the first path
 * segment is the locale.
 */
export function planPaymentReturnFor(
  fromProjectId?: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): PlanPaymentRequest {
  const language = localeOrDefault(location.pathname.split('/')[1]);
  const page = `${location.origin}/${language}/pricing`;
  const from =
    fromProjectId === undefined ? '' : `from=submit&project=${encodeURIComponent(fromProjectId)}&`;
  return {
    language,
    successUrl: `${page}?${from}payment=returned`,
    errorUrl: `${page}?${from}payment=failed`,
  };
}

/** What `?payment=` may say. Anything else is not a return from the payment page. */
export function planPaymentReturnHint(search: string): PlanPaymentReturnHint | null {
  const value = new URLSearchParams(search).get('payment');
  return value === 'returned' || value === 'failed' ? value : null;
}

/**
 * A price with its currency, in the reader's language.
 *
 * <strong>Display only.</strong> Nothing here computes with a price — it renders one — so
 * `Number` is safe in a way it would not be if two of these were being added together.
 * Falls back to the raw string when the amount is not a number, which is what a service that
 * sent something unexpected deserves: the reader sees the value rather than `NaN`.
 */
export function formatPrice(amount: string, currency: string, locale: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return `${amount} ${currency}`;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Whole manat when the price is whole, which every plan's is: "19 ₼" reads as a price
      // and "19.00 ₼" reads as an invoice line.
      minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(parsed);
  } catch {
    // An unknown currency code throws rather than degrading, and a price list that renders
    // nothing is worse than one that renders "19 XYZ".
    return `${amount} ${currency}`;
  }
}
