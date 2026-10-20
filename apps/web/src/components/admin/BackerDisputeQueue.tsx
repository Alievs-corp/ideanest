'use client';

import { useState, type ReactNode } from 'react';
import { Link } from '../../i18n/navigation';
import { EmptyState, Field, InlineAlert, Pill, Skeleton, SkeletonGroup, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  BACKER_DISPUTE_PAGE_SIZE,
  decideBackerDispute,
  readBackerDisputeQueue,
  type BackerDispute,
  type BackerDisputeOutcome,
} from '../../lib/admin/backer-disputes';
import { actionMessageFor, capabilityLabel } from '../../lib/admin/refusals';
import { holds } from '../../lib/admin/staff';
import type { DirectoryNames } from '../../lib/admin/directory';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { BackerDisputeQueueCopy } from '../../lib/i18n/admin/money-copy';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName, Identifier } from './ConsoleIdentity';
import { useConsoleMembership } from './ConsoleMembership';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * AD-07's second queue: disputes backers opened while a payout was held — IDN-EXT-01 (#43, #44).
 *
 * <h2>Why beside the chargebacks and not a screen of its own</h2>
 *
 * Both are "somebody wants money back and staff decide", and the person working one queue is the
 * person who should see the other. They are not the same thing — a chargeback comes from a card
 * network with a deadline, a backer dispute comes from the backer with a reason — so they are two
 * sections, each with its own words.
 *
 * <h2>Upholding asks first, and says how much</h2>
 *
 * It refunds the backer everything the pledge has left through the provider and recalculates the
 * payout; there is no undo. So each row says what upholding would send, by name of backer and
 * campaign, and the first press repeats it and asks; the second decides. Rejecting moves no money
 * and is one press. Upholding is offered only to a reader who also holds `ISSUE_REFUND`, which the
 * refund needs.
 *
 * <h2>What a decision did is said above the list</h2>
 *
 * A decided dispute leaves the queue, and the list is read again: a sentence said in its row
 * would go with it. So the outcome — upheld and how much, rejected, or already decided by
 * somebody else — is the section's, and survives the reload. A refund that waits for a bank
 * transfer says so and points to the refunds screen, where that transfer is made.
 *
 * <h2>Paging</h2>
 *
 * The queue answers a bare array of at most fifty; a shorter page is the last one.
 *
 * <h2>Motion: none</h2>
 *
 * The admin console's budget is none.
 */
export interface BackerDisputeQueueProps {
  readonly copy: BackerDisputeQueueCopy;
}

/** What the section says once a decision has landed. */
interface Outcome {
  readonly variant: 'success' | 'info';
  readonly title: string;
  readonly body: string;
}

export function BackerDisputeQueue({ copy }: BackerDisputeQueueProps) {
  const [page, setPage] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const queue = useConsoleResource((signal) => readBackerDisputeQueue(page, signal), copy.subject, copy.refusals, [page]);
  const { membership } = useConsoleMembership();
  const canRefund = holds(membership, 'ISSUE_REFUND');

  const disputes = queue.data ?? [];
  const names = useDirectoryNames(
    disputes.map((dispute) => dispute.backerId).filter((id): id is string => id != null),
    disputes.map((dispute) => dispute.projectId),
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  function decided(next: Outcome): void {
    setOutcome(next);
    queue.reload();
  }

  const lastPage = disputes.length < BACKER_DISPUTE_PAGE_SIZE;

  return (
    <section aria-labelledby="backer-dispute-queue-heading">
      <h2 id="backer-dispute-queue-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

      <div aria-live="polite">
        {outcome !== null && (
          <InlineAlert variant={outcome.variant} title={outcome.title} className="mt-4">
            {outcome.body}
          </InlineAlert>
        )}
      </div>

      {queue.data === null && queue.status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <Skeleton height="5rem" />
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

      {queue.status !== 'failed' && queue.data !== null && disputes.length === 0 && (
        <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
      )}

      {queue.status !== 'failed' && disputes.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3" aria-busy={queue.status === 'loading'}>
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <DisputeCase dispute={dispute} names={names} copy={copy} canRefund={canRefund} onDecided={decided} />
            </li>
          ))}
        </ul>
      )}

      {queue.status === 'ready' && (page > 0 || !lastPage) && (
        <div className="mt-4 flex gap-2">
          <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            {copy.previous}
          </Pill>
          <Pill variant="ghost" size="sm" disabled={lastPage} onClick={() => setPage((n) => n + 1)}>
            {copy.next}
          </Pill>
        </div>
      )}
    </section>
  );
}

