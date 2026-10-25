'use client';

import { Suspense, lazy, useEffect, useState } from 'react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { Link, localeHref } from '../../i18n/navigation';
import { ApiError } from '../../lib/api/problem';
import { actionMessageFor } from '../../lib/admin/refusals';
import {
  approveRevision,
  readRevisionReview,
  rejectRevision,
  type RevisionReview as Review,
} from '../../lib/admin/revisions';
import type { Category } from '../../lib/categories/api';
import type { RevisionReviewCopy } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { listCategories } from '../../lib/projects/api';
import { formatDate, formatExactTime } from '../../lib/time';
import { ConsoleRefusal } from './ConsoleRefusal';
import { RevisionComparison } from './RevisionComparison';
import { useConsoleResource } from './useConsoleResource';

/*
 * `Modal` brings the motion library, about 120 KiB, and this route is opened to read a
 * comparison. The dialog is fetched when a decision is chosen — `console-modal-costs-120kib`.
 */
const RevisionDecisionDialog = lazy(() =>
  import('./RevisionDecisionDialog').then((module) => ({ default: module.RevisionDecisionDialog })),
);

/*
 * The reward tiers are drawn only by an edit that touches some, and their field-by-field
 * comparison is not what most revisions are opened to read, so it is a chunk of its own.
 */
const RevisionRewards = lazy(() =>
  import('./RevisionRewards').then((module) => ({ default: module.RevisionRewards })),
);

type Outcome = 'approve' | 'reject';

type Notice = { readonly variant: 'success' | 'warning'; readonly text: string };

/**
 * One edit to a launched campaign, with the live version beside the proposed one — issue #560,
 * part of epic #557.
 *
 * <h2>Decided from the comparison, not from a summary</h2>
 *
 * Approving replaces what backers read and rejecting returns the creator's draft, so the page
 * puts the live and the proposed side by side for exactly the fields the service names as
 * changed, with each change marked in more than colour. `RevisionComparison` has the detail.
 *
 * <h2>The decisions are not optimistic</h2>
 *
 * The same rule the submission queue states: each outcome is privileged and audited, so the
 * dialog goes busy until the service answers and a refusal leaves everything as it was. What
 * the service answers is what the page shows afterwards, and the two buttons go away.
 *
 * <h2>A 409 is the ordinary refusal</h2>
 *
 * `REVISION_NOT_AVAILABLE` means the creator edited the revision after this page was read,
 * which returns it to a draft, or somebody else decided it. The decision was not recorded; the
 * dialog closes, the page says so, and it reads the revision again so the moderator is looking
 * at what is there now rather than at what they were about to decide.
 *
 * <h2>Motion: none</h2>
 *
 * The dialog's own 200ms entry and nothing else; docs/motion-system.md §5 and §8.
 */
export interface RevisionReviewProps {
  readonly revisionId: string;
  readonly copy: RevisionReviewCopy;
}

