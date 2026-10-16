import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * Plan payments to return — issue #457, a follow-up to epic #448.
 *
 * <p>A card payment for a creator plan that arrives after the subscription has ended (staff ended
 * it, or it was replaced) cannot be applied to anything. The service marks it `UNAPPLIED`, and the
 * money has to go back to the creator: to the card while the provider still takes a refund, by a
 * bank transfer staff make and record after that.
 *
 * <p>Its own module rather than more of `refunds.ts`, for `refund-bank-transfers.ts`'s reason:
 * `refunds.ts` is read by every screen that lists a pledge's refunds, and this is used by one.
 *
 * <p>The list is `VIEW_FINANCE`; both writes are `ISSUE_REFUND`. The service refuses a write with a
 * `code` the console words itself (`PlanRefundRefusedException`): `PLAN_REFUND_NOT_FOUND`,
 * `PLAN_REFUND_NOT_UNAPPLIED`, `PLAN_REFUND_CARD_WINDOW_CLOSED`, `PLAN_REFUND_PROVIDER_REFUSED`
 * and 503 `PLAN_REFUND_PROVIDER_UNAVAILABLE`.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** One payment waiting to be returned, as the service sends it. */
export interface UnappliedPlanPayment {
  readonly id: string;
  readonly subscriptionId: string;
  /** The creator who paid. */
  readonly accountId: string;
  /** A decimal string, as money is everywhere in this API. Never a number. */
  readonly amount: string;
  readonly currency: string;
  readonly provider: string;
  /** The provider's order, the value somebody quotes into a conversation with the provider. */
  readonly providerTransactionId: string;
  readonly paidAt: string;
  /** When the provider stops taking a refund to the card; null when it names no window. */
  readonly cardRefundUntil: string | null;
  /**
   * When a card refund was sent and its answer never arrived. While it is set the money may already be
   * on its way back: the bank transfer is refused, and the card refund asks the provider before it
   * sends anything again. Absent otherwise.
   */
  readonly cardRefundStartedAt?: string | null;
}

export interface UnappliedPlanPaymentList {
  readonly payments: UnappliedPlanPayment[];
}

/** The amount as the money helpers take it: the service's string and currency, untouched. */
export function planPaymentAmount(payment: UnappliedPlanPayment): Money {
  return { amount: payment.amount, currency: payment.currency };
}

/**
 * Whether the provider still takes a refund to the card.
 *
 * <p>No window is treated as open: the service names none when the provider does not say, and a
 * refusal from the provider is the answer in that case, not a guess here. The service checks the
 * window again on the write and refuses with `PLAN_REFUND_CARD_WINDOW_CLOSED`, so a page left open
 * past the deadline cannot send a refund the provider would refuse.
 */
export function cardWindowOpen(payment: UnappliedPlanPayment, now: Date = new Date()): boolean {
  if (payment.cardRefundUntil == null) return true;
  return new Date(payment.cardRefundUntil).getTime() > now.getTime();
}

/** What is waiting to be returned, oldest first. */
export async function listUnappliedPlanPayments(signal?: AbortSignal): Promise<UnappliedPlanPaymentList> {
  const response = await authorizedFetch('/v1/admin/plan-payments/unapplied', { cache: 'no-store', signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as UnappliedPlanPaymentList;
}

/**
 * Refunds the whole payment to the card that paid it, through the provider.
 *
 * <p>No body and no idempotency key: the payment itself is the key. The service claims the payment
 * under a lock before it asks the provider, sends every attempt under the same key, and on a retry of
 * an attempt nobody answered asks the provider whether the money already went back before sending
 * anything — so a second press never refunds twice. `PLAN_REFUND_UNCONFIRMED` is that unanswered
 * attempt, and `PLAN_REFUND_IN_PROGRESS` a press while one may still be running.
 */
export async function refundPlanPaymentToCard(id: string, signal?: AbortSignal): Promise<UnappliedPlanPayment> {
  const response = await authorizedFetch(`/v1/admin/plan-payments/${encodeURIComponent(id)}/refund`, {
    method: 'POST',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as UnappliedPlanPayment;
}

export interface RecordPlanPaymentTransferRequest {
  /** The bank's reference for the transfer that returned the money. At most 200 characters. */
  readonly bankReference: string;
  /** Anything the next reader needs. At most 500 characters; absent for none. */
  readonly note?: string;
  readonly signal?: AbortSignal;
}

/** Records that the money went back by bank transfer, which settles the payment. */
export async function recordPlanPaymentBankTransfer(
  id: string,
  request: RecordPlanPaymentTransferRequest,
): Promise<UnappliedPlanPayment> {
  const response = await authorizedFetch(`/v1/admin/plan-payments/${encodeURIComponent(id)}/bank-transfer`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      bankReference: request.bankReference,
      ...(request.note === undefined ? {} : { note: request.note }),
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as UnappliedPlanPayment;
}
