/**
 * Student verification — the wire type of `/v1/me/student-verification`, as both clients read it.
 *
 * <p>A student plan (`Plan.studentOnly`) is sold only to an account whose student card and selfie a
 * member of staff has approved, and only until the approval's `validUntil`. One card number belongs
 * to one account: the service refuses a second account submitting a card that is pending or
 * approved elsewhere with `STUDENT_CARD_IN_USE`.
 *
 * <p>Imports nothing, so a page that only needs this does not load `decimal.js`.
 */

/**
 * `NONE` — nothing submitted. `PENDING` — waiting for staff. `APPROVED` — may buy a student plan.
 * `REJECTED` — refused, with a reason; may submit again. `EXPIRED` — was approved, `validUntil` has
 * passed; may submit again.
 */
export type StudentVerificationState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface StudentVerification {
  readonly state: StudentVerificationState;
  readonly institution: string | null;
  readonly cardNumber: string | null;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  /** When an approval stops counting. Set on approval only. */
  readonly validUntil: string | null;
  /** Staff's words, set on a refusal. */
  readonly rejectionReason: string | null;
}

/** The documents a submission carries — both are required. */
export type StudentDocumentKind = 'STUDENT_CARD' | 'SELFIE';

const STATES: readonly string[] = ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The verification, or `null` for a body that does not say. The service omits null fields, so an
 * absent field reads as `null`.
 */
export function readStudentVerification(body: unknown): StudentVerification | null {
  if (!isObject(body)) return null;
  const state = body.state;
  if (typeof state !== 'string' || !STATES.includes(state)) return null;
  return {
    state: state as StudentVerificationState,
    institution: optionalText(body.institution),
    cardNumber: optionalText(body.cardNumber),
    submittedAt: optionalText(body.submittedAt),
    decidedAt: optionalText(body.decidedAt),
    validUntil: optionalText(body.validUntil),
    rejectionReason: optionalText(body.rejectionReason),
  };
}

/** Whether a new submission is accepted in this state. */
export function maySubmit(verification: StudentVerification | null): boolean {
  if (verification === null) return true;
  return verification.state === 'NONE' || verification.state === 'REJECTED' || verification.state === 'EXPIRED';
}

/** Whether this verification lets the account buy a student plan now. */
export function qualifiesForStudentPlans(verification: StudentVerification | null): boolean {
  return verification !== null && verification.state === 'APPROVED';
}

/** A refused submission, as the catalogue key that says it. */
export type StudentSubmissionRefusal =
  | 'cardInUse'
  | 'alreadySubmitted'
  | 'emptyFile'
  | 'unsupportedFile'
  | 'tooLarge'
  | 'storageUnavailable'
  | 'signedOut'
  | 'generic';

/** The refusal's sentence, from the problem's `code` and the status — never from its prose. */
export function studentSubmissionRefusalOf(
  status: number | null,
  code: string | null | undefined,
): StudentSubmissionRefusal {
  if (code === 'STUDENT_CARD_IN_USE') return 'cardInUse';
  if (code === 'STUDENT_VERIFICATION_ALREADY_SUBMITTED') return 'alreadySubmitted';
  // The document refusals are the identity check's (`DocumentRefusedException.Reason`); the
  // problem's `field` says which file — `studentCard` or `selfie`.
  if (code === 'EMPTY') return 'emptyFile';
  if (code === 'UNSUPPORTED_TYPE') return 'unsupportedFile';
  if (code === 'TOO_LARGE' || status === 413) return 'tooLarge';
  if (status === 503) return 'storageUnavailable';
  if (status === 401) return 'signedOut';
  return 'generic';
}
