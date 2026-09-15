import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

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
}

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
