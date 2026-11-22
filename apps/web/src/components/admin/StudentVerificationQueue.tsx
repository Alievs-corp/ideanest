'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  Textarea,
} from '@ideanest/ui';
import { REASON_MAX_CHARACTERS } from '../../lib/admin/api';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import { bakuDateTime } from '../../lib/admin/console-dates';
import { actionMessageFor, shortId } from '../../lib/admin/refusals';
import {
  STUDENT_VERIFICATION_FILTERS,
  decideStudentVerification,
  listStudentVerifications,
  openStudentDocument,
  type StudentDecision,
  type StudentDocumentKind,
  type StudentVerificationRow,
  type StudentVerificationRowState,
} from '../../lib/admin/student-verifications';
import type { StudentVerificationQueueCopy } from '../../lib/i18n/admin/people-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { Link } from '../../i18n/navigation';
import { Confirm } from './ConsoleConfirm';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * The student check's review queue — issue #655, filed under AD-02 with the identity review.
 *
 * <h2>What a reviewer decides, and what they decide it from</h2>
 *
 * Whether the face on the student card is the face in the selfie, and whether the card is a real
 * one from the institution named. Approving lets the account buy a student plan for a year;
 * rejecting says why, and the account may send another; revoking takes an approval back when abuse
 * is found later. All three are audited by the service, and so is every opening of a document.
 *
 * <h2>The same card on another account is said on the row, loudly</h2>
 *
 * One card number belongs to one account. The service refuses a second account's submission while
 * the first is pending or approved, and lists every other account that ever used the number,
 * whatever state it is in. That list is a warning above the documents, with a link to each account,
 * because it is the abuse this check exists to catch and a reviewer should not have to go looking.
 *
 * <h2>Documents are opened on request, not on arrival</h2>
 *
 * Every opening is a line in the audit trail, so the queue does not open forty people's selfies
 * because a reviewer looked at the list. "Show documents" fetches both through the console's
 * authorised fetch; the bytes become object URLs that are revoked when the row goes. A card sent
 * as a PDF is a link that opens it, since a PDF has no thumbnail. A decided submission has no
 * documents: the service erases them with the decision.
 *
 * <h2>No dialog</h2>
 *
 * The decisions are `ConsoleConfirm`'s inline second step, and the reason is a field on the row,
 * because `Modal` costs a console route about 120 KiB of First Load JS.
 *
 * MOTION: none, like every console screen. `docs/motion-system.md` §5 and §8.
 */
export interface StudentVerificationQueueProps {
  readonly copy: StudentVerificationQueueCopy;
}

interface Said {
  readonly variant: 'success' | 'danger';
  readonly title: string;
  readonly body: string;
}

