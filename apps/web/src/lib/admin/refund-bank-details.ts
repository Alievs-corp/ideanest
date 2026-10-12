import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { RefundPage } from './refunds';

/**
 * Support's half of a refund paid by bank transfer — issue #400, part of epic #392.
 *
 * <p>Imported by the support console alone; finance's half is `refund-bank-transfers.ts`. See
 * that module for why the two are apart.
 */

export interface RecordRefundBankDetailsRequest {
  /** The electronic form — upper case, no spaces — from `@ideanest/account/iban`'s `checkIban`. */
  readonly iban: string;
  readonly holderName: string;
  /** The ticket the backer gave the account in. The service refuses one the backer did not raise. */
  readonly ticketId: string;
  readonly signal?: AbortSignal;
}

/**
 * Records the account a pledge's refund is paid into — `HANDLE_SUPPORT`.
 *
 * <p>It applies to every part of the pledge's refund that waits: each one waiting for details
 * moves on to waiting for the transfer, and one already waiting for the transfer has its account
 * replaced, which the service audits with the old and new hints. The answer is those parts. Refused
 * with 400 `MALFORMED_IBAN` (`meta.defect`), 400 `SUPPORT_TICKET_NOT_FROM_BACKER`, 409
 * `NO_REFUND_AWAITING_BANK_DETAILS` and 503 `ENCRYPTED_STORAGE_UNAVAILABLE`; the typed number is
 * never echoed back in any of them.
 */
export async function recordRefundBankDetails(
  pledgeId: string,
  request: RecordRefundBankDetailsRequest,
): Promise<RefundPage> {
  const response = await authorizedFetch(`/v1/admin/pledges/${encodeURIComponent(pledgeId)}/refund-bank-details`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      iban: request.iban,
      holderName: request.holderName,
      ticketId: request.ticketId,
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RefundPage;
}
