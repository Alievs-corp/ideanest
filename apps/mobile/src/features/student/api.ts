import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  readStudentVerification,
  studentSubmissionRefusalOf,
  type StudentSubmissionRefusal,
  type StudentVerification,
} from '@ideanest/plans/student';
import { readJson, sendMultipart } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { prepareJpeg, UploadFailed } from '../../lib/media/upload';

/**
 * The student card check — `GET` and `POST /v1/me/student-verification` (#655).
 *
 * <p>The state decides what the student plan's card offers (`pricing-screen.tsx`) and what the
 * student status screen shows. Never persisted: a card number does not belong in the unencrypted
 * offline store (`queryKeys.studentVerification` is under `settings`).
 *
 * <h2>Two photographs, one multipart body</h2>
 *
 * <p>The student card and the selfie go to the service itself, not to the media store: they are
 * identity documents, encrypted at rest and erased once staff decide. Each is converted to JPEG on
 * the phone first — an iPhone photo is HEIC, which the service does not accept — and scaled down
 * until it is under the service's per-document ceiling.
 */

/** A response the shared narrowing refused. */
export class UnreadableStudentVerification extends Error {
  constructor() {
    super('The student verification response could not be read');
    this.name = 'UnreadableStudentVerification';
  }
}

/**
 * `ideanest.verification.documents.max-bytes` — five mebibytes, per document. The service measures
 * again; this is so a phone does not send megabytes it knows will be refused.
 */
export const STUDENT_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** The service's bounds on the two text fields. */
export const INSTITUTION_MAX = 200;
export const CARD_NUMBER_MIN = 3;
export const CARD_NUMBER_MAX = 40;

/** Largest first: a phone photo fits the first nearly always, and a smaller one is still legible. */
const ATTEMPTS = [
  { maxEdge: 2048, compress: 0.85 },
  { maxEdge: 1600, compress: 0.7 },
  { maxEdge: 1280, compress: 0.6 },
] as const;

export function useStudentVerification(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.studentVerification(),
    enabled,
    retry: false,
    queryFn: async ({ signal }): Promise<StudentVerification> =>
      readStudentVerificationBody(await readJson('/v1/me/student-verification', signal)),
  });
}

function readStudentVerificationBody(body: unknown): StudentVerification {
  const verification = readStudentVerification(body);
  if (verification === null) throw new UnreadableStudentVerification();
  return verification;
}

/** A photograph ready to send: a JPEG in this app's cache, under the ceiling. */
export interface PreparedPhoto {
  readonly uri: string;
  readonly byteSize: number;
}

/** Why a picked photograph cannot be sent, found on the phone before anything is sent. */
export class PhotoNotUsable extends Error {
  readonly refusal: 'tooLarge' | 'unsupportedFile';

  constructor(refusal: 'tooLarge' | 'unsupportedFile') {
    super(refusal);
    this.name = 'PhotoNotUsable';
    this.refusal = refusal;
  }
}

/**
 * The picked photograph as a JPEG under {@link STUDENT_DOCUMENT_MAX_BYTES}, scaled down further
 * while it is not. Every intermediate file is removed; the result is the caller's to remove
 * (`forgetPicked`).
 */
export async function preparePhoto(
  uri: string,
  remove: (uri: string) => void,
  maxBytes: number = STUDENT_DOCUMENT_MAX_BYTES,
): Promise<PreparedPhoto> {
  for (const attempt of ATTEMPTS) {
    let prepared: PreparedPhoto;
    try {
      prepared = await prepareJpeg(uri, attempt);
    } catch (cause) {
      if (cause instanceof UploadFailed) throw new PhotoNotUsable('unsupportedFile');
      throw cause;
    }
    if (prepared.byteSize > 0 && prepared.byteSize <= maxBytes) return prepared;
    remove(prepared.uri);
    if (!(prepared.byteSize > 0)) throw new PhotoNotUsable('unsupportedFile');
  }
  throw new PhotoNotUsable('tooLarge');
}

export interface StudentSubmission {
  readonly institution: string;
  readonly cardNumber: string;
  readonly studentCard: PreparedPhoto;
  readonly selfie: PreparedPhoto;
}

/** React Native's `FormData` file part: read from disk by the native networking layer. */
function filePart(photo: PreparedPhoto, name: string): Blob {
  return { uri: photo.uri, name, type: 'image/jpeg' } as unknown as Blob;
}

/** Sends the card for checking. Answers the verification as it now stands (`PENDING`). */
export async function submitStudentVerification(submission: StudentSubmission): Promise<StudentVerification> {
  const form = new FormData();
  form.append('institution', submission.institution);
  form.append('cardNumber', submission.cardNumber);
  form.append('studentCard', filePart(submission.studentCard, 'student-card.jpg'));
  form.append('selfie', filePart(submission.selfie, 'selfie.jpg'));
  return readStudentVerificationBody(await sendMultipart('/v1/me/student-verification', form));
}

/** Which photograph a document refusal is about. */
export type StudentDocumentField = 'studentCard' | 'selfie';

export interface StudentRefusal {
  readonly refusal: StudentSubmissionRefusal;
  /** Set when the service named the file it refused. */
  readonly field: StudentDocumentField | null;
}

/** A failed submission, read from the problem's `code`, status and `field` — never from its prose. */
export function studentRefusalFrom(cause: unknown): StudentRefusal {
  if (cause instanceof PhotoNotUsable) return { refusal: cause.refusal, field: null };
  if (!(cause instanceof ApiError)) return { refusal: studentSubmissionRefusalOf(null, null), field: null };
  const field = (cause.problem as { readonly field?: unknown } | null)?.field;
  return {
    refusal: studentSubmissionRefusalOf(cause.status, cause.problem?.code),
    field: field === 'studentCard' || field === 'selfie' ? field : null,
  };
}

/**
 * The card number as the screen shows it: the last four characters, the rest as dots. A number of
 * four or fewer is all dots — showing it whole would be showing all of it.
 */
export function maskCardNumber(cardNumber: string): string {
  const compact = cardNumber.replace(/\s+/gu, '');
  if (compact.length <= 4) return '•'.repeat(Math.max(compact.length, 4));
  return `•••• ${compact.slice(-4)}`;
}