export function StudentVerificationQueue({ copy }: StudentVerificationQueueProps) {
  const locale = useRouteLocale();
  const [state, setState] = useState<StudentVerificationRowState>('PENDING');
  const [said, setSaid] = useState<Said | null>(null);

  const queue = useConsoleResource(
    (signal) => listStudentVerifications(state, signal),
    copy.subject,
    copy.refusals,
    [state],
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const rows = queue.data ?? [];
  const ready = queue.status === 'ready' && queue.data !== null;

  function decided(next: StudentVerificationRow, decision: StudentDecision, account: string): void {
    // It has left this state, so it leaves this list; the notice says what happened to it. An
    // updater, not `rows`: that is the list as it was when this row's request began, and writing it
    // back would bring back every row decided while this one was in flight.
    queue.set((previous) => previous.filter((row) => row.id !== next.id || next.state === state));
    const notice =
      decision === 'approve' ? copy.approvedNotice : decision === 'reject' ? copy.rejectedNotice : copy.revokedNotice;
    setSaid({ variant: 'success', title: copy.doneTitle, body: fillPlaceholders(notice, { account }) });
  }

  return (
    <section aria-label={copy.subject}>
      <ChipRow aria-label={copy.filterLabel}>
        {STUDENT_VERIFICATION_FILTERS.map((option) => (
          <Chip
            key={option}
            active={state === option}
            onClick={() => {
              setState(option);
              setSaid(null);
            }}
          >
            {copy.state[option]}
          </Chip>
        ))}
      </ChipRow>

      <div role="status" aria-live="polite" className="empty:hidden">
        {said !== null && (
          <InlineAlert variant={said.variant} title={said.title} className="mt-4">
            {said.body}
          </InlineAlert>
        )}
      </div>

      {queue.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="40%" />
                <Skeleton height="0.875rem" width="30%" className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {queue.status === 'failed' && (
        <>
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {queue.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={queue.reload}>
            {copy.tryAgain}
          </Pill>
        </>
      )}

      {ready && rows.length === 0 && (
        <EmptyState
          className="mt-4"
          variant="empty"
          title={fillPlaceholders(copy.emptyTitle, { state: copy.state[state] })}
          description={copy.emptyBody}
        />
      )}

      {ready && rows.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3">
          {rows.map((row) => (
            <StudentVerificationItem
              key={row.id}
              row={row}
              copy={copy}
              locale={locale}
              onDecided={decided}
              onMoved={queue.reload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * One submission
 * ---------------------------------------------------------------------- */

type Asking = 'none' | StudentDecision;

function StudentVerificationItem({
  row,
  copy,
  locale,
  onDecided,
  onMoved,
}: {
  readonly row: StudentVerificationRow;
  readonly copy: StudentVerificationQueueCopy;
  readonly locale: Locale;
  readonly onDecided: (next: StudentVerificationRow, decision: StudentDecision, account: string) => void;
  readonly onMoved: () => void;
}) {
  const [asking, setAsking] = useState<Asking>('none');
  const [reason, setReason] = useState('');
  const [reasonTried, setReasonTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = row.accountName ?? row.accountEmail ?? shortId(row.accountId);
  const decidable = row.state === 'PENDING';
  const revocable = row.state === 'APPROVED';

  async function decide(decision: StudentDecision): Promise<void> {
    if (busy) return;
    const typed = reason.trim();
    if (decision !== 'approve' && typed === '') {
      setReasonTried(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await decideStudentVerification(row.id, decision, decision === 'approve' ? null : typed);
      setAsking('none');
      onDecided(next, decision, account);
    } catch (cause) {
      setError(codedRefusalFor(cause, copy.errors, copy.refusals.refused, copy.subject, copy.refusals));
      // Somebody else decided it, or it is gone: the list is out of date and is read again.
      const code = refusalCode(cause);
      if (code === 'STUDENT_VERIFICATION_NOT_DECIDABLE' || code === 'STUDENT_VERIFICATION_NOT_FOUND') onMoved();
    } finally {
      setBusy(false);
    }
  }

  function ask(next: Asking): void {
    setAsking(next);
    setReason('');
    setReasonTried(false);
    setError(null);
  }

  const facts: { readonly label: string; readonly value: string }[] = [
    { label: copy.institutionLabel, value: row.institution },
    { label: copy.cardNumberLabel, value: row.cardNumber },
    { label: copy.submittedLabel, value: bakuDateTime(row.submittedAt, locale) },
    ...(row.decidedAt === null ? [] : [{ label: copy.decidedLabel, value: bakuDateTime(row.decidedAt, locale) }]),
    ...(row.validUntil === null ? [] : [{ label: copy.validUntilLabel, value: bakuDateTime(row.validUntil, locale) }]),
    ...(row.rejectionReason === null ? [] : [{ label: copy.reasonLabel, value: row.rejectionReason }]),
  ];

  return (
    <li className="rounded-lg border border-fg/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg sm:text-[15px]">
            <Link
              href={`/admin/users/${encodeURIComponent(row.accountId)}`}
              aria-label={fillPlaceholders(copy.openAccountLabel, { name: account })}
              className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {account}
            </Link>
          </p>
          {row.accountEmail !== null && row.accountName !== null && (
            <p className="mt-0.5 text-[13px] text-fg-64">{row.accountEmail}</p>
          )}
        </div>
        <Tag variant={row.state === 'APPROVED' ? 'success' : row.state === 'PENDING' ? 'warning' : 'default'}>
          {copy.state[row.state]}
        </Tag>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-fg-40">{fact.label}</dt>
            <dd className="min-w-0 break-words text-fg-80">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {row.sameCardElsewhere.length > 0 && (
        /*
          The warning on this screen. `danger`, an icon and a title, not colour alone (ui-kit
          §9.2): the same card number has been used by another account.
        */
        <InlineAlert variant="danger" title={copy.sameCardTitle} className="mt-4">
          <p>{copy.sameCardBody}</p>
          <ul className="mt-2 flex list-none flex-col gap-1">
            {row.sameCardElsewhere.map((other) => (
              <li key={other.accountId} className="flex items-center gap-2">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <Link
                  href={`/admin/users/${encodeURIComponent(other.accountId)}`}
                  className="underline underline-offset-4"
                >
                  {fillPlaceholders(copy.sameCardAccount, {
                    name: other.accountName ?? shortId(other.accountId),
                    state: copy.state[other.state],
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <StudentDocuments row={row} copy={copy} />

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {asking === 'approve' && (
        <div className="mt-4">
          <Confirm
            label={copy.approve}
            text={fillPlaceholders(copy.confirmApprove, { account })}
            action={copy.confirmApproveAction}
            working={copy.saving}
            back={copy.back}
            busy={busy}
            onConfirm={() => void decide('approve')}
            onBack={() => ask('none')}
          />
        </div>
      )}

      {(asking === 'reject' || asking === 'revoke') && (
        <form
          noValidate
          className="mt-4 flex flex-col gap-3 rounded-lg border border-fg/16 p-3"
          aria-label={asking === 'reject' ? copy.reject : copy.revoke}
          onSubmit={(event) => {
            event.preventDefault();
            void decide(asking);
          }}
        >
          <p className="max-w-[62ch] text-sm text-fg">
            {fillPlaceholders(asking === 'reject' ? copy.confirmReject : copy.confirmRevoke, { account })}
          </p>
          <Field
            label={copy.reasonField}
            hint={copy.reasonHint}
            error={reasonTried && reason.trim() === '' ? copy.reasonMissing : undefined}
            required
          >
            <Textarea
              value={reason}
              rows={3}
              maxLength={REASON_MAX_CHARACTERS}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Pill type="submit" size="sm" variant="danger" aria-disabled={busy}>
              {busy ? copy.saving : asking === 'reject' ? copy.confirmRejectAction : copy.confirmRevokeAction}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => (busy ? undefined : ask('none'))}>
              {copy.back}
            </Pill>
          </div>
        </form>
      )}

      {asking === 'none' && (decidable || revocable) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {decidable && (
            <>
              <Pill size="sm" variant="ghost" onClick={() => ask('approve')}>
                {copy.approve}
                <span className="sr-only">: {account}</span>
              </Pill>
              <Pill size="sm" variant="danger" onClick={() => ask('reject')}>
                {copy.reject}
                <span className="sr-only">: {account}</span>
              </Pill>
            </>
          )}
          {revocable && (
            <Pill size="sm" variant="danger" onClick={() => ask('revoke')}>
              {copy.revoke}
              <span className="sr-only">: {account}</span>
            </Pill>
          )}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * The documents
 * ---------------------------------------------------------------------- */

interface Opened {
  readonly kind: StudentDocumentKind;
  readonly url: string;
  readonly pdf: boolean;
}

type DocumentsStatus = 'closed' | 'loading' | 'open' | 'failed';

function StudentDocuments({
  row,
  copy,
}: {
  readonly row: StudentVerificationRow;
  readonly copy: StudentVerificationQueueCopy;
}) {
  const [status, setStatus] = useState<DocumentsStatus>('closed');
  const [opened, setOpened] = useState<readonly Opened[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  /*
   * The bytes are somebody's face and their student card. They live as object URLs only while
   * the row is on screen: revoked when the row goes or the documents are opened again.
   */
  useEffect(() => {
    return () => {
      for (const document of opened) URL.revokeObjectURL(document.url);
    };
  }, [opened]);

  useEffect(() => () => inFlight.current?.abort(), []);

  /*
   * FETCHED FROM THE PRESS, NOT FROM AN EFFECT. Every opening is a row in the audit trail, so the
   * documents are fetched once per press of the button and never because something re-rendered:
   * an effect keyed on the row would fetch them again when the list is read again (`reload` hands
   * every row a new array), recording openings nobody made.
   */
  async function open(): Promise<void> {
    if (inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus('loading');
    setError(null);

    try {
      const blobs = await Promise.all(
        row.documents.map(async (kind) => ({ kind, blob: await openStudentDocument(row.id, kind, controller.signal) })),
      );
      if (controller.signal.aborted) return;
      setOpened(
        blobs.map(({ kind, blob }) => ({
          kind,
          url: URL.createObjectURL(blob),
          pdf: blob.type === 'application/pdf',
        })),
      );
      setStatus('open');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(actionMessageFor(cause, copy.subject, copy.refusals) || copy.documentFailed);
      setStatus('failed');
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  return (
    <section aria-label={copy.documentsHeading} className="mt-4">
      {row.documents.length === 0 ? (
        <p className="text-[13px] text-fg-64">{copy.documentsErased}</p>
      ) : status === 'closed' || status === 'failed' ? (
        <>
          {status === 'failed' && error !== null && (
            <InlineAlert variant="danger" title={copy.documentFailed} className="mb-3">
              {error}
            </InlineAlert>
          )}
          <Pill variant="outline" size="sm" onClick={() => void open()}>
            {copy.showDocuments}
          </Pill>
        </>
      ) : status === 'loading' ? (
        <SkeletonGroup label={copy.loadingDocuments}>
          <Skeleton height="10rem" width="16rem" />
        </SkeletonGroup>
      ) : (
        <div className="flex flex-wrap gap-4">
          {opened.map((document) => {
            const name = document.kind === 'STUDENT_CARD' ? copy.studentCard : copy.selfie;
            return (
              <figure key={document.kind} className="flex flex-col gap-1.5">
                {document.pdf ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded text-sm text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {copy.openPdf}
                  </a>
                ) : (
                  // An object URL of a decrypted document: nothing for `next/image` to fetch or cache.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={document.url}
                    alt={name}
                    className="max-h-64 w-auto max-w-full rounded-lg border border-fg/8 object-contain"
                  />
                )}
                <figcaption className="text-[13px] text-fg-64">{name}</figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
