'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, Skeleton, SkeletonGroup, TextInput, useFieldControl } from '@ideanest/ui';
import { maySubmit, studentSubmissionRefusalOf } from '@ideanest/plans/student';
import { ApiError } from '../../lib/api/problem';
import {
  SELFIE_TYPES,
  STUDENT_CARD_TYPES,
  STUDENT_DOCUMENT_MAX_BYTES,
  STUDENT_REQUEST_MAX_BYTES,
  downscaleImage,
  fitsOneRequest,
  localFileProblem,
  readMyStudentVerification,
  refusedFieldOf,
  submitStudentVerification,
  type StudentFileField,
  type StudentVerification,
} from '../../lib/plans/student';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { StudentVerificationCopy } from '../../lib/i18n/student-copy';
import type { Locale } from '../../lib/i18n/locale';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import { Link } from '../../i18n/navigation';
import { signInHref } from '../../lib/auth/redirect';

/**
 * `/account/student`: where the account stands with the student check, and the form that asks
 * for it — issue #655.
 *
 * <h2>What is asked for, and why it is said on the page</h2>
 *
 * The institution, the card's number, a photograph or scan of the card and a selfie. A member of
 * staff compares the face on the card with the selfie, and one card number belongs to one account,
 * so the service refuses a card that is pending or approved elsewhere. The page says both in one
 * sentence above the form, because a request for a photograph of somebody's face that does not say
 * why is one a careful person declines.
 *
 * <h2>The files are checked here before they are sent</h2>
 *
 * The same three refusals the service makes — empty, the wrong type, larger than
 * `ideanest.verification.documents.max-bytes` — so a phone photograph that is too large is said
 * under its own field before eleven megabytes travel to be refused. The service still decides, and
 * its refusal names the file (`field`), which is where it is said.
 *
 * <h2>A photograph is made small before it is checked</h2>
 *
 * A phone photograph is eight to twelve megabytes; the service takes five per file and one request
 * of both. So a chosen JPEG or PNG is redrawn at 2048 pixels on its longer edge as a JPEG
 * (`downscaleImage`) before the size check, and the PDF card is left as it is. The two files
 * together are checked against the request limit before sending, so the container's 413 — which
 * names no file — is not what the reader meets.
 *
 * <h2>A selfie is taken, not chosen, on a phone</h2>
 *
 * `capture="user"` opens the front camera where there is one and is ignored elsewhere. The card
 * field has no `capture`: a scan or a photograph already in the gallery is as good as a new one.
 *
 * MOTION: none. This is a form about identity, and nothing on it is discovery.
 */
export interface StudentVerificationPanelProps {
  readonly copy: StudentVerificationCopy;
}

type Status = 'loading' | 'ready' | 'failed' | 'signed-out';

/**
 * The card number with all but its last four characters hidden — the app's rule. A number of four
 * characters or fewer is hidden whole: showing "the last four" of it would show all of it.
 */
export function maskCardNumber(number: string): string {
  const compact = number.replace(/\s+/gu, '');
  if (compact.length <= 4) return '•'.repeat(Math.max(compact.length, 4));
  return `•••• ${compact.slice(-4)}`;
}

const MEGABYTES = String(STUDENT_DOCUMENT_MAX_BYTES / (1024 * 1024));
const REQUEST_MEGABYTES = String(STUDENT_REQUEST_MAX_BYTES / (1024 * 1024));

