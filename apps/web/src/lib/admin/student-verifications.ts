import { authorizedFetch } from '../api/client';
import { ApiError, errorFrom } from '../api/problem';
import type { StudentDocumentKind, StudentVerificationState } from '@ideanest/plans/student';

/**
 * Staff's side of the student check — `/v1/admin/student-verifications`, issue #655.
 *
 * <p>The same authority as the identity review (`VerificationAdminController`): every decision and
 * every document opening is audited by the service. Typed here by narrowing `unknown` rather than
 * from `@ideanest/api-client`'s generated schema, which does not describe these endpoints yet — a
 * body that does not have the shape is a failure the screen says, never a row drawn from a guess.
 *
 * <p>Documents are erased when a submission is decided, so an approved or rejected row lists no
 * documents; the card number and the institution stay, because they are what the one-card,
 * one-account rule is checked against.
 */

export type { StudentDocumentKind, StudentVerificationState } from '@ideanest/plans/student';

/** The states a row can be in. `NONE` is an account's answer, never a row. */
export type StudentVerificationRowState = Exclude<StudentVerificationState, 'NONE'>;

/** The queue's filters, in the order the screen offers them. Pending first: it is the work. */
export const STUDENT_VERIFICATION_FILTERS: readonly StudentVerificationRowState[] = Object.freeze([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

const DOCUMENT_KINDS: readonly StudentDocumentKind[] = ['STUDENT_CARD', 'SELFIE'];

/** Another account that has used the same card number, in any state. */
export interface SameCardAccount {
  readonly accountId: string;
  readonly accountName: string | null;
  readonly state: StudentVerificationRowState;
}

export interface StudentVerificationRow {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string | null;
  readonly accountEmail: string | null;
  readonly institution: string;
  readonly cardNumber: string;
  readonly state: StudentVerificationRowState;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly validUntil: string | null;
  readonly rejectionReason: string | null;
  /** The documents still held. Empty once the submission is decided. */
  readonly documents: readonly StudentDocumentKind[];
  /** Every other account that used this normalised number. Non-empty is the warning on the row. */
  readonly sameCardElsewhere: readonly SameCardAccount[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isRowState(value: unknown): value is StudentVerificationRowState {
  return typeof value === 'string' && (STUDENT_VERIFICATION_FILTERS as readonly string[]).includes(value);
}

function isDocumentKind(value: unknown): value is StudentDocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

function readSameCard(value: unknown): SameCardAccount | null {
  if (!isObject(value)) return null;
  const accountId = text(value.accountId);
  if (accountId === null || !isRowState(value.state)) return null;
  return { accountId, accountName: text(value.accountName), state: value.state };
}

/** One row, or `null` for a body a reviewer cannot decide from. Absent fields read as `null`. */
export function readStudentVerificationRow(body: unknown): StudentVerificationRow | null {
  if (!isObject(body)) return null;
  const id = text(body.id);
  const accountId = text(body.accountId);
  const institution = text(body.institution);
  const cardNumber = text(body.cardNumber);
  const submittedAt = text(body.submittedAt);
  if (id === null || accountId === null || institution === null || cardNumber === null || submittedAt === null) {
    return null;
  }
  if (!isRowState(body.state)) return null;

  const documents = Array.isArray(body.documents) ? body.documents.filter(isDocumentKind) : [];
  const sameCard = Array.isArray(body.sameCardElsewhere)
    ? body.sameCardElsewhere.flatMap((entry) => {
        const read = readSameCard(entry);
        return read === null ? [] : [read];
      })
    : [];

  return {
    id,
    accountId,
    accountName: text(body.accountName),
    accountEmail: text(body.accountEmail),
    institution,
    cardNumber,
    state: body.state,
    submittedAt,
    decidedAt: text(body.decidedAt),
    decidedBy: text(body.decidedBy),
    validUntil: text(body.validUntil),
    rejectionReason: text(body.rejectionReason),
    documents,
    sameCardElsewhere: sameCard,
  };
}

/**
 * The rows of one state. A malformed row is dropped rather than failing the list; a body without
 * a `verifications` array is a failure, never an empty queue.
 */
export function readStudentVerificationList(body: unknown): readonly StudentVerificationRow[] | null {
  if (!isObject(body) || !Array.isArray(body.verifications)) return null;
  return body.verifications.flatMap((entry) => {
    const row = readStudentVerificationRow(entry);
    return row === null ? [] : [row];
  });
}

function unreadable(status: number): ApiError {
  return new ApiError(status, null, 'The student verification answer could not be read.');
}

/** Oldest first, as the service orders them. */
export async function listStudentVerifications(
  state: StudentVerificationRowState,
  signal?: AbortSignal,
): Promise<readonly StudentVerificationRow[]> {
  const response = await authorizedFetch(`/v1/admin/student-verifications?state=${state}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  const rows = readStudentVerificationList(await response.json());
  if (rows === null) throw unreadable(response.status);
  return rows;
}

/**
 * One document's bytes, decrypted by the service, with the type it was stored as. `no-store` on
 * both sides; the caller makes an object URL of it and revokes it when the row goes. Audited.
 */
export async function openStudentDocument(
  id: string,
  kind: StudentDocumentKind,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await authorizedFetch(
    `/v1/admin/student-verifications/${encodeURIComponent(id)}/documents/${kind}`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);
  return response.blob();
}

/** What staff can do to a row. Reject and revoke carry a reason. */
export type StudentDecision = 'approve' | 'reject' | 'revoke';

/**
 * Approves (pending only; the approval runs a year), rejects (pending only) or revokes (approved
 * only — abuse found later). `409 STUDENT_VERIFICATION_NOT_DECIDABLE` when the row has moved.
 */
export async function decideStudentVerification(
  id: string,
  decision: StudentDecision,
  reason: string | null,
  signal?: AbortSignal,
): Promise<StudentVerificationRow> {
  const response = await authorizedFetch(
    `/v1/admin/student-verifications/${encodeURIComponent(id)}/${decision}`,
    {
      method: 'POST',
      ...(decision === 'approve'
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  const row = readStudentVerificationRow(await response.json());
  if (row === null) throw unreadable(response.status);
  return row;
}
