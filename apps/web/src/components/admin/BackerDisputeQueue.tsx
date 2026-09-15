'use client';

import { useState } from 'react';
import { EmptyState, Field, InlineAlert, Pill, Skeleton, SkeletonGroup, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  decideBackerDispute,
  readBackerDisputeQueue,
  type BackerDispute,
  type BackerDisputeOutcome,
} from '../../lib/admin/backer-disputes';
import { consoleMessageFor, shortId } from '../../lib/admin/refusals';
import type { BackerDisputeQueueCopy } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

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
 * <h2>Upholding asks first</h2>
 *
 * It refunds the backer in full through the provider and recalculates the payout; there is no undo.
 * So the first press asks, and the second decides. Rejecting moves no money and is one press. A refund
 * the provider refuses leaves the dispute open (`DISPUTE_REFUND_FAILED`), and a dispute somebody else
 * decided first reloads the list. No motion: the admin console's budget is none.
 */
export interface BackerDisputeQueueProps {
  readonly copy: BackerDisputeQueueCopy;
}

export function BackerDisputeQueue({ copy }: BackerDisputeQueueProps) {
  const [page, setPage] = useState(0);
  const queue = useConsoleResource((signal) => readBackerDisputeQueue(page, signal), copy.subject, copy.refusals, [page]);

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const disputes = queue.data ?? [];

  return (
    <section aria-labelledby="backer-dispute-queue-heading">
      <h2 id="backer-dispute-queue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

      {queue.status === 'loading' && (
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

      {queue.status === 'ready' && disputes.length === 0 && (
        <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
      )}

      {queue.status === 'ready' && disputes.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3">
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <DisputeCase dispute={dispute} copy={copy} onDecided={queue.reload} />
            </li>
          ))}
        </ul>
      )}

      {queue.status === 'ready' && (page > 0 || disputes.length > 0) && (
        <div className="mt-4 flex gap-2">
          <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            {copy.previous}
          </Pill>
          <Pill variant="ghost" size="sm" disabled={disputes.length === 0} onClick={() => setPage((n) => n + 1)}>
            {copy.next}
          </Pill>
        </div>
      )}
    </section>
  );
}

function DisputeCase({
  dispute,
  copy,
  onDecided,
}: {
  readonly dispute: BackerDispute;
  readonly copy: BackerDisputeQueueCopy;
  readonly onDecided: () => void;
}) {
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(outcome: BackerDisputeOutcome) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await decideBackerDispute(dispute.id, outcome, note.trim() === '' ? null : note.trim());
      onDecided();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      if (code === 'DISPUTE_ALREADY_DECIDED') {
        setError(copy.alreadyDecided);
        onDecided();
      } else if (code === 'DISPUTE_REFUND_FAILED') {
        setError(copy.refundFailed);
      } else {
        setError(consoleMessageFor(cause, copy.subject, copy.refusals));
      }
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <p className="whitespace-pre-line text-sm text-white">{dispute.reason}</p>
      <p className="mt-2 text-xs text-white/40">
        {fillPlaceholders(copy.pledgeLine, {
          pledge: shortId(dispute.pledgeId),
          project: shortId(dispute.projectId),
          date: dispute.openedAt.slice(0, 10),
        })}
      </p>

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
        <div role="group" aria-label={copy.confirmUphold} className="mt-4 flex flex-wrap items-center gap-2">
          <p className="text-sm text-white">{copy.confirmUphold}</p>
          <Pill variant="accent" size="sm" autoFocus aria-disabled={busy} onClick={() => void decide('UPHOLD')}>
            {busy ? copy.deciding : copy.confirmNow}
          </Pill>
          <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setConfirming(false)}>
            {copy.cancel}
          </Pill>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill variant="outline" size="sm" aria-disabled={busy} onClick={() => setConfirming(true)}>
            {copy.uphold}
          </Pill>
          <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => void decide('REJECT')}>
            {busy ? copy.deciding : copy.reject}
          </Pill>
        </div>
      )}
    </div>
  );
}
