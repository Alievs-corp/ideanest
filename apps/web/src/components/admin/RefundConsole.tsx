'use client';

import { useState } from 'react';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Tag,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import {
  REFUND_REASONS,
  issueRefund,
  listRefunds,
  newRefundKey,
  type Refund,
  type RefundReason,
  type RefundState,
} from '../../lib/admin/refunds';
import { consoleMessageFor, shortId } from '../../lib/admin/refusals';
import { formatMoney } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { RefundConsoleCopy } from '../../lib/i18n/admin/money-copy';
import type { DirectoryNames } from '../../lib/admin/directory';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

const STATES: readonly RefundState[] = ['REQUESTED', 'SUCCEEDED', 'FAILED'];

/**
 * §4.11's AD-06: full and partial refunds with reason codes — issues #67 and #307.
 *
 * <h2>REQUESTED is the state worth watching, and it is the default filter</h2>
 *
 * A refund that stays `REQUESTED` is one the platform decided on and did not complete: the
 * provider was called and the answer was lost, or the job has not run. Both mean somebody is
 * still waiting for their money, and neither shows up anywhere else — so the screen opens on
 * that filter rather than on everything.
 *
 * <h2>The idempotency key belongs to the form, not to the request</h2>
 *
 * It is made when the form is opened and reused if the send fails and somebody presses again.
 * A key generated inside the request would be a new key on every retry, which is the same as
 * having none — and on this screen that is money leaving twice.
 *
 * <h2>Leaving the amount blank refunds the rest</h2>
 *
 * Deliberately, rather than pre-filling the pledge total. A figure computed from a page loaded
 * before an earlier partial refund would be both wrong and confident; blank makes the service
 * work it out from the row it has locked.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 puts motion at its lowest as money gets closer, and nothing on this
 * platform is closer to money than a button that sends it back.
 */
export interface RefundConsoleProps {
  readonly copy: RefundConsoleCopy;
}

