import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { AdminPayoutDestination, DestinationRejectionReason } from './api';

/**
 * COMPLIANCE's decisions about where a creator is paid — issue #396, part of epic #392.
 *
 * <p>Its own module rather than more of `api.ts`, because `api.ts` is also what the account
 * picker reads, and the picker is on the support and audit screens: every byte added there is
 * paid by two screens that never verify anything. The read of one account's destination stays
 * in `api.ts` beside the account it belongs to.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** In the service's own order, which is the order a reviewer is offered them. */
export const DESTINATION_REJECTION_REASONS: readonly DestinationRejectionReason[] = Object.freeze([
  'UNREADABLE',
  'EXPIRED_DOCUMENT',
  'MISMATCHED_NAME',
  'INCOMPLETE',
  'SUSPECTED_FORGERY',
]);

/**
 * How many destinations one read of the queue holds — `CreatorPayoutDestinations.PAGE_SIZE`.
 *
 * <p>The service takes no page and no filter: it answers the fifty that have waited longest,
 * oldest first, and deciding one is what brings the next one in. A screen that shows exactly
 * this many says so, because "fifty waiting" and "at least fifty waiting" are different
 * workloads.
 */
export const PAYOUT_DESTINATION_QUEUE_SIZE = 50;

/**
 * COMPLIANCE's queue: every destination that is not verified, oldest first (#432, #396).
 *
 * <p>Not audited by the service, and that is its argument rather than an omission here: the
 * list shows that a destination exists and what state it is in, and opening one on the account
 * screen is the read worth a row. `VERIFY_PAYOUT_DESTINATION`.
 */
export async function readPayoutDestinationQueue(
  signal?: AbortSignal,
): Promise<readonly AdminPayoutDestination[]> {
  const response = await authorizedFetch('/v1/admin/payout-destinations', { cache: 'no-store', signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { destinations: readonly AdminPayoutDestination[] };
  return body.destinations;
}

/**
 * Confirms the account belongs to the creator it is filed under.
 *
 * <p>`STAFF_ATTESTED` is sent rather than left to the service, which wants the method stated:
 * it is the only one anybody can perform today, and the row records how it was established.
 * 409 `DESTINATION_NAME_MISMATCH` when the holder is not the creator's legal name, 403
 * `SELF_VERIFIED_DESTINATION` on one's own account.
 */
export async function verifyPayoutDestination(
  creatorId: string,
  signal?: AbortSignal,
): Promise<AdminPayoutDestination> {
  const response = await authorizedFetch(
    `/v1/admin/accounts/${encodeURIComponent(creatorId)}/payout-destination/verify`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: 'STAFF_ATTESTED' }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminPayoutDestination;
}

/** Refuses the account, with a reason from the closed set that the creator is shown. */
export async function rejectPayoutDestination(
  creatorId: string,
  reason: DestinationRejectionReason,
  signal?: AbortSignal,
): Promise<AdminPayoutDestination> {
  const response = await authorizedFetch(
    `/v1/admin/accounts/${encodeURIComponent(creatorId)}/payout-destination/reject`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminPayoutDestination;
}

/** A creator's IBAN in full, with the holder it is filed under. */
export interface RevealedBankAccount {
  readonly creatorId: string;
  readonly iban: string;
  readonly holderName: string;
  readonly displayHint: string;
}

/**
 * Opens a creator's IBAN — #394's one place the number is served.
 *
 * <p>`READ_BANK_DETAILS`, and every call is audited as `PAYOUT_DESTINATION_ACCOUNT_REVEALED`
 * whatever it finds, so nothing calls this until somebody asks: not on load, not on hover, and
 * never twice for one press. The response is `no-store` and so is the request, and nothing
 * here keeps it — the component that asked holds it for as long as it is on screen. 404
 * `PAYOUT_BANK_ACCOUNT_NOT_FOUND` when what is on file is a card or nothing.
 */
export async function revealPayoutBankAccount(
  creatorId: string,
  signal?: AbortSignal,
): Promise<RevealedBankAccount> {
  const response = await authorizedFetch(
    `/v1/admin/accounts/${encodeURIComponent(creatorId)}/payout-destination/account`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RevealedBankAccount;
}
