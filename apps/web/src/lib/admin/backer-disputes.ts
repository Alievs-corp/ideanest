import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * The administrators' backer dispute queue — IDN-EXT-01 (#43, #44).
 *
 * Not `lib/admin/disputes.ts`: those are card-scheme chargebacks arriving from a provider. These are
 * disputes a backer opened through the platform while the creator's payout was held (§9.7). Upheld,
 * the backer is refunded in full and the payout recalculated; rejected, nothing moves.
 */

export type BackerDisputeState = 'OPEN' | 'UPHELD' | 'REJECTED';

export interface BackerDispute {
  id: string;
  pledgeId: string;
  projectId: string;
  payoutId: string;
  reason: string;
  state: BackerDisputeState;
  openedAt: string;
  decidedAt?: string | null;
  refundId?: string | null;
  /**
   * What upholding would refund: everything the pledge has left, since an upheld dispute refunds
   * in full. On the administrators' queue only; absent when nothing is left.
   */
  refundable?: Money | null;
  /** The pledge's backer, on the administrators' queue only. */
  backerId?: string | null;
}

/**
 * The queue's page size. The endpoint answers a bare array of at most this many, so a page
 * shorter than it is the last one.
 */
export const BACKER_DISPUTE_PAGE_SIZE = 50;

export type BackerDisputeOutcome = 'UPHOLD' | 'REJECT';

export async function readBackerDisputeQueue(page = 0, signal?: AbortSignal): Promise<BackerDispute[]> {
  const response = await authorizedFetch(`/v1/admin/backer-disputes?page=${page}`, { cache: 'no-store', signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BackerDispute[];
}

export async function decideBackerDispute(
  disputeId: string,
  outcome: BackerDisputeOutcome,
  note: string | null,
  signal?: AbortSignal,
): Promise<BackerDispute> {
  const response = await authorizedFetch(`/v1/admin/backer-disputes/${encodeURIComponent(disputeId)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, note }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BackerDispute;
}