export function RefundConsole({ copy }: RefundConsoleProps) {
  const [state, setState] = useState<RefundState | null>('REQUESTED');
  const [page, setPage] = useState(0);

  const refunds = useConsoleResource(
    (signal) => listRefunds({ state, page, signal }),
    copy.subject,
    copy.refusals,
    [state, page],
  );

  const [pledgeId, setPledgeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('BACKER_REQUEST');
  const [detail, setDetail] = useState('');
  const [key, setKey] = useState(newRefundKey);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Refund | null>(null);

  /* Who asked for each refund — #402. A refund is a privileged act, and "requested by
     4a10278a" is a record nobody can read back. */
  const names = useDirectoryNames(
    (refunds.data?.refunds ?? [])
      .map((refund) => refund.requestedBy)
      .filter((id): id is string => id != null),
    [],
  );

  if (refunds.status === 'signed-out' || refunds.status === 'forbidden') {
    return <ConsoleRefusal status={refunds.status} capability={refunds.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  async function send(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const pledge = pledgeId.trim();
    if (pledge === '' || detail.trim() === '') return;

    setBusy(true);
    setWriteError(null);
    setIssued(null);
    try {
      const refund = await issueRefund({
        pledgeId: pledge,
        // Blank is "the rest of it". The currency is the campaign's, and the service
        // refuses one that disagrees rather than converting -- §21.2.
        amount: amount.trim() === '' ? null : { amount: amount.trim(), currency: 'AZN' },
        reason,
        detail: detail.trim(),
        idempotencyKey: key,
      });

      setIssued(refund);
      setPledgeId('');
      setAmount('');
      setDetail('');
      // A fresh key for the next refund. The one just used is spent: replaying it would
      // return this same row rather than sending anything, which is correct and is not
      // what somebody filling the form in again means.
      setKey(newRefundKey());
      refunds.reload();
    } catch (cause) {
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="issue-refund-heading">
        <h2 id="issue-refund-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.issueHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.issueIntro}</p>

        <form onSubmit={(event) => void send(event)} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={copy.pledgeLabel} hint={copy.pledgeHint} className="min-w-[280px] flex-1">
              <TextInput
                value={pledgeId}
                onChange={(event) => setPledgeId(event.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>

            <Field label={copy.amountLabel} hint={copy.amountHint} className="min-w-[160px]">
              <TextInput
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="25.00"
              />
            </Field>

            <Field label={copy.reasonLabel} className="min-w-[220px]">
              <Select
                value={reason}
                onChange={(event) => setReason(event.target.value as RefundReason)}
              >
                {REFUND_REASONS.map((option) => (
                  <option key={option} value={option}>
                    {copy.reason[option]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={copy.noteLabel} hint={copy.noteHint}>
            <Textarea
              rows={2}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={2000}
            />
          </Field>

          <div>
            <Pill type="submit" variant="outline" size="sm" disabled={busy}>
              {busy ? copy.sending : copy.issue}
            </Pill>
          </div>
        </form>

        {issued && (
          <InlineAlert
            variant={issued.state === 'SUCCEEDED' ? 'success' : 'warning'}
            title={
              issued.state === 'SUCCEEDED'
                ? copy.sentTitle
                : fillPlaceholders(copy.pendingTitle, { state: copy.state[issued.state] })
            }
            className="mt-4"
          >
            {fillPlaceholders(copy.issuedBody, {
              amount: formatMoney(issued.amount),
              id: shortId(issued.pledgeId),
            })}
            {issued.failureMessage
              ? ` ${fillPlaceholders(copy.providerSaid, { message: issued.failureMessage })}`
              : ''}
          </InlineAlert>
        )}
        {writeError && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {writeError}
          </InlineAlert>
        )}
      </section>

      <section aria-labelledby="refund-log-heading">
        <h2 id="refund-log-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.logHeading}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[null, ...STATES].map((option) => (
            <Pill
              key={option ?? 'all'}
              variant={state === option ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => {
                setState(option);
                setPage(0);
              }}
            >
              {option === null ? copy.all : copy.state[option]}
            </Pill>
          ))}
        </div>

        {refunds.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="40%" />
                  <Skeleton height="0.875rem" width="65%" className="mt-3" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}

        {refunds.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {refunds.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={refunds.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {refunds.status === 'ready' && refunds.data !== null && refunds.data.refunds.length === 0 && (
          <EmptyState
            className="mt-4"
            variant={state === null ? 'empty' : 'filtered'}
            title={
              state === null
                ? copy.emptyTitle
                : fillPlaceholders(copy.filteredTitle, { state: copy.state[state] })
            }
            description={state === null ? copy.emptyBody : copy.filteredBody}
          />
        )}

        {refunds.status === 'ready' && refunds.data !== null && refunds.data.refunds.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {refunds.data.refunds.map((refund) => (
              <RefundRow key={refund.id} refund={refund} names={names} copy={copy} />
            ))}
          </ul>
        )}

        {refunds.status === 'ready' && (page > 0 || (refunds.data?.hasMore ?? false)) && (
          <div className="mt-4 flex gap-2">
            <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              {copy.previous}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              disabled={!(refunds.data?.hasMore ?? false)}
              onClick={() => setPage((n) => n + 1)}
            >
              {copy.next}
            </Pill>
          </div>
        )}
      </section>
    </div>
  );
}

/** One refund. The reason is a tag because it is the thing this list is counted by. */
function RefundRow({
  names,
  refund,
  copy,
}: {
  readonly refund: Refund;
  readonly names: DirectoryNames;
  readonly copy: RefundConsoleCopy;
}) {
  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white">
          {formatMoney(refund.amount)}
          <span className="ml-2 text-white/48">
            {fillNodes(copy.onPledge, {
              fullness: refund.fullRefund ? copy.full : copy.partial,
              id: <span className="font-mono">{shortId(refund.pledgeId)}</span>,
            })}
          </span>
        </p>
        <Tag>{copy.state[refund.state]}</Tag>
      </div>

      <p className="mt-2 text-xs text-white/64">
        {fillPlaceholders(copy.reasonAndDetail, {
          reason: copy.reason[refund.reason],
          detail: refund.detail,
        })}
      </p>

      <p className="mt-2 text-xs text-white/40">
        {fillNodes(copy.requestedBy, {
          /* IDN-EXT-01 (#40): a campaign refund has no staff author; the platform issued it. */
          by:
            refund.requestedBy == null ? (
              copy.platform
            ) : (
              <EntityName
                id={refund.requestedBy}
                names={names}
                kind="account"
                copy={copy.identity}
              />
            ),
          date: new Date(refund.requestedAt).toISOString().slice(0, 10),
        })}
        {refund.failureCode
          ? ` · ${fillPlaceholders(copy.refused, { code: refund.failureCode })}`
          : ''}
      </p>
    </li>
  );
}
