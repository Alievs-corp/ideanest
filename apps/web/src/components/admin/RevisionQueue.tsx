'use client';

import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { Link } from '../../i18n/navigation';
import { listRevisionQueue, REVISION_FIELDS, type RevisionField } from '../../lib/admin/revisions';
import { shortId } from '../../lib/admin/refusals';
import type { RevisionQueueCopy } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate, formatExactTime } from '../../lib/time';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * The queue of edits to launched campaigns — issue #560, part of epic #557.
 *
 * <h2>Why it is not the submission queue with a filter</h2>
 *
 * A submission is a campaign that has never been public, and deciding it moves the campaign's
 * own state. An edit is a revision of a campaign backers are already reading: nothing about
 * the campaign's state changes, and what is decided is whether a proposed version replaces the
 * live one. `GET /v1/admin/moderation/revisions` lists only revisions that are waiting, oldest
 * first, so there are no state chips and no cursor — a decided edit leaves the queue.
 *
 * <h2>The decision is on the review page</h2>
 *
 * A row carries no approve or reject. Both replace or withhold words and pictures a creator
 * wrote, and deciding them from a title and a list of field names is the guess the review
 * page exists to end.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in lists.
 */
export interface RevisionQueueProps {
  readonly copy: RevisionQueueCopy;
}

export function RevisionQueue({ copy }: RevisionQueueProps) {
  const locale = useRouteLocale();
  const queue = useConsoleResource(
    (signal) => listRevisionQueue({ signal }),
    copy.subject,
    copy.refusals,
    [],
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={queue.status}
        capability={queue.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  const rows = queue.data?.revisions ?? [];
  const ready = queue.status === 'ready' && queue.data !== null;

  return (
    <section aria-labelledby="revision-queue-heading">
      <h2 id="revision-queue-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
        {copy.heading}
        {ready && <span className="ml-2 text-xs font-normal text-fg-40">{rows.length}</span>}
      </h2>

      {queue.status === 'loading' && queue.data === null && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                <Skeleton height="1.125rem" width="40%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
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
        <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
      )}

      {ready && rows.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3">
          {rows.map((row) => {
            const name =
              row.creatorName == null || row.creatorName === '' ? copy.creatorGone : row.creatorName;

            return (
              <li key={row.id} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-medium tracking-[-0.02em] wrap-anywhere text-fg">
                      {row.title}
                    </h3>
                    <p className="mt-1 text-sm text-fg-64">
                      {fillPlaceholders(copy.by, { name })}
                      <span className="ml-2 font-mono text-fg-32" title={row.projectId}>
                        {shortId(row.projectId)}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-fg-40">
                      <time dateTime={row.submittedAt} title={formatExactTime(row.submittedAt, locale)}>
                        {fillPlaceholders(copy.submitted, { date: formatDate(row.submittedAt, locale) })}
                      </time>
                    </p>
                  </div>

                  <Link
                    href={`/admin/moderation/revisions/${encodeURIComponent(row.id)}`}
                    aria-label={fillPlaceholders(copy.reviewLabel, { title: row.title })}
                    className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {copy.review}
                  </Link>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-fg-40">{copy.changedLabel}</span>
                  <ul className="flex list-none flex-wrap gap-2">
                    {row.changedFields.map((field) => (
                      <li key={field}>
                        <Tag>{isField(field) ? copy.fields[field] : field}</Tag>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function isField(value: string): value is RevisionField {
  return (REVISION_FIELDS as readonly string[]).includes(value);
}
