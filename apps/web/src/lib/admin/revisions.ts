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

  const body = (await response.json()) as Omit<RevisionReview, 'changedFields'> & {
    changedFields?: readonly string[] | null;
  };
  return { ...body, changedFields: body.changedFields ?? [] };
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
