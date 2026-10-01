import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * §4.11's AD-05: every charge, its provider reference, and why the refused ones were
 * refused — issue #304.
 *
 * <p><strong>A charge's "state history" is a list of rows and not a field on one.</strong>
 * §7.2 makes `transactions` append-only, so a call that was pending and later succeeded is
 * two rows sharing an idempotency key rather than one row that changed. Nothing in this
 * module updates anything, and there is no endpoint that could: V41 puts a trigger on the
 * table that raises on UPDATE and DELETE.
 */

/** §7.2's list. Only `CHARGE` is written today; the rest are in V41's check for later. */
export type TransactionType =
  | 'VERIFICATION'
  | 'CHARGE'
  | 'REFUND'
  | 'CHARGEBACK'
  | 'CHARGEBACK_REVERSAL'
  | 'PAYOUT';

/**
 * What the provider said, frozen at insert.
 *
 * `PENDING` means the provider accepted the instruction and had not decided. There is no
 * path out of it — a resolution is a new row — which is why {@link LoggedTransaction.attemptNumber}
 * and not the status is what tells one attempt from the next.
 */
export type TransactionStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/**
 * §9.3 requires at least two, so which one made a call is a fact about the row. `SANDBOX` only
 * ever appears on a developer's machine — #243, temporary.
 */
export type ProviderName = 'PAYRIFF' | 'EPOINT' | 'AZERICARD' | 'SANDBOX';

/**
 * An amount of money, as `lib/money.ts` already defines it.
 *
 * <p>Re-exported rather than redeclared. §10.3 makes the amount a <strong>string</strong>,
 * never a JSON number — a JSON number is an IEEE 754 double and cannot hold a pledge exactly
 * — and a second interface saying the same thing is a second place for somebody to eventually
 * type `amount: number`. On this surface that is not a formality: a payment log is read next
 * to a provider's own statement, and a figure that has been through a double disagrees with
 * it by a qapik nobody can account for.
 */
export type { Money } from '../money';

/** One call to a provider, and what it said. */
export interface LoggedTransaction {
  id: string;
  /** Absent on a payout, which is about a campaign and a creator rather than a pledge. */
  pledgeId?: string | null;
  projectId: string;
  type: TransactionType;
  status: TransactionStatus;
  /** Always positive. Direction is a property of {@link type}, never a sign. */
  amount: Money;
  provider: ProviderName;
  /**
   * The provider's own reference — the identifier a support conversation and a dispute are
   * both conducted in.
   *
   * Absent when the call never got an answer. A request that timed out before the provider
   * replied is still a row, because it may have charged somebody.
   */
  providerTransactionId?: string | null;
  /** The provider's vocabulary for a refusal. Absent on anything that did not fail. */
  failureCode?: string | null;
  failureMessage?: string | null;
  /** Which of §9.6's four attempts this was, counted from one. */
  attemptNumber: number;
  /** ISO-8601 instant, UTC. */
  createdAt: string;
}

export interface PaymentLogPage {
  /** Echoed, and absent when the request did not ask for it. See {@link PaymentLogRequest}. */
  pledgeId?: string | null;
  projectId?: string | null;
  /** Echoed in the spelling the column uses, so `?status=failed` comes back as `FAILED`. */
  status?: TransactionStatus | null;
  transactions: LoggedTransaction[];
  /**
   * Where the last row on this page sits, to send back as `after` — opaque, and treated as
   * opaque here.
   *
   * It used to be the last row's identifier and the contract documented it as a `uuid`. #412
   * made it a pair: the log is ordered by `createdAt`, which is the column the screen renders
   * and is not unique, so a position in it is an instant and a key together. Nothing on this
   * side reads it, which is why the shape change cost this file nothing — and is exactly why
   * the service encodes it rather than handing over two fields.
   */
  nextCursor?: string | null;
}

export const PAYMENT_PAGE_SIZE = 25;

/**
 * The three outcomes, in the order a reader thinks about them — issue #404.
 *
 * <p>Failures first, because they are why this screen is opened. `PENDING` last: it is the
 * rarest and the least final, and putting it between the two settled states would separate
 * them.
 */
export const TRANSACTION_STATUSES: readonly TransactionStatus[] = Object.freeze([
  'FAILED',
  'SUCCEEDED',
  'PENDING',
]);

/**
 * What the log may be narrowed by.
 *
 * <p>A pledge, a campaign, an outcome, or nothing. The first two are V41's indexes; the
 * third is V63's, added with this filter rather than before it.
 *
 * <h2>The outcome filter, and why the screen went without one</h2>
 *
 * <p>This comment used to say there was deliberately no filter on status, because "every
 * failed charge on the platform" is a real question with no index behind it and the screen
 * shows the status of every row it draws. #404 is what that cost: the log's own description
 * promises it includes rejected calls, failed provider calls are the main reason anybody
 * opens it, and they were the one view it could not select — so "the screen shows the status"
 * meant scrolling twenty-five successes to find one failure. The answer is the index.
 *
 * <p><strong>The outcome combines with the other two</strong>, unlike them with each other:
 * "what did this collection run leave behind" is a campaign and a status together, and the
 * campaign's own index serves it with the status as a filter step.
 *
 * <p><strong>A request naming both a pledge and a campaign is resolved to the pledge by the
 * service</strong>, which is the narrower question; the response echoes what it actually
 * applied. There is still deliberately no filter on provider, on type or on a date range —
 * `PaymentLogScope` on the service side records what each would cost.
 */
export interface PaymentLogRequest {
  pledgeId?: string | null;
  projectId?: string | null;
  status?: TransactionStatus | null;
  /** The previous page's `nextCursor`, verbatim. Never constructed here — see that field. */
  after?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export function paymentLogQuery(request: PaymentLogRequest): string {
  const params = new URLSearchParams();
  params.set('limit', String(request.limit ?? PAYMENT_PAGE_SIZE));
  if (request.pledgeId != null && request.pledgeId !== '') params.set('pledgeId', request.pledgeId);
  if (request.projectId != null && request.projectId !== '')
    params.set('projectId', request.projectId);
  if (request.status != null) params.set('status', request.status);
  if (request.after != null && request.after !== '') params.set('after', request.after);
  return params.toString();
}

/** One page of the log, newest first. */
export async function readPaymentLog(request: PaymentLogRequest = {}): Promise<PaymentLogPage> {
  const response = await authorizedFetch(`/v1/admin/payments?${paymentLogQuery(request)}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PaymentLogPage;
}

/*
 * The two label tables moved to `admin.screens.payments` with #324. They were English prose in
 * a module a client imports, and the values they were keyed by — the service's own type and
 * status — are what the catalogue is keyed by now.
 */

/**
 * The token a status is drawn in, and the word beside it carries the meaning.
 *
 * <p>docs/ui-kit.md §9.2: colour alone never carries meaning, so every one of these appears
 * with its label. <strong>`SUCCEEDED` is `success` and never lime.</strong> Lime means "act
 * now"; a collection that worked is the opposite of something to act on, and the one place
 * that distinction gets confused is a financial screen where green and lime both look like
 * approval at a glance.
 */
export function statusVariant(status: TransactionStatus): 'success' | 'danger' | 'warning' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  return 'warning';
}
