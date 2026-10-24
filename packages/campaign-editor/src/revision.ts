import type { ProjectEdit } from './contract';

/**
 * Where an edit to a launched campaign stands, as the editor must show it (#561).
 *
 * Pure, so the web and the app word the same four situations from the same answer. The server
 * is the authority: nothing here decides whether an edit may be sent, it only reads which of
 * the four the `ProjectEdit` is describing and which actions that leaves the creator.
 *
 * - `none`: nothing is held. The fields are what the public sees.
 * - `draft`: the creator's own changes, not public, not yet sent.
 * - `pending`: sent, with a moderator. Editing again returns it to `draft`.
 * - `rejected`: moderation refused the last edit; nothing is open. `reason` is the moderator's.
 */
export type RevisionKind = 'none' | 'draft' | 'pending' | 'rejected';

export interface RevisionView {
  kind: RevisionKind;
  /** The sections that differ from the public page, in the order they were reported. */
  changedFields: readonly string[];
  /** The moderator's reason, for `rejected` only. */
  reason: string | null;
  canSubmit: boolean;
  canDiscard: boolean;
}

const NONE: RevisionView = {
  kind: 'none',
  changedFields: [],
  reason: null,
  canSubmit: false,
  canDiscard: false,
};

export function revisionView(project: ProjectEdit | null | undefined): RevisionView {
  const revision = project?.revision;
  if (revision != null) {
    const pending = revision.status === 'PENDING';
    return {
      kind: pending ? 'pending' : 'draft',
      changedFields: revision.changedFields,
      reason: null,
      canSubmit: !pending && revision.changedFields.length > 0,
      canDiscard: true,
    };
  }

  const rejected = project?.rejectedRevision;
  if (rejected != null) return { ...NONE, kind: 'rejected', reason: rejected.reason };

  return NONE;
}

/** Why the server refused with 409 REVISION_NOT_AVAILABLE (meta.reason); UNKNOWN for any other. */
export const REVISION_REFUSALS = [
  'NO_OPEN_REVISION',
  'ALREADY_SUBMITTED',
  'NO_CHANGES',
  'NOT_PENDING',
  'UNKNOWN',
] as const;

export type RevisionRefusal = (typeof REVISION_REFUSALS)[number];

export function revisionRefusalOf(meta: unknown): RevisionRefusal {
  const reason = (meta as { reason?: unknown } | null | undefined)?.reason;
  return REVISION_REFUSALS.find((known) => known === reason) ?? 'UNKNOWN';
}

/** The sections an edit can change, as `changedFields` names them. */
export const REVISION_FIELDS = [
  'title',
  'blurb',
  'category',
  'story',
  'risks',
  'coverImage',
  'videoMediaId',
  'countries',
] as const;

export type RevisionField = (typeof REVISION_FIELDS)[number];

export function isRevisionField(name: string): name is RevisionField {
  return (REVISION_FIELDS as readonly string[]).includes(name);
}