export function RevisionReview({ revisionId, copy }: RevisionReviewProps) {
  const locale = useRouteLocale();
  const review = useConsoleResource<Review | null>(
    (signal) =>
      readRevisionReview(revisionId, signal).catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      }),
    copy.subject,
    copy.refusals,
    [revisionId],
  );

  const [categories, setCategories] = useState<readonly Category[] | null>(null);
  const [pending, setPending] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [decided, setDecided] = useState<Outcome | null>(null);

  const showsCategory = review.data?.changedFields.includes('category') ?? false;

  useEffect(() => {
    if (!showsCategory) return;

    const controller = new AbortController();
    listCategories(controller.signal)
      .then((tree) => {
        if (!controller.signal.aborted) setCategories(tree);
      })
      .catch(() => {
        // The comparison falls back to the identifiers: a name is a convenience.
      });
    return () => controller.abort();
  }, [showsCategory]);

  if (review.status === 'signed-out' || review.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={review.status}
        capability={review.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  if (review.status === 'loading' && review.data === null) {
    return (
      <SkeletonGroup label={copy.loadingReview}>
        <div className="rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5">
          <Skeleton height="1.5rem" width="55%" />
          <Skeleton height="0.875rem" width="35%" className="mt-3" />
          <Skeleton height="0.875rem" width="70%" className="mt-2" />
        </div>
      </SkeletonGroup>
    );
  }

  if (review.status === 'failed' && review.data === null) {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {review.error}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={review.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const revision = review.data;

  if (revision === null) {
    return (
      <EmptyState
        variant="empty"
        title={copy.notFoundTitle}
        description={copy.notFoundBody}
        action={<BackToQueue label={copy.backToQueue} />}
      />
    );
  }

  const title = revision.proposed.title ?? revision.live.title ?? '';
  const status = decided === null ? revision.status : decided === 'approve' ? 'APPROVED' : 'REJECTED';
  const decidable = status === 'PENDING';

  async function commit(note: string | null): Promise<void> {
    if (pending === null) return;

    setBusy(true);
    setDialogError(null);
    try {
      if (pending === 'approve') await approveRevision(revisionId, note);
      else await rejectRevision(revisionId, note ?? '');

      setDecided(pending);
      setNotice({ variant: 'success', text: pending === 'approve' ? copy.approved : copy.rejected });
      setPending(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.problem?.code === 'REVISION_NOT_AVAILABLE') {
        setPending(null);
        setNotice({ variant: 'warning', text: copy.unavailable });
        review.reload();
      } else {
        setDialogError(actionMessageFor(cause, copy.subject, copy.refusals));
      }
    } finally {
      setBusy(false);
    }
  }

  const dialogCopy = pending === 'reject' ? copy.rejectDialog : copy.approveDialog;

  return (
    <div>
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice !== null && (
          <InlineAlert variant={notice.variant === 'success' ? 'success' : 'warning'} className="mb-4">
            {notice.text}
          </InlineAlert>
        )}
      </div>

      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      <section
        aria-labelledby="revision-review-heading"
        className="mt-6 rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="revision-review-heading"
              className="text-base font-medium tracking-[-0.02em] wrap-anywhere text-fg sm:text-lg"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-fg-64">
              {revision.submittedAt != null && (
                <time dateTime={revision.submittedAt} title={formatExactTime(revision.submittedAt, locale)}>
                  {fillPlaceholders(copy.submitted, { date: formatDate(revision.submittedAt, locale) })}
                </time>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="sr-only">{copy.statusLabel}</span>
            <Tag variant={status === 'PENDING' ? 'warning' : status === 'APPROVED' ? 'success' : 'default'}>
              {copy.status[status] ?? status}
            </Tag>
          </div>
        </div>

        <p className="mt-3 text-sm">
          <a
            href={localeHref(`/admin/campaigns/${encodeURIComponent(revision.projectId)}`, locale)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg text-fg-64 underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {copy.openCampaign}
          </a>
        </p>

        {!decidable && decided === null && (
          <InlineAlert variant="info" className="mt-4">
            {fillPlaceholders(copy.notPending, { status: copy.status[status] ?? status })}
          </InlineAlert>
        )}

        {revision.reason != null && revision.reason !== '' && (
          <p className="mt-4 text-sm text-fg-80">
            <span className="text-fg-40">{copy.reasonLabel}</span> {revision.reason}
          </p>
        )}
      </section>

      <section aria-labelledby="revision-changes-heading" className="mt-8">
        <h2 id="revision-changes-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.changesHeading}
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-fg-64">{copy.legend}</p>
        <RevisionComparison
          live={revision.live}
          proposed={revision.proposed}
          changedFields={revision.changedFields}
          categories={categories}
          locale={locale}
          copy={copy}
          hasRewards={revision.rewards.length > 0}
        />
        {revision.rewards.length > 0 && (
          <Suspense fallback={<Skeleton height="6rem" className="mt-8" />}>
            <RevisionRewards rewards={revision.rewards} locale={locale} copy={copy} />
          </Suspense>
        )}
      </section>

      {decidable && (
        <section aria-labelledby="revision-decide-heading" className="mt-8">
          <h2 id="revision-decide-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
            {copy.decideHeading}
          </h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <Pill
              variant="primary"
              onClick={() => {
                setDialogError(null);
                setPending('approve');
              }}
            >
              {copy.approve}
            </Pill>
            <Pill
              variant="danger"
              onClick={() => {
                setDialogError(null);
                setPending('reject');
              }}
            >
              {copy.reject}
            </Pill>
          </div>
        </section>
      )}

      <p className="mt-8">
        <BackToQueue label={copy.backToQueue} />
      </p>

      {pending !== null && (
        <Suspense fallback={null}>
          <RevisionDecisionDialog
            key={pending}
            noteRequired={pending === 'reject'}
            destructive={pending === 'reject'}
            title={title}
            copy={dialogCopy}
            noteRequiredMessage={copy.noteRequired}
            tooLongMessage={copy.tooLong}
            chrome={copy}
            busy={busy}
            error={dialogError}
            onCancel={() => {
              setPending(null);
              setDialogError(null);
            }}
            onConfirm={(note) => void commit(note)}
          />
        </Suspense>
      )}
    </div>
  );
}

function BackToQueue({ label }: { readonly label: string }) {
  return (
    <Link
      href="/admin/moderation/revisions"
      className="rounded-lg text-sm text-fg-64 underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {label}
    </Link>
  );
}
