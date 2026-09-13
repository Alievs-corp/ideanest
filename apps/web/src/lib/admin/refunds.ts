import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * §4.11's AD-06: sending money back — issues #67 and #307.
 *
 * <h2>The idempotency key is generated here and is not optional</h2>
 *
 * The service requires an `Idempotency-Key` header on the write, which is stricter than
 * most of §10.2 and is the right way round: a refund is the one mutation where a duplicate
 * is money leaving twice and where — unlike a duplicate charge — nobody complains about it.
 *
 * <strong>The key is made once per attempt and reused across retries of that attempt.</strong>
 * A key generated inside the request function would be a new key on every retry, which is
 * exactly the same as having none. `newRefundKey` is called by the screen when somebody
 * opens the form, and travels with the form's state.
 *
 * <h2>A null amount means "the rest of it"</h2>
 *
 * Not a `full` flag beside a number. The two can disagree: a console that computed the full
 * amount from a page loaded before an earlier partial refund would send a figure that is
 * both "full" and too large. Null makes the service compute it from the row it has locked.
 */

/** §9.7's reason codes, as the service names them. The countable half of a refund. */
export type RefundReason =
  | 'BACKER_REQUEST'
  | 'CAMPAIGN_HALTED'
  | 'CAMPAIGN_FAILED'
  | 'FULFILMENT_FAILURE'
  | 'DUPLICATE_CHARGE'
  | 'PLATFORM_ERROR'
  | 'DISPUTE_CONCEDED'
  | 'FRAUD';

/** Where a refund has got to. `REQUESTED` is the one worth watching. */
export type RefundState = 'REQUESTED' | 'SUCCEEDED' | 'FAILED';

export interface Refund {
  id: string;
  pledgeId: string;
  projectId: string;
  chargeTransactionId?: string | null;
  /** The provider call that carried it out. Absent until there has been one. */
  refundTransactionId?: string | null;
  amount: Money;
  fullRefund: boolean;
  reason: RefundReason;
  detail: string;
  state: RefundState;
  failureCode?: string | null;
  failureMessage?: string | null;
  /** The staff account that issued it; absent for a refund the platform issued itself (#40). */
  requestedBy?: string | null;
  requestedAt: string;
  settledAt?: string | null;
}

export interface RefundPage {
  refunds: Refund[];
  page: number;
  /** Inferred from a full page rather than a count — see the service's own note on why. */
  hasMore: boolean;
}

/** What each reason means, in the words the console uses. */
/*
 * The eight reason codes read as sentences on the screen — "The backer asked" — and those
 * sentences are `admin.screens.refunds.reason` since #324. The form offers them in the order
 * the union declares, which is what {@link REFUND_REASONS} is for.
 */
export const REFUND_REASONS: readonly RefundReason[] = Object.freeze([
  'BACKER_REQUEST',
  'CAMPAIGN_HALTED',
  'CAMPAIGN_FAILED',
  'FULFILMENT_FAILURE',
  'DUPLICATE_CHARGE',
  'PLATFORM_ERROR',
  'DISPUTE_CONCEDED',
  'FRAUD',
]);

/**
 * A key for one refund attempt.
 *
 * `crypto.randomUUID` rather than a timestamp or a counter: the service stores it with a
 * unique index across the whole table, so two staff members composing a refund in the same
 * millisecond must not collide. It is available in every browser this platform supports and
 * needs no polyfill.
 */
export function newRefundKey(): string {
  return `refund-${crypto.randomUUID()}`;
}

export interface RefundListRequest {
  readonly state?: RefundState | null;
  readonly page?: number;
  readonly signal?: AbortSignal;
}

/** AD-06's list, newest first. */
export async function listRefunds(request: RefundListRequest = {}): Promise<RefundPage> {
  const parameters = new URLSearchParams();
  if (request.state != null) parameters.set('state', request.state);
  parameters.set('page', String(request.page ?? 0));

  const response = await authorizedFetch(`/v1/admin/refunds?${parameters}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RefundPage;
}

/** Every refund against one pledge, for the conversation behind it. */
export async function refundsForPledge(pledgeId: string, signal?: AbortSignal): Promise<RefundPage> {
  const response = await authorizedFetch(
    `/v1/admin/refunds/by-pledge/${encodeURIComponent(pledgeId)}`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RefundPage;
}

export interface IssueRefundRequest {
  readonly pledgeId: string;
  /** Null sends the rest of what is left. See the module comment. */
  readonly amount: Money | null;
  readonly reason: RefundReason;
  readonly detail: string;
  /** From {@link newRefundKey}, held across retries of one attempt. */
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}

/** Sends money back. */
export async function issueRefund(request: IssueRefundRequest): Promise<Refund> {
  const response = await authorizedFetch('/v1/admin/refunds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': request.idempotencyKey,
    },
    body: JSON.stringify({
      pledgeId: request.pledgeId,
      amount: request.amount,
      reason: request.reason,
      detail: request.detail,
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Refund;
}