export function StudentVerificationPanel({ copy }: StudentVerificationPanelProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [verification, setVerification] = useState<StudentVerification | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    void (async () => {
      try {
        const read = await readMyStudentVerification(controller.signal);
        if (controller.signal.aborted) return;
        setVerification(read);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted) return;
        // No session is not a failure to retry: the reader signs in, and comes back here.
        setStatus(cause instanceof ApiError && cause.status === 401 ? 'signed-out' : 'failed');
      }
    })();

    return () => controller.abort();
  }, [attempt]);

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading}>
        <Skeleton height="1.25rem" width="50%" />
        <Skeleton height="0.875rem" width="70%" className="mt-3" />
      </SkeletonGroup>
    );
  }

  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOutTitle}>
        <Link href={signInHref('/account/student')} className="text-fg underline underline-offset-4">
          {copy.signIn}
        </Link>
      </InlineAlert>
    );
  }

  if (status === 'failed' || verification === null) {
    return (
      <div>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {copy.unavailable}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div role="status" aria-live="polite" className="empty:hidden">
        {sent && (
          <InlineAlert variant="success" title={copy.sentTitle}>
            {copy.stateBody.PENDING}
          </InlineAlert>
        )}
      </div>

      {!sent && <StatusSection verification={verification} copy={copy} locale={locale} />}

      {maySubmit(verification) && (
        <SubmissionForm
          copy={copy}
          onSent={(next) => {
            setVerification(next);
            setSent(true);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Where the account stands
 * ---------------------------------------------------------------------- */

function StatusSection({
  verification,
  copy,
  locale,
}: {
  readonly verification: StudentVerification;
  readonly copy: StudentVerificationCopy;
  readonly locale: Locale;
}) {
  const { state } = verification;
  // Pending is not a green tick, and a refusal is not the reader's error: words and an icon carry
  // the meaning with the colour (ui-kit §9.2).
  const variant =
    state === 'APPROVED' ? 'success' : state === 'REJECTED' || state === 'EXPIRED' ? 'warning' : 'info';

  const facts: { readonly label: string; readonly value: string }[] = [];
  if (verification.institution !== null) facts.push({ label: copy.institutionLabel, value: verification.institution });
  if (verification.cardNumber !== null) {
    facts.push({ label: copy.cardNumberLabel, value: maskCardNumber(verification.cardNumber) });
  }
  if (verification.submittedAt !== null) {
    facts.push({ label: copy.submittedLabel, value: formatDate(verification.submittedAt, locale) });
  }
  if (verification.validUntil !== null && (state === 'APPROVED' || state === 'EXPIRED')) {
    facts.push({ label: copy.validUntilLabel, value: formatDate(verification.validUntil, locale) });
  }

  return (
    <section aria-labelledby="student-status-heading">
      <h2 id="student-status-heading" className="text-[13px] font-medium tracking-[0.06em] text-fg-40 uppercase">
        {copy.statusHeading}
      </h2>

      <InlineAlert variant={variant} title={copy.state[state]} className="mt-3">
        <p>{copy.stateBody[state]}</p>
        {state === 'REJECTED' && verification.rejectionReason !== null && (
          <p className="mt-2">
            <span className="font-medium">{copy.reasonLabel}: </span>
            {verification.rejectionReason}
          </p>
        )}
        {state === 'APPROVED' && (
          <p className="mt-2">
            <Link href="/pricing" className="text-fg underline underline-offset-4">
              {copy.toPricing}
            </Link>
          </p>
        )}
      </InlineAlert>

      {facts.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-2">
              <dt className="text-fg-40">{fact.label}</dt>
              <dd className="text-fg-80 tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * The submission
 * ---------------------------------------------------------------------- */

type FileErrors = Partial<Record<StudentFileField, string>>;

function SubmissionForm({
  copy,
  onSent,
}: {
  readonly copy: StudentVerificationCopy;
  readonly onSent: (verification: StudentVerification) => void;
}) {
  const [institution, setInstitution] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [studentCard, setStudentCard] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [fileErrors, setFileErrors] = useState<FileErrors>({});
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState<StudentFileField | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const institutionError = tried && institution.trim() === '' ? copy.institutionMissing : undefined;
  const cardLength = cardNumber.trim().length;
  const cardNumberError = tried && (cardLength < 3 || cardLength > 40) ? copy.cardNumberInvalid : undefined;
  const studentCardError = fileErrors.studentCard ?? (tried && studentCard === null ? copy.fileMissing : undefined);
  const selfieError = fileErrors.selfie ?? (tried && selfie === null ? copy.fileMissing : undefined);

  async function choose(field: StudentFileField, accepted: readonly string[], file: File | null): Promise<void> {
    setRefusal(null);
    // The type and emptiness are the file's own; the size is judged on what will actually be sent.
    const early = file === null ? null : localFileProblem(file, accepted, { ignoreSize: true });
    let prepared = early === null ? file : null;
    if (prepared !== null) {
      setPreparing(field);
      prepared = await downscaleImage(prepared);
      setPreparing(null);
    }
    const problem = early ?? (prepared === null ? null : localFileProblem(prepared, accepted));
    setFileErrors((previous) => ({ ...previous, [field]: problem === null ? undefined : copy.refusals[problem] }));
    const kept = problem === null ? prepared : null;
    if (field === 'studentCard') setStudentCard(kept);
    else setSelfie(kept);
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sending || preparing !== null) return;
    setTried(true);
    setRefusal(null);
    const trimmed = institution.trim();
    const number = cardNumber.trim();
    if (trimmed === '' || number.length < 3 || number.length > 40) return;
    if (studentCard === null || selfie === null || fileErrors.studentCard || fileErrors.selfie) return;
    if (!fitsOneRequest(studentCard, selfie)) {
      setRefusal(fillPlaceholders(copy.together, { megabytes: REQUEST_MEGABYTES }));
      return;
    }

    setSending(true);
    try {
      onSent(await submitStudentVerification({ institution: trimmed, cardNumber: number, studentCard, selfie }));
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : null;
      const code = cause instanceof ApiError ? cause.problem?.code : null;
      const words = copy.refusals[studentSubmissionRefusalOf(status, code)];
      const field = refusedFieldOf(cause);
      if (field === null) setRefusal(words);
      else setFileErrors((previous) => ({ ...previous, [field]: words }));
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="student-form-heading">
      <h2 id="student-form-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
        {copy.formHeading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.why}</p>

      <form noValidate onSubmit={(event) => void send(event)} className="mt-6 flex max-w-[560px] flex-col gap-5">
        <Field label={copy.institutionField} hint={copy.institutionHint} error={institutionError} required>
          <TextInput
            value={institution}
            maxLength={200}
            autoComplete="organization"
            onChange={(event) => setInstitution(event.target.value)}
          />
        </Field>

        <Field label={copy.cardNumberField} hint={copy.cardNumberHint} error={cardNumberError} required>
          <TextInput
            value={cardNumber}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCardNumber(event.target.value)}
          />
        </Field>

        <Field
          label={copy.studentCardField}
          hint={fillPlaceholders(copy.studentCardHint, { megabytes: MEGABYTES })}
          error={studentCardError}
          required
        >
          <DocumentInput
            accept={STUDENT_CARD_TYPES.join(',')}
            file={studentCard}
            previewLabel={copy.studentCardPreview}
            pdfChosen={copy.pdfChosen}
            preparing={preparing === 'studentCard' ? copy.preparing : null}
            onFile={(file) => void choose('studentCard', STUDENT_CARD_TYPES, file)}
          />
        </Field>

        <Field
          label={copy.selfieField}
          hint={fillPlaceholders(copy.selfieHint, { megabytes: MEGABYTES })}
          error={selfieError}
          required
        >
          <DocumentInput
            accept={SELFIE_TYPES.join(',')}
            capture="user"
            file={selfie}
            previewLabel={copy.selfiePreview}
            pdfChosen={copy.pdfChosen}
            preparing={preparing === 'selfie' ? copy.preparing : null}
            onFile={(file) => void choose('selfie', SELFIE_TYPES, file)}
          />
        </Field>

        {refusal !== null && (
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {refusal}
          </InlineAlert>
        )}

        <div>
          <Pill type="submit" variant="primary" size="md" aria-disabled={sending || preparing !== null}>
            {sending ? copy.submitting : copy.submit}
          </Pill>
        </div>
      </form>
    </section>
  );
}

/**
 * A native file input, named by the `Field` around it, with a thumbnail of what was chosen.
 *
 * <p>Native rather than `FileDropZone`, which has no `capture`: the selfie is the one control
 * here that should open the camera on a phone. The thumbnail is an object URL, revoked when the
 * file changes or the form goes, so a reader who tries three photographs does not hold three.
 */
function DocumentInput({
  accept,
  capture,
  file,
  previewLabel,
  pdfChosen,
  preparing,
  onFile,
}: {
  readonly accept: string;
  readonly capture?: 'user';
  readonly file: File | null;
  readonly previewLabel: string;
  readonly pdfChosen: string;
  /** Said while a chosen photograph is being made smaller, which takes a moment on a phone. */
  readonly preparing: string | null;
  readonly onFile: (file: File | null) => void;
}) {
  const aria = useFieldControl({});
  const [preview, setPreview] = useState<string | null>(null);
  const image = file !== null && file.type.startsWith('image/');

  useEffect(() => {
    if (file === null || !image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, image]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="file"
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        aria-required={aria.required}
        accept={accept}
        capture={capture}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFile(event.target.files?.[0] ?? null)}
        className="block w-full rounded-lg text-sm text-fg-64 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      />
      {preparing !== null && (
        <p role="status" className="text-[13px] text-fg-64">
          {preparing}
        </p>
      )}
      {preview !== null && (
        // An object URL of the reader's own file: there is nothing for `next/image` to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={previewLabel} className="h-28 w-auto max-w-full self-start rounded-lg border border-fg/8 object-contain" />
      )}
      {file !== null && !image && (
        <p className="text-[13px] text-fg-64">{fillPlaceholders(pdfChosen, { name: file.name })}</p>
      )}
    </div>
  );
}
