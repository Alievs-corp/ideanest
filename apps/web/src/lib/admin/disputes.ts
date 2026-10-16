import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * §4.11's AD-07: chargebacks — issues #68 and #308.
 *
 * <h2>There is no way to open one, and that is deliberate</h2>
 *
 * A chargeback is raised by a card network and arrives through a provider webhook. The
 * service has no endpoint that lets staff open one, so neither does this module: an
 * endpoint that could invent a dispute the network never made would be a case the platform
 * then answers, at a cost, against nobody.
 *
 * What staff can do is answer — add evidence, submit it, record the outcome.
 *
 * <h2>The deadline is the field this screen exists for</h2>
 *
 * Everything else on a dispute could be reconstructed from the provider. A deadline that
 * has passed cannot, and losing by default is the expensive way to lose. The queue is
 * ordered by it, and the screen counts down.
 */

/**
 * Where a case has got to.
 *
 * <strong>This has a cycle and a refund's does not.</strong> A dispute can be lost, won on
 * representment, and lost again on a second presentment — so nothing here assumes forward
 * motion, and `OPEN` is reachable from `LOST`.
 */
export type DisputeState = 'OPEN' | 'UNDER_REVIEW' | 'WON' | 'LOST' | 'CONCEDED';

/** What a piece of evidence is. The networks ask for categories rather than documents. */
export type EvidenceKind =
  | 'RECEIPT'
  | 'SHIPPING_PROOF'
  | 'COMMUNICATION'
  | 'TERMS_ACCEPTANCE'
  | 'REFUND_POLICY'
  | 'ACTIVITY_LOG'
  | 'OTHER';

export interface DisputeEvidence {
  id: string;
  kind: EvidenceKind;
  description: string;
  mediaId?: string | null;
  /** Absent while the piece is assembled and not yet sent. */
  submittedAt?: string | null;
  providerEvidenceId?: string | null;
  createdAt: string;
  createdBy: string;
}

export interface Dispute {
  id: string;
  chargeTransactionId: string;
  pledgeId: string;
  projectId: string;
  provider: string;
  providerDisputeId: string;
  amount: Money;
  /** What the provider charges for handling it, win or lose. The platform's cost. */
  fee: Money;
  /** The network's category, as the provider spells it. Not a closed set. */
  reasonCode: string;
  state: DisputeState;
  /** Absent when the provider sends no deadline. Sorted last, not first — later is not sooner. */
  evidenceDueAt?: string | null;
  openedAt: string;
  resolvedAt?: string | null;
  handledBy?: string | null;
  /** Empty on the list shape; populated by {@link readDispute}. */
  evidence: DisputeEvidence[];
  /** Whose pledge was charged back, for the directory to name. Absent on the responses to a write. */
  backerId?: string | null;
}

export interface DisputePage {
  disputes: Dispute[];
  page: number;
  hasMore: boolean;
}

/** The three outcomes a case can be resolved as. `OPEN` and `UNDER_REVIEW` are not outcomes. */
export const DISPUTE_OUTCOMES: readonly DisputeState[] = ['WON', 'LOST', 'CONCEDED'];

/*
 * What each kind of evidence is, in words, is `admin.screens.disputes.evidenceKind` since
 * #324. This is the order the form offers them in.
 */
export const EVIDENCE_KINDS: readonly EvidenceKind[] = Object.freeze([
  'RECEIPT',
  'SHIPPING_PROOF',
  'COMMUNICATION',
  'TERMS_ACCEPTANCE',
  'REFUND_POLICY',
  'ACTIVITY_LOG',
  'OTHER',
]);

/** The queue: unresolved, soonest deadline first. */
export async function readDisputeQueue(page = 0, signal?: AbortSignal): Promise<DisputePage> {
  const response = await authorizedFetch(`/v1/admin/disputes/queue?page=${page}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as DisputePage;
}

/** Everything, newest first, optionally narrowed to one state. */
export async function listDisputes(
  state: DisputeState | null,
  page = 0,
  signal?: AbortSignal,
): Promise<DisputePage> {
  const parameters = new URLSearchParams({ page: String(page) });
  if (state != null) parameters.set('state', state);

  const response = await authorizedFetch(`/v1/admin/disputes?${parameters}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as DisputePage;
}

/** One case with its evidence, oldest piece first — an argument is read forwards. */
export async function readDispute(disputeId: string, signal?: AbortSignal): Promise<Dispute> {
  const response = await authorizedFetch(`/v1/admin/disputes/${encodeURIComponent(disputeId)}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Dispute;
}

/** Adds a piece to the argument. Assembled, not sent — {@link submitEvidence} sends. */
export async function addEvidence(
  disputeId: string,
  kind: EvidenceKind,
  description: string,
  signal?: AbortSignal,
): Promise<DisputeEvidence> {
  const response = await authorizedFetch(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/evidence`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, description }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as DisputeEvidence;
}

/** Answers the case with everything assembled so far. */
export async function submitEvidence(disputeId: string, signal?: AbortSignal): Promise<Dispute> {
  const response = await authorizedFetch(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/submit`,
    { method: 'POST', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Dispute;
}

/** Records how the network decided, or that the platform chose not to argue. */
export async function resolveDispute(
  disputeId: string,
  outcome: DisputeState,
  signal?: AbortSignal,
): Promise<Dispute> {
  const response = await authorizedFetch(
    `/v1/admin/disputes/${encodeURIComponent(disputeId)}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Dispute;
}

/**
 * How long is left before the provider stops accepting evidence.
 *
 * Returns null when there is no deadline, and a negative number when it has passed — the
 * screen renders both differently, and collapsing "no deadline" into "expired" would put a
 * case nobody can lose on time at the top of a queue sorted by urgency.
 */
export function hoursUntilDue(dispute: Dispute, now: Date = new Date()): number | null {
  if (dispute.evidenceDueAt == null) return null;

  return (new Date(dispute.evidenceDueAt).getTime() - now.getTime()) / 3_600_000;
}
