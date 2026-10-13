import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';
import type { Payout } from './payouts';

/**
 * Paying a payout by bank transfer from IdeyaNest's own account — issue #398, epic #392.
 *
 * <p>Its own module rather than more of `payouts.ts`, for `payout-destinations.ts`'s reason:
 * the four calls belong to one panel, and keeping them apart keeps the panel's weight off any
 * screen that one day reads payouts without paying them.
 *
 * <h2>The account is fetched on a press, and nothing here keeps it</h2>
 *
 * Both `start` and the re-read answer the creator's IBAN in full and both are audited by the
 * service as `PAYOUT_DESTINATION_ACCOUNT_REVEALED`. The requests are `no-store` like the
 * responses, and nothing in this module caches either: the component that asked holds the
 * answer for as long as it is on screen.
 *
 * <p>Every call needs `APPROVE_PAYOUT`; the two that open the account also need
 * `READ_BANK_DETAILS`.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** What to transfer, and where — the service's `BankTransferInstruction`. */
export interface BankTransferInstruction {
  readonly payout: Payout;
  readonly iban: string;
  readonly holderName: string;
  readonly accountHint: string;
  /** The payout's net amount, as the API carries money: a string and its currency. */
  readonly amount: Money;
  /** What to write as the transfer's payment description, so the statement names the payout. */
  readonly description: string;
}

function bankTransferPath(payoutId: string, verb = ''): string {
  return `/v1/admin/payouts/${encodeURIComponent(payoutId)}/bank-transfer${verb}`;
}

/**
 * Starts the transfer and opens the account to pay into.
 *
 * <p>Safe to repeat: on a payout already started it answers the same account again and moves
 * nothing. Refused with 409 `PAYOUT_SETTLES_THROUGH_PROVIDER`, `PAYOUT_BACKER_DISPUTE_OPEN`,
 * `PAYOUT_DESTINATION_NOT_VERIFIED`, `PAYOUT_SIGNATURES_SHORT`, `CAMPAIGN_ALREADY_PAID_OUT`,
 * `PAYOUT_NOT_SENDABLE` (with the payout cancelled when its figures moved), and 403
 * `SELF_PAID_PAYOUT`.
 */
export async function startBankTransfer(
  payoutId: string,
  signal?: AbortSignal,
): Promise<BankTransferInstruction> {
  const response = await authorizedFetch(bankTransferPath(payoutId, '/start'), {
    method: 'POST',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as BankTransferInstruction;
}

/** The account a started transfer goes to, opened again — and audited again. */
export async function readBankTransfer(
  payoutId: string,
  signal?: AbortSignal,
): Promise<BankTransferInstruction> {
  const response = await authorizedFetch(bankTransferPath(payoutId), { cache: 'no-store', signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as BankTransferInstruction;
}

/** What the bank statement shows of the transfer. */
export interface BankTransferRecord {
  readonly bankReference: string;
  /** The value date, `YYYY-MM-DD`, between the day the transfer started and today in Baku. */
  readonly transferredOn: string;
  readonly note: string;
  /** What the bank charged, a decimal string in the payout's currency. Absent for none (#401). */
  readonly bankFee?: string;
}

/**
 * Records the transfer from the statement: the payout is paid.
 *
 * <p>Idempotent under the same reference. 409 `PAYOUT_BANK_TRANSFER_ALREADY_RECORDED` for a
 * different one, 409 `PAYOUT_REFERENCE_TAKEN` for a reference another transaction carries, and
 * 400 `BANK_TRANSFER_DATE_OUT_OF_RANGE` for a value date outside the start day and today.
 */
export async function recordBankTransfer(
  payoutId: string,
  record: BankTransferRecord,
  signal?: AbortSignal,
): Promise<Payout> {
  const response = await authorizedFetch(bankTransferPath(payoutId, '/record'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(record),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Payout;
}

/** Abandons a started transfer that was never made. The note says how that is known. */
export async function abandonBankTransfer(
  payoutId: string,
  note: string,
  signal?: AbortSignal,
): Promise<Payout> {
  const response = await authorizedFetch(bankTransferPath(payoutId, '/abandon'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ note }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Payout;
}
