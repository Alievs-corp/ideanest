import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';
import type { Refund } from './refunds';

/**
 * Finance's half of a refund paid by bank transfer — issue #400, part of epic #392.
 *
 * <p>Its own module rather than more of `refunds.ts`, for #396's reason: `refunds.ts` is read by
 * every screen that lists a pledge's refunds, and the reveal, the record and the fallback are
 * used by one. Support's half — recording the account — is `refund-bank-details.ts`, imported by
 * the support console alone, so neither screen pays for the other's code.
 *
 * <p>All three are `ISSUE_REFUND`. The service refuses each one with a `code` the console words
 * itself (`BankRefundRefusedException.Reason`): `REFUND_NOT_FOUND`, `REFUND_NOT_AWAITING_TRANSFER`,
 * `REFUND_NOT_FAILED`, `REFUND_CHARGE_DISPUTED`, `BANK_REFERENCE_TAKEN`,
 * `REFUND_DUTIES_NOT_SEPARATE` and `TRANSFER_DATE_IN_FUTURE`, and 503
 * `ENCRYPTED_STORAGE_UNAVAILABLE` when the bank-details keyring is not configured.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** A backer's account in full, with the amount to send to it. */
export interface RevealedRefundBankDetails {
  readonly refundId: string;
  readonly pledgeId: string;
  /** In the charge's currency, which is the currency the transfer is made in. */
  readonly amount: Money;
  readonly iban: string;
  readonly ibanHint: string;
  readonly holderName: string;
  readonly ticketId: string;
  readonly detailsRecordedBy: string;
}

/**
 * Opens the account a refund is paid into.
 *
 * <p>Audited as `refund.bank_details_revealed` on every call, so nothing calls this until somebody
 * presses for it: not on load, not on hover, and never twice for one press. `no-store` both ways,
 * and nothing here keeps the answer — the component that asked holds it while it is on screen.
 */
export async function revealRefundBankDetails(
  refundId: string,
  signal?: AbortSignal,
): Promise<RevealedRefundBankDetails> {
  const response = await authorizedFetch(`/v1/admin/refunds/${encodeURIComponent(refundId)}/bank-details`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RevealedRefundBankDetails;
}

export interface RecordRefundTransferRequest {
  /** The bank's reference for the payment, as the statement shows it. */
  readonly bankReference: string;
  /** `YYYY-MM-DD`, the day the money left IdeyaNest's account. Not after today. */
  readonly transferredOn: string;
  readonly signal?: AbortSignal;
}

/**
 * Records that the transfer was made, which settles the refund.
 *
 * <p>Idempotent on the reference: the same reference again answers the settled refund, so a
 * retried press records nothing twice. Refused to whoever recorded the account.
 */
export async function recordRefundBankTransfer(
  refundId: string,
  request: RecordRefundTransferRequest,
): Promise<Refund> {
  const response = await authorizedFetch(
    `/v1/admin/refunds/${encodeURIComponent(refundId)}/bank-transfer/record`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ bankReference: request.bankReference, transferredOn: request.transferredOn }),
      signal: request.signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Refund;
}

/**
 * Sends a refund the provider refused by bank transfer instead.
 *
 * <p>The answer is a new refund, `AWAITING_BANK_DETAILS`, for what the charge still has left. It
 * is keyed on the refused refund, so pressing again answers the same row rather than a second one.
 */
export async function routeRefundToBankTransfer(refundId: string, signal?: AbortSignal): Promise<Refund> {
  const response = await authorizedFetch(`/v1/admin/refunds/${encodeURIComponent(refundId)}/bank-transfer`, {
    method: 'POST',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Refund;
}

/**
 * Today, in Baku — the value date a transfer made now is recorded with.
 *
 * <p>Not the browser's date and not UTC's: the bank and the service both reckon the day in
 * Azerbaijan, and a transfer made at half past midnight in Baku is still yesterday in UTC. The
 * service refuses a date after its own today, so a default a day ahead would be refused.
 */
export function todayInBaku(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
