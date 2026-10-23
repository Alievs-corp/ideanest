/**
 * The creator agreement a campaign is gated on (§22.2, #426), as the review tab needs it.
 *
 * `GET /v1/me/agreements` says what is in force and whether this account accepted it, and
 * `POST /v1/me/agreements/{kind}` records the acceptance. A submission is refused with
 * `AGREEMENT_REQUIRED` until it is recorded, so the tab asks before it submits rather than after.
 */

/** The version in force that this account has still to accept. */
export interface PendingAgreement {
  readonly version: number;
  /** ISO instant, or `null` when the service did not send one. */
  readonly effectiveFrom: string | null;
}

/** What an `AGREEMENT_REQUIRED` refusal asks for: a tick, or a SİMA İmza signature (#429). */
export interface AgreementRefusal extends PendingAgreement {
  readonly requires: 'ACCEPTANCE' | 'SIGNATURE';
}

export const CREATOR_AGREEMENT = 'CREATOR_AGREEMENT';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function versionOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The creator agreement still to accept, read from `GET /v1/me/agreements`.
 *
 * `null` when there is nothing to ask: accepted, nothing published, or a body this cannot read.
 * The last fails open on purpose — the service still gates the submission, and its refusal
 * brings the question back with the version in it.
 */
export function pendingCreatorAgreement(body: unknown): PendingAgreement | null {
  if (!isRecord(body) || !Array.isArray(body.agreements)) return null;
  const row = body.agreements.find(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.document === CREATOR_AGREEMENT,
  );
  if (row === undefined || row.inForce !== true || row.acceptedAt != null) return null;
  const version = versionOf(row.version);
  if (version === null) return null;
  return { version, effectiveFrom: typeof row.effectiveFrom === 'string' ? row.effectiveFrom : null };
}

/** An `AGREEMENT_REQUIRED` refusal's `meta`, for the creator agreement; `null` for anything else. */
export function creatorAgreementRefusalOf(code: unknown, meta: unknown): AgreementRefusal | null {
  if (code !== 'AGREEMENT_REQUIRED' || !isRecord(meta) || meta.document !== CREATOR_AGREEMENT) return null;
  const version = versionOf(meta.version);
  if (version === null) return null;
  return {
    requires: meta.requires === 'SIGNATURE' ? 'SIGNATURE' : 'ACCEPTANCE',
    version,
    effectiveFrom: typeof meta.effectiveFrom === 'string' ? meta.effectiveFrom : null,
  };
}
