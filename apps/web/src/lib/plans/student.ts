import { authorizedFetch } from '../api/client';
import { ApiError, errorFrom } from '../api/problem';
import {
  readStudentVerification,
  type StudentVerification,
} from '@ideanest/plans/student';

/**
 * The account's own student verification — `/v1/me/student-verification`, issue #655.
 *
 * <p>A student plan (`Plan.studentOnly`) is sold only to an account whose student card and selfie a
 * member of staff approved, until the approval's `validUntil`. The wire type and its narrowing are
 * `@ideanest/plans/student`'s, so the web and the app read the same body the same way.
 */

export type {
  StudentDocumentKind,
  StudentSubmissionRefusal,
  StudentVerification,
  StudentVerificationState,
} from '@ideanest/plans/student';

/**
 * The largest file the service accepts, per file: `ideanest.verification.documents.max-bytes`,
 * five megabytes (`VerificationProperties.DEFAULT_MAX_BYTES`). The student check stores its
 * documents through the identity check's cipher and limits, so the form refuses a larger file
 * before uploading it rather than after.
 */
export const STUDENT_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The largest request the service takes, both files and the two text fields together:
 * `spring.servlet.multipart.max-request-size`. The backend for #655 is raising it from the six
 * megabytes the identity check needed (one file) to fit two; 10 MiB is the figure this client
 * holds to until that lands — confirm it against `apps/api/src/main/resources/application.yml`.
 */
export const STUDENT_REQUEST_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What the two text fields and the multipart framing add to the files. Generous on purpose: being
 * refused by the container for the last few hundred bytes would be a 413 that names no file.
 */
export const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;

/** The longest edge a photograph is sent at. A face and a card number are legible far below it. */
export const STUDENT_IMAGE_MAX_EDGE = 2048;

/** What the student card may be: a photograph or a scan. */
export const STUDENT_CARD_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** What the selfie may be. A PDF is not a photograph of a face. */
export const SELFIE_TYPES = ['image/jpeg', 'image/png'] as const;

/** The body was not a verification. Said as a failure, never read as "nothing submitted". */
function unreadable(status: number): ApiError {
  return new ApiError(status, null, 'The student verification could not be read.');
}

/** Where this account stands. `state: NONE` when nothing was ever submitted. */
export async function readMyStudentVerification(signal?: AbortSignal): Promise<StudentVerification> {
  const response = await authorizedFetch('/v1/me/student-verification', { signal });
  if (!response.ok) throw await errorFrom(response);

  const verification = readStudentVerification(await response.json());
  if (verification === null) throw unreadable(response.status);
  return verification;
}

export interface StudentSubmission {
  readonly institution: string;
  readonly cardNumber: string;
  readonly studentCard: File;
  readonly selfie: File;
  readonly signal?: AbortSignal;
}

/**
 * Sends the card and the selfie for review.
 *
 * <p>Multipart, through the same authorised fetch every `/v1/me/*` call uses. No `Content-Type`
 * header is set: the browser writes it, with the boundary the body was built with.
 *
 * <p>The service refuses a card number that is pending or approved on another account
 * (`409 STUDENT_CARD_IN_USE`), a second submission while one is pending or approved (`409
 * STUDENT_VERIFICATION_ALREADY_SUBMITTED`), and a file it cannot store (`400 EMPTY | TOO_LARGE |
 * UNSUPPORTED_TYPE`, with `field` saying which).
 */
export async function submitStudentVerification(submission: StudentSubmission): Promise<StudentVerification> {
  const body = new FormData();
  body.set('institution', submission.institution);
  body.set('cardNumber', submission.cardNumber);
  body.set('studentCard', submission.studentCard, submission.studentCard.name);
  body.set('selfie', submission.selfie, submission.selfie.name);

  const response = await authorizedFetch('/v1/me/student-verification', {
    method: 'POST',
    body,
    signal: submission.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const verification = readStudentVerification(await response.json());
  if (verification === null) throw unreadable(response.status);
  return verification;
}

/** Which file a document refusal is about, when the service said: `studentCard` or `selfie`. */
export type StudentFileField = 'studentCard' | 'selfie';

/**
 * The `field` a refusal names. The identity module puts it on the problem itself; `meta.field`
 * is read as well, which is where the rest of the service puts a field.
 */
export function refusedFieldOf(cause: unknown): StudentFileField | null {
  if (!(cause instanceof ApiError) || cause.problem == null) return null;
  const problem: Record<string, unknown> = { ...cause.problem };
  const field = problem.field ?? cause.problem.meta?.field;
  return field === 'studentCard' || field === 'selfie' ? field : null;
}

/** Why a chosen file cannot be sent, before sending it. */
export type LocalFileProblem = 'tooLarge' | 'unsupportedFile' | 'emptyFile';

/**
 * The same three refusals the service makes, checked in the browser so nothing is uploaded twice.
 *
 * @param options.ignoreSize for a file about to be made smaller: its size is judged afterwards
 */
export function localFileProblem(
  file: File,
  accepted: readonly string[],
  options: { readonly ignoreSize?: boolean } = {},
): LocalFileProblem | null {
  if (file.size === 0) return 'emptyFile';
  if (!accepted.includes(file.type)) return 'unsupportedFile';
  if (options.ignoreSize !== true && file.size > STUDENT_DOCUMENT_MAX_BYTES) return 'tooLarge';
  return null;
}

/** Whether the two files and the form around them fit in one request the service will take. */
export function fitsOneRequest(studentCard: File, selfie: File): boolean {
  return studentCard.size + selfie.size + MULTIPART_ALLOWANCE_BYTES <= STUDENT_REQUEST_MAX_BYTES;
}

/**
 * A photograph made small enough to send: at most {@link STUDENT_IMAGE_MAX_EDGE} pixels on its
 * longer edge, re-encoded as JPEG through a canvas. A phone photograph is routinely eight to twelve
 * megabytes and four thousand pixels wide, which the service refuses, and nothing a reviewer reads
 * on a card or a face needs that.
 *
 * <p>A PDF, or anything that is not a JPEG or PNG, is returned as it is. So is the original when the
 * browser cannot decode or draw it (no `createImageBitmap`, no 2D context), or when re-encoding a
 * JPEG that was already small enough would only make it larger: the size check after this is what
 * decides, and the service still checks again.
 *
 * <p>`createImageBitmap` applies the photograph's EXIF orientation, so a portrait selfie stays
 * upright. A PNG's transparency is drawn over white, because JPEG has none.
 */
export async function downscaleImage(file: File, maxEdge: number = STUDENT_IMAGE_MAX_EDGE): Promise<File> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return file;

    context.fillStyle = 'white';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob === null) return file;
    if (scale === 1 && file.type === 'image/jpeg' && blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]*$/u, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
