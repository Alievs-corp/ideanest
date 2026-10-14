import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { BackerDispute } from '../admin/backer-disputes';

/**
 * A backer disputing their payment while the creator's payout is held — IDN-EXT-01 (#43, #44).
 *
 * The service answers the open dispute when one exists, so a second press is the same dispute. It
 * refuses with `DISPUTE_WINDOW_CLOSED` when no payout is held for the campaign (before withdrawal, or
 * after payout — nothing is refunded through the platform after payout) and `NOTHING_TO_DISPUTE` when
 * nothing of the payment is left to refund.
 */
export async function openBackerDispute(pledgeId: string, reason: string, signal?: AbortSignal): Promise<BackerDispute> {
  const response = await authorizedFetch(`/v1/pledges/${encodeURIComponent(pledgeId)}/disputes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BackerDispute;
}

/** Whether the backer may dispute now (#480): the same rules the POST enforces, asked first. */
export interface DisputeWindow {
  readonly status: 'OPEN' | 'NOT_YET' | 'CLOSED' | 'NOTHING_LEFT';
  /** When the hold ends, for `OPEN`. */
  readonly until: string | null;
  /** The dispute already open on the pledge. */
  readonly dispute: BackerDispute | null;
}

export async function readDisputeWindow(pledgeId: string, signal?: AbortSignal): Promise<DisputeWindow> {
  const response = await authorizedFetch(`/v1/pledges/${encodeURIComponent(pledgeId)}/disputes/window`, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as DisputeWindow;
}