function DisputeCase({
  dispute,
  names,
  copy,
  canRefund,
  onDecided,
}: {
  readonly dispute: BackerDispute;
  readonly names: DirectoryNames;
  readonly copy: BackerDisputeQueueCopy;
  /** Whether the reader holds `ISSUE_REFUND`, which upholding refunds with. */
  readonly canRefund: boolean;
  readonly onDecided: (outcome: Outcome) => void;
}) {
  const locale = useRouteLocale();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode | null>(null);

  const amount = dispute.refundable == null ? copy.everythingLeft : formatMoney(dispute.refundable);

  async function decide(outcome: BackerDisputeOutcome) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const decided = await decideBackerDispute(dispute.id, outcome, note.trim() === '' ? null : note.trim());
      onDecided(
        decided.state === 'UPHELD'
          ? {
              variant: 'success',
              title: copy.doneTitle,
              body:
                dispute.refundable == null
                  ? copy.upheldNoticeNoAmount
                  : fillPlaceholders(copy.upheldNotice, { amount: formatMoney(dispute.refundable) }),
            }
          : { variant: 'success', title: copy.doneTitle, body: copy.rejectedNotice },
      );
    } catch (cause) {
      const problem = cause instanceof ApiError ? cause.problem : undefined;
      const code = problem?.code;
      if (code === 'DISPUTE_ALREADY_DECIDED') {
        // Somebody else decided it: the list is read again, so say it where the reload leaves it.
        onDecided({ variant: 'info', title: copy.doneTitle, body: copy.alreadyDecided });
      } else if (code === 'DISPUTE_REFUND_FAILED' && problem?.meta?.['awaitingBankTransfer'] === true) {
        setError(
          fillNodes(copy.refundAwaitingBank, {
            link: (
              <Link
                href="/admin/refunds"
                className="rounded underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                {copy.refundsLink}
              </Link>
            ),
          }),
        );
      } else if (code === 'DISPUTE_REFUND_FAILED') {
        setError(copy.refundFailed);
      } else {
        setError((code != null ? copy.errors[code] : undefined) ?? actionMessageFor(cause, copy.subject, copy.refusals));
      }
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <p className="whitespace-pre-line text-sm text-white">{dispute.reason}</p>
      <p className="mt-2 text-xs text-white/64">
        {fillNodes(copy.pledgeLine, {
          backer:
            dispute.backerId == null ? (
              copy.unnamed
            ) : (
              <EntityName id={dispute.backerId} names={names} kind="account" copy={copy.identity} />
            ),
          campaign: <EntityName id={dispute.projectId} names={names} kind="project" copy={copy.identity} />,
          pledge: <Identifier id={dispute.pledgeId} />,
          date: formatDate(dispute.openedAt, locale),
        })}
      </p>
      {dispute.refundable != null && (
        <p className="mt-2 text-sm text-white">
          {fillPlaceholders(copy.refundableLine, { amount: formatMoney(dispute.refundable) })}
        </p>
      )}

      <div className="mt-4 max-w-[36rem]">
        <Field label={copy.noteLabel} hint={copy.noteHint}>
          <Textarea value={note} rows={2} onChange={(event) => setNote(event.currentTarget.value)} />
        </Field>
      </div>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {confirming ? (
        <div role="group" aria-label={copy.uphold} className="mt-4 flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-white">{fillPlaceholders(copy.confirmUphold, { amount })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Pill variant="accent" size="sm" autoFocus aria-disabled={busy} onClick={() => void decide('UPHOLD')}>
              {busy ? copy.deciding : copy.confirmNow}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setConfirming(false)}>
              {copy.cancel}
            </Pill>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {canRefund && (
              <Pill variant="outline" size="sm" aria-disabled={busy} onClick={() => setConfirming(true)}>
                {copy.uphold}
              </Pill>
            )}
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => void decide('REJECT')}>
              {busy ? copy.deciding : copy.reject}
            </Pill>
          </div>
          {!canRefund && copy.refusals.needsCapabilityToAct !== undefined && (
            <p className="max-w-[62ch] text-xs text-white/64">
              {fillPlaceholders(copy.refusals.needsCapabilityToAct, {
                capability: capabilityLabel('ISSUE_REFUND', copy.refusals),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
