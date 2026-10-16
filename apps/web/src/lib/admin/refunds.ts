import Decimal from 'decimal.js';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { toMoney, type Money } from '../money';

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
  | 'FRAUD'
  /*
   * #171: a raise the backer paid for that could not be applied, refunded by the platform on its
   * own. Listed so the console can name it; not offered in the form, because no member of staff
   * issues it.
   */
  | 'RAISE_NOT_APPLIED'
  /*
   * #175: a chargeback lost or conceded, recorded so no other refund pays the same money again.
   * Written by the dispute itself; the service refuses it from the form, so it is not offered.
   */
  | 'CHARGEBACK';

/**
 * Where a refund has got to. `REQUESTED` is the one worth watching.
 *
 * #399's two: a refund past the provider's refund window is paid by bank transfer, and waits
 * first for support to record the backer's account (`AWAITING_BANK_DETAILS`) and then for
 * finance to make and record the transfer (`AWAITING_TRANSFER`).
 */
export type RefundState =
  | 'REQUESTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'AWAITING_BANK_DETAILS'
  | 'AWAITING_TRANSFER';

/**
 * The bank transfer behind a refund, as the list shows it — #399.
 *
 * The masked hint and never the number, and no holder name: the list is `VIEW_FINANCE`'s and is
 * not audited, so what identifies the account is read through `revealRefundBankDetails`, which
 * is. The transfer fields are absent until finance records the transfer.
 */
export interface RefundBankTransfer {
  ibanHint: string;
  ticketId: string;
  detailsRecordedBy: string;
  detailsRecordedAt: string;
  bankReference?: string | null;
  transferredOn?: string | null;
  transferRecordedBy?: string | null;
  transferRecordedAt?: string | null;
}

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
  /** Once support has recorded the account it is paid into; null before that and for a card refund. */
  bankTransfer?: RefundBankTransfer | null;
  /**
   * #436: the provider's fee this refund kept back from its charge — a refund for a campaign's
   * reason of a charge taken under that rule. Absent when nothing was kept back. `amount` is what
   * was sent; the two together are what it settled of the charge.
   */
  withheldFee?: Money | null;
  /** Whose money it is: the pledge's backer, for the directory to name. */
  backerId?: string | null;
  /**
   * The refused refund this one replaced by bank transfer (#399's fallback). The console words
   * the row from it rather than from `detail`, which the service writes in English.
   */
  routedFrom?: string | null;
  /** The chargeback a `CHARGEBACK` row records the loss of (#175). */
  disputeId?: string | null;
  /** On a refused refund: the bank-transfer refund it was routed to, and how far that has got. */
  routedTo?: { readonly id: string; readonly state: RefundState } | null;
  /**
   * On the issue response only, when the refund went in more than one part (one per charge,
   * #171): every part. The fields above describe the part that best says how it went.
   */
  parts?: Refund[] | null;
}

/** What a refund of a pledge could send now — the confirmation before one is issued. */
export interface RefundableAmount {
  pledgeId: string;
  reason: RefundReason;
  /** In the pledge's currency, net of {@link withheldFee}: what "the rest" means. */
  remaining: Money;
  /** The provider's fee a campaign's reason keeps back (#436). Zero for any other reason. */
  withheldFee: Money;
  projectId?: string | null;
  backerId?: string | null;
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

/** A pledge's identifier as the service issues it — checked before anything is sent. */
const PLEDGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPledgeId(value: string): boolean {
  return PLEDGE_ID.test(value.trim());
}

/**
 * A refund amount as typed into the form.
 *
 * <p>Blank is "the rest of it". A comma is read as the decimal mark, because the people typing it
 * write Azerbaijani numbers; at most two places, because that is what the service accepts, and
 * never zero. Anything else is refused here rather than sent — `"25,00"` used to reach the
 * service and come back as an English "Failed to read request".
 *
 * @returns the decimal string to send, `null` for "the rest", or `undefined` when it is not an amount
 */
export function refundAmountFrom(input: string): string | null | undefined {
  const typed = input.trim().replace(',', '.');
  if (typed === '') return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(typed)) return undefined;
  if (new Decimal(typed).isZero()) return undefined;
  return new Decimal(typed).toFixed(2);
}

/**
 * What an issued refund came to: the sum of its parts when it went in more than one (#171),
 * else its own amount. `decimal.js`, never numbers; one currency, the pledge's.
 */
export function issuedTotal(refund: Refund): Money {
  const parts = refund.parts ?? [];
  if (parts.length < 2) return refund.amount;
  const total = parts.reduce((sum, part) => sum.plus(part.amount.amount), new Decimal(0));
  return toMoney(total, refund.amount.currency);
}

/** What a refund of the pledge for this reason could send now. `ISSUE_REFUND`. */
export async function readRefundable(
  pledgeId: string,
  reason: RefundReason,
  signal?: AbortSignal,
): Promise<RefundableAmount> {
  const parameters = new URLSearchParams({ pledgeId, reason });
  const response = await authorizedFetch(`/v1/admin/refunds/refundable?${parameters}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RefundableAmount;
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
