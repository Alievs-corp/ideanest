'use client';

import { useState } from 'react';
import { Chip, ChipRow, EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import type { AdminPayoutDestination } from '../../lib/admin/api';
import {
  readPayoutDestinationQueue,
  type PayoutDestinationQueueState,
} from '../../lib/admin/payout-destinations';
import { shortId } from '../../lib/admin/refusals';
import { holds } from '../../lib/admin/staff';
import type { PayoutDestinationQueueCopy } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import { Link } from '../../i18n/navigation';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleMembership } from './ConsoleMembership';
import { DESTINATION_STANDING_TONE, PayoutDestinationReview } from './PayoutDestinationReview';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * COMPLIANCE's queue of payout destinations — issue #396, part of epic #392.
 *
 * <h2>What it lists, and where the filter is applied</h2>
 *
 * `GET /v1/admin/payout-destinations` answers every destination that is not verified, oldest
 * first, fifty to a page. The three states a reviewer works through (waiting, name mismatch,
 * rejected) are chips, and since #419 a chip asks the service rather than narrowing the page
 * it holds: filtered in the browser, "nothing in this state" meant only "nothing among these
 * fifty". Choosing a chip goes back to the first page, and the pager is `PayoutQueue`'s.
 *
 * <p>A destination under a waiver (#436) is drawn as one: the service reports the standing the
 * payout gate reads, and that is `WAIVED` whatever the row underneath says. The chip narrows
 * by the row's state, so a waived destination is found under the state it is in, still tagged
 * as waived — a reviewer looking for rejected accounts is looking for this one too.
 *
 * <h2>The decision is on the row</h2>
 *
 * `PayoutDestinationReview` argues it: the account screen needs `ADMINISTER_ACCOUNTS`, which
 * the compliance role does not hold, so the row is the only place a compliance reviewer can
 * reveal the IBAN and decide. A decided row is redrawn from the service's answer rather than
 * removed, so the reviewer sees what they did; the next read of the queue drops it.
 *
 * <p>The link to the account is drawn only for a reader who can open it.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in lists, and §5 gives the console none.
 */
export interface PayoutDestinationQueueProps {
  readonly copy: PayoutDestinationQueueCopy;
}

/** The states a reviewer filters by. `WAIVED` is not one: see the docblock. */
const FILTERS: readonly PayoutDestinationQueueState[] = Object.freeze([
  'AWAITING_VERIFICATION',
  'NAME_MISMATCH',
  'REJECTED',
]);

export function PayoutDestinationQueue({ copy }: PayoutDestinationQueueProps) {
  const locale = useRouteLocale();
  const { membership } = useConsoleMembership();
  const [filter, setFilter] = useState<PayoutDestinationQueueState | null>(null);
  const [page, setPage] = useState(0);

  const queue = useConsoleResource(
    (signal) => readPayoutDestinationQueue({ state: filter, page, signal }),
    copy.subject,
    copy.refusals,
    [filter, page],
  );

  const rows = queue.data?.destinations ?? [];
  const names = useDirectoryNames(
    rows.map((row) => row.creatorId),
    [],
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return (
      <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />
    );
  }

  const ready = queue.status === 'ready' && queue.data !== null;
  const canReveal = holds(membership, 'READ_BANK_DETAILS');
  const canOpenAccount = holds(membership, 'ADMINISTER_ACCOUNTS');
  const destination = copy.destination;

  function replace(next: AdminPayoutDestination): void {
    if (queue.data === null) return;
    queue.set({
      ...queue.data,
      destinations: rows.map((row) => (row.creatorId === next.creatorId ? next : row)),
    });
  }

  function choose(next: PayoutDestinationQueueState | null): void {
    setFilter(next);
    setPage(0);
  }

  return (
    <section aria-label={copy.subject}>
      <ChipRow aria-label={copy.filterLabel}>
        <Chip active={filter === null} onClick={() => choose(null)}>
          {copy.everything}
        </Chip>
        {FILTERS.map((option) => (
          <Chip key={option} active={filter === option} onClick={() => choose(option)}>
            {destination.standing[option] ?? option}
          </Chip>
        ))}
      </ChipRow>

      {queue.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
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

      {/*
        Three empty answers, because they send a reviewer three different ways: past the last
        page (a full page with nothing behind it offers a next one), a state with nothing in
        it, and a queue with nothing in it at all.
      */}
      {ready && rows.length === 0 && page > 0 && (
        <EmptyState className="mt-4" variant="empty" title={copy.emptyPageTitle} description={copy.emptyPageBody} />
      )}

      {ready && rows.length === 0 && page === 0 && filter === null && (
        <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
      )}

      {ready && rows.length === 0 && page === 0 && filter !== null && (
        <EmptyState className="mt-4" variant="empty" title={copy.emptyFilterTitle} description={copy.emptyFilterBody} />
      )}

      {ready && rows.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3">
          {rows.map((row) => {
            const name = names.accounts.get(row.creatorId)?.name ?? shortId(row.creatorId);
            const updated = row.updatedAt == null ? null : formatDate(row.updatedAt, locale);

            return (
              <li key={row.creatorId} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <EntityName id={row.creatorId} names={names} kind="account" copy={copy.identity} copyable />
                    <p className="mt-1 text-sm text-white/64">
                      {row.displayHint != null && <span className="font-mono text-white/80">{row.displayHint}</span>}
                      {row.holderName != null &&
                        ` · ${fillPlaceholders(destination.holder, { name: row.holderName })}`}
                    </p>
                    {(updated !== null || row.rejectionReason != null) && (
                      <p className="mt-1 text-xs text-white/40">
                        {updated !== null && fillPlaceholders(destination.updated, { date: updated })}
                        {updated !== null && row.rejectionReason != null && ' · '}
                        {row.rejectionReason != null &&
                          fillPlaceholders(destination.rejectedFor, {
                            reason: destination.rejectionReason[row.rejectionReason] ?? row.rejectionReason,
                          })}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {row.kind != null && <Tag>{destination.kind[row.kind] ?? row.kind}</Tag>}
                    <Tag variant={DESTINATION_STANDING_TONE[row.standing] ?? 'default'}>
                      {destination.standing[row.standing] ?? row.standing}
                    </Tag>
                  </div>
                </div>

                <div className="mt-4">
                  <PayoutDestinationReview
                    destination={row}
                    copy={destination}
                    subject={copy.subject}
                    refusals={copy.refusals}
                    canReveal={canReveal}
                    onDecided={replace}
                  />
                </div>

                {canOpenAccount && (
                  <Link
                    href={`/admin/users/${encodeURIComponent(row.creatorId)}`}
                    aria-label={fillPlaceholders(copy.openAccountLabel, { name })}
                    className="mt-4 inline-block rounded-lg text-sm text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {copy.openAccount}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {ready && (page > 0 || (queue.data?.hasMore ?? false)) && (
        <div className="mt-4 flex gap-2">
          <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            {copy.previous}
          </Pill>
          <Pill
            variant="ghost"
            size="sm"
            disabled={!(queue.data?.hasMore ?? false)}
            onClick={() => setPage((n) => n + 1)}
          >
            {copy.next}
          </Pill>
        </div>
      )}
    </section>
  );
}
