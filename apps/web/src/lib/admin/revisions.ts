import type { components } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * What the review of an edit to a launched campaign asks the service — issue #560, part of
 * epic #557.
 *
 * <h2>Why these are the console's own types</h2>
 *
 * The generated schema names the queue's row `Entry`, a name three unrelated schemas share, so
 * `RevisionQueueResponse` is typed as a list of survey answers. The row is read here as what
 * the controller sends instead, and `live` and `proposed` are the creator-side `ProjectEdit`
 * on both sides of the comparison: the same shape, so a field is compared with its own kind.
 *
 * <h2>The decisions are not optimistic</h2>
 *
 * Approving replaces what backers read and rejecting sends the creator's draft back, so neither
 * is assumed to have happened until the service says so. A 409 `REVISION_NOT_AVAILABLE` is the
 * ordinary refusal: the creator edited the revision after it was opened, which returns it to a
 * draft, and the page has to be reread rather than decided from.
 */

export type ProjectEdit = components['schemas']['ProjectEdit'];

/** The fields a revision can change, in the order a campaign page reads them. */
export const REVISION_FIELDS = [
  'title',
  'blurb',
  'category',
  'coverImage',
  'videoMediaId',
  'story',
  'risks',
  'countries',
  'rewards',
] as const;

export type RevisionField = (typeof REVISION_FIELDS)[number];

/** What one request reads. The service clamps anything larger. */
export const REVISION_QUEUE_LIMIT = 50;

export interface QueuedRevision {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly slug: string;
  readonly creatorId: string;
  /** Absent when the account has been anonymised since. */
  readonly creatorName?: string | null;
  readonly changedFields: readonly string[];
  readonly submittedAt: string;
}

export interface RevisionQueue {
  readonly revisions: readonly QueuedRevision[];
}

type Schemas = components['schemas'];

/**
 * A shipping amount as the service sends it. The generated schema types a `BigDecimal` as a
 * number; on the wire money is a string (docs/architecture.md §10.3), so it is read as one.
 */
type WireAmount<T> = Omit<T, 'amount' | 'additionalItemAmount' | 'perKilogramAmount'> & {
  readonly amount?: string;
  readonly additionalItemAmount?: string;
  readonly perKilogramAmount?: string;
};

export type RevisionRewardImage = Schemas['RevisionRewardImage'];
export type RevisionRewardItem = Schemas['RevisionRewardItem'];
export type RevisionShippingRule = WireAmount<Schemas['RevisionShippingRule']>;
export type RevisionShippingZoneRate = WireAmount<Schemas['RevisionShippingZoneRate']>;

export type RevisionRewardWriting = Omit<Schemas['RevisionRewardWriting'], 'shippingRules' | 'shippingZoneRates'> & {
  readonly shippingRules?: readonly RevisionShippingRule[] | null;
  readonly shippingZoneRates?: readonly RevisionShippingZoneRate[] | null;
};

/** What the revision does to one tier. A tier can be both `changed` and `reordered`. */
export type RevisionRewardChange = 'created' | 'deleted' | 'changed' | 'reordered';

/** The names the service gives a changed tier's fields: the creator's reward response names. */
export type RevisionRewardField =
  | 'title'
  | 'description'
  | 'imageMediaId'
  | 'videoMediaId'
  | 'estimatedDelivery'
  | 'limitQuantity'
  | 'shippingType'
  | 'isEarlyBird'
  | 'isFeatured'
  | 'isSecret'
  | 'isAddon'
  | 'availableFrom'
  | 'availableUntil'
  | 'items'
  | 'shippingRules'
  | 'shippingZoneRates';

/** A tier the revision creates, deletes, moves or changes. `live` is null for a created tier and `proposed` for a deleted one. */
export interface RevisionReward {
  readonly id: string;
  readonly changes: readonly string[];
  readonly livePosition?: number | null;
  readonly proposedPosition?: number | null;
  readonly price: Schemas['Money'];
  readonly changedFields: readonly string[];
  readonly live?: RevisionRewardWriting | null;
  readonly proposed?: RevisionRewardWriting | null;
}

export interface RevisionReview {
  readonly id: string;
  readonly projectId: string;
  /** `PENDING` is the only status that can be decided. */
  readonly status: string;
  readonly authorId?: string | null;
  readonly submittedAt?: string | null;
  readonly decidedAt?: string | null;
  readonly reason?: string | null;
  readonly changedFields: readonly string[];
  readonly live: ProjectEdit;
  readonly proposed: ProjectEdit;
  /** Empty when the revision touches no reward tier. */
  readonly rewards: readonly RevisionReward[];
}

export interface RevisionDecision {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly decidedAt?: string | null;
  readonly reason?: string | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function revisionPath(id: string): string {
  return `/v1/admin/moderation/revisions/${encodeURIComponent(id)}`;
}

export async function listRevisionQueue(options: {
  limit?: number;
  signal?: AbortSignal;
}): Promise<RevisionQueue> {
  const query = new URLSearchParams({ limit: String(options.limit ?? REVISION_QUEUE_LIMIT) });

  const response = await authorizedFetch(`/v1/admin/moderation/revisions?${query}`, {
    signal: options.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { revisions?: readonly QueuedRevision[] | null };
  return { revisions: body.revisions ?? [] };
}

export async function readRevisionReview(id: string, signal?: AbortSignal): Promise<RevisionReview> {
  const response = await authorizedFetch(revisionPath(id), { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as Omit<RevisionReview, 'changedFields' | 'rewards'> & {
    changedFields?: readonly string[] | null;
    rewards?: readonly RevisionReward[] | null;
  };
  return { ...body, changedFields: body.changedFields ?? [], rewards: body.rewards ?? [] };
}

/** An absent note is absent from the body, not an empty string. */
export async function approveRevision(id: string, note: string | null): Promise<RevisionDecision> {
  const response = await authorizedFetch(`${revisionPath(id)}/approve`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(note === null ? {} : { note }),
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RevisionDecision;
}

export async function rejectRevision(id: string, note: string): Promise<RevisionDecision> {
  const response = await authorizedFetch(`${revisionPath(id)}/reject`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RevisionDecision;
}
