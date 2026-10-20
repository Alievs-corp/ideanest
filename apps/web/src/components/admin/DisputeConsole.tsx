'use client';

import { useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
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
} from '@ideanest/ui';
import {
  DISPUTE_OUTCOMES,
  EVIDENCE_KINDS,
  addEvidence,
  hoursUntilDue,
  listDisputes,
  readDispute,
  readDisputeQueue,
  resolveDispute,
  submitEvidence,
  type Dispute,
  type DisputeState,
  type EvidenceKind,
} from '../../lib/admin/disputes';
import { ApiError } from '../../lib/api/problem';
import { actionMessageFor } from '../../lib/admin/refusals';
import { holds } from '../../lib/admin/staff';
import type { DirectoryNames } from '../../lib/admin/directory';
import { formatMoney, toMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { DisputeConsoleCopy } from '../../lib/i18n/admin/money-copy';
import { ConsoleCount } from './ConsoleCount';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName, Identifier } from './ConsoleIdentity';
import { useConsoleMembership } from './ConsoleMembership';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-07: notification, evidence, outcome — issues #68 and #308.
 *
 * <h2>There is no button that opens a dispute</h2>
 *
 * A chargeback is raised by a card network and arrives through a provider webhook. This screen
 * answers cases; it cannot invent one, and the service has no endpoint that would let it.
 *
 * <h2>The deadline is the column everything is sorted by</h2>
 *
 * Everything else about a dispute could be reconstructed from the provider afterwards. A
 * deadline that has passed cannot, and losing by default is the expensive way to lose — so the
 * queue is ordered by it and each row says how long is left. A case with no deadline sorts
 * last rather than first: later is not sooner.
 *
 * <h2>Evidence is assembled and then submitted, in two steps</h2>
 *
 * Because that is how a representment is actually written — over days, by several people. What
 * `submit` does is mark the case answered and record who answered it. <strong>It does not send
 * the documents</strong>, and the screen says so: the provider interface has no evidence
 * submission on it, so the files go through the provider's own console until an adapter method
 * exists. "Mark answered" is off while there is nothing new to send.
 *
 * <h2>An outcome asks first, and says what it costs</h2>
 *
 * Recording `LOST` or `CONCEDED` posts the loss, writes the chargeback's refund and — when the
 * campaign was already paid out — records the creator's debt and suspends their account. The
 * service refuses a second outcome on a closed case, so a mistaken press cannot be pressed back.
 * The first press names the outcome, the amount, the fee and the possible debt; the second
 * records it. The three controls, the evidence form and "mark answered" are drawn only for a
 * reader holding `MANAGE_DISPUTES` — what is offered, never what is allowed.
 *
 * <h2>What an act did is said above the list</h2>
 *
 * The queue is read again after an act, and the row an act happened in may leave it — a closed
 * case is no longer open. So the confirmation is the page's, not the row's, and the list stays
 * drawn while it is read again instead of blinking out.
 *
 * <h2>Closed cases</h2>
 *
 * Below the queue, by outcome — what was lost, conceded or won, newest first.
 *
 * <h2>Motion: none</h2>
 *
 * The admin console has none.
 */
export interface DisputeConsoleProps {
  readonly copy: DisputeConsoleCopy;
}

/** What the page says once an act has landed. */
interface Notice {
  readonly title: string;
  readonly body: string;
}

export function DisputeConsole({ copy }: DisputeConsoleProps) {
  const [page, setPage] = useState(0);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resolvedRound, setResolvedRound] = useState(0);
  const { membership } = useConsoleMembership();
  const canManage = holds(membership, 'MANAGE_DISPUTES');

  const queue = useConsoleResource(
    (signal) => readDisputeQueue(page, signal),
    copy.subject,
    copy.refusals,
    [page],
  );

  const disputes = queue.data?.disputes ?? [];
  const names = useDirectoryNames(
    disputes.map((dispute) => dispute.backerId).filter((id): id is string => id != null),
    disputes.map((dispute) => dispute.projectId),
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  function done(next: Notice, closed: boolean): void {
    setNotice(next);
    queue.reload();
    if (closed) setResolvedRound((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-8">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      <section aria-labelledby="dispute-queue-heading">
        <h2 id="dispute-queue-heading" className="flex items-baseline text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
          {copy.heading}
          {queue.data !== null && (
            <ConsoleCount
              loaded={disputes.length}
              more={queue.data.hasMore}
              copy={copy.count}
              className="ml-2"
            />
          )}
        </h2>

        <div aria-live="polite">
          {notice !== null && (
            <InlineAlert variant="success" title={notice.title} className="mt-4">
              {notice.body}
            </InlineAlert>
          )}
        </div>

        {queue.data === null && queue.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <div className="space-y-3">
              {[0, 1].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="45%" />
                  <Skeleton height="0.875rem" width="70%" className="mt-3" />
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

        {queue.status !== 'failed' && queue.data !== null && disputes.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyTitle}
            description={copy.emptyBody}
          />
        )}

        {queue.status !== 'failed' && disputes.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2" aria-busy={queue.status === 'loading'}>
            {disputes.map((dispute) => (
              <li key={dispute.id}>
                <button
                  type="button"
                  onClick={() => setOpenCase(openCase === dispute.id ? null : dispute.id)}
                  aria-expanded={openCase === dispute.id}
                  className="w-full rounded-lg border border-white/8 bg-surface-1 p-4 text-left hover:border-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                >
                  <CaseSummary dispute={dispute} names={names} copy={copy} />
                </button>

                {openCase === dispute.id && (
                  <CaseDetail
                    disputeId={dispute.id}
                    copy={copy}
                    canManage={canManage}
                    onDone={done}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {queue.status === 'ready' && (page > 0 || (queue.data?.hasMore ?? false)) && (
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

      <ResolvedCases copy={copy} round={resolvedRound} />
    </div>
  );
}

/** The provider in its own brand spelling, and the network's reason in words. */
function providerAndReason(dispute: Dispute, copy: DisputeConsoleCopy): ReactNode {
  const reason = copy.reason[dispute.reasonCode];
  return fillNodes(copy.providerAndReason, {
    provider: copy.provider[dispute.provider] ?? dispute.provider,
    /* A code with no sentence is "another reason", with the code itself beside it — the set is
       the card networks' and they add to it, and whoever quotes it to the provider needs it. */
    code:
      reason ??
      fillNodes(copy.reasonOther, { code: <span className="font-mono">{dispute.reasonCode}</span> }),
  });
}

/** One case's line: amount, provider and reason, deadline, whose pledge and its state. */
function CaseSummary({
  dispute,
  names,
  copy,
  resolvedOn,
}: {
  readonly dispute: Dispute;
  readonly names: DirectoryNames;
  readonly copy: DisputeConsoleCopy;
  readonly resolvedOn?: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white">
          {formatMoney(dispute.amount)}
          <span className="ml-2 text-white/64" title={dispute.reasonCode}>
            {providerAndReason(dispute, copy)}
          </span>
        </p>
        {resolvedOn == null ? (
          <Deadline dispute={dispute} copy={copy} />
        ) : (
          <span className="text-xs text-white/64">{fillPlaceholders(copy.resolvedOn, { date: resolvedOn })}</span>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-2 text-xs text-white/64">
        <span>
          {fillNodes(copy.pledgeLine, {
            backer:
              dispute.backerId == null ? (
                copy.unnamed
              ) : (
                <EntityName id={dispute.backerId} names={names} kind="account" copy={copy.identity} />
              ),
            campaign: <EntityName id={dispute.projectId} names={names} kind="project" copy={copy.identity} />,
            pledge: <Identifier id={dispute.pledgeId} />,
            fee: formatMoney(dispute.fee),
          })}
        </span>
        <Tag>{copy.state[dispute.state]}</Tag>
      </p>
    </>
  );
}

/**
 * How long is left.
 *
 * Three renderings, because they mean different things: a case with no deadline is not urgent,
 * one that has expired cannot be answered, and one with hours left is the reason somebody
 * opened this screen.
 */
function Deadline({
  dispute,
  copy,
}: {
  readonly dispute: Dispute;
  readonly copy: DisputeConsoleCopy;
}) {
  const hours = hoursUntilDue(dispute);

  if (hours === null) {
    return <span className="text-xs text-white/48">{copy.noDeadline}</span>;
  }
  if (hours < 0) {
    return <Tag>{copy.deadlinePassed}</Tag>;
  }
  return (
    <span className="text-xs text-white/64">
      {hours < 48
        ? fillPlaceholders(copy.hoursLeft, { count: String(Math.floor(hours)) })
        : fillPlaceholders(copy.daysLeft, { count: String(Math.floor(hours / 24)) })}
    </span>
  );
}

/** A refusal of an act on a case, in the screen's words where it has some. */
function disputeRefusalMessage(cause: unknown, copy: DisputeConsoleCopy): string {
  const problem = cause instanceof ApiError ? cause.problem : undefined;
  const code = problem?.code;
  if (code === 'DISPUTE_ALREADY_RESOLVED') {
    const state = problem?.meta?.['state'];
    const sentence = copy.errors[code];
    if (sentence !== undefined) {
      return fillPlaceholders(sentence, {
        state: typeof state === 'string' && state in copy.state ? copy.state[state as DisputeState] : '',
      });
    }
  }
  if (code != null) {
    const sentence = copy.errors[code];
    if (sentence !== undefined) return sentence;
  }
  return actionMessageFor(cause, copy.caseSubject, copy.refusals);
}

/** One case, its evidence, and the things staff can do to it. */
function CaseDetail({
  disputeId,
  copy,
  canManage,
  onDone,
}: {
  readonly disputeId: string;
  readonly copy: DisputeConsoleCopy;
  /** Whether the reader holds `MANAGE_DISPUTES` — the evidence form, the answer and the outcome are its. */
  readonly canManage: boolean;
  /** An act landed: what to say, and whether it closed the case. */
  readonly onDone: (notice: Notice, closed: boolean) => void;
}) {
  const detail = useConsoleResource(
    (signal) => readDispute(disputeId, signal),
    copy.caseSubject,
    copy.refusals,
    [disputeId],
  );

  const [kind, setKind] = useState<EvidenceKind>('RECEIPT');
  const [description, setDescription] = useState('');
  const [confirming, setConfirming] = useState<DisputeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>, after: () => void): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      after();
    } catch (cause) {
      setError(disputeRefusalMessage(cause, copy));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (detail.data === null && detail.status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingCase} className="mt-2 rounded-lg border border-white/8 p-4">
        <Skeleton height="0.875rem" width="60%" />
      </SkeletonGroup>
    );
  }

  if (detail.data === null || detail.status === 'failed' || detail.status === 'forbidden' || detail.status === 'signed-out') {
    return (
      <InlineAlert variant="danger" title={copy.caseFailedTitle} className="mt-2">
        {detail.error ?? copy.tryAgainShort}
      </InlineAlert>
    );
  }

  const dispute = detail.data;
  const unsent = dispute.evidence.some((piece) => piece.submittedAt == null);
  const closed = dispute.state === 'WON' || dispute.state === 'LOST' || dispute.state === 'CONCEDED';

  return (
    <div className="mt-2 rounded-lg border border-white/8 bg-surface-1 p-4">
      <h3 className="text-sm font-medium text-white">{copy.evidenceHeading}</h3>

      {dispute.evidence.length === 0 ? (
        <p className="mt-2 text-xs text-white/64">{copy.noEvidence}</p>
      ) : (
        <ul className="mt-2 flex list-none flex-col gap-2">
          {dispute.evidence.map((piece) => (
            <li key={piece.id} className="rounded-md border border-white/8 p-3">
              <p className="text-xs text-white/80">{copy.evidenceKind[piece.kind]}</p>
              <p className="mt-1 text-xs text-white/64">{piece.description}</p>
              <p className="mt-1 text-xs text-white/48">
                {piece.submittedAt == null ? copy.notSent : copy.sent}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canManage && !closed && (
        <>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <Field label={copy.kindLabel} className="min-w-[220px]">
              <Select value={kind} onChange={(event) => setKind(event.target.value as EvidenceKind)}>
                {EVIDENCE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {copy.evidenceKind[option]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={copy.showsLabel} className="min-w-[280px] flex-1">
              <Textarea
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={5000}
              />
            </Field>

            <Pill
              variant="ghost"
              size="sm"
              className="sm:mt-8"
              disabled={description.trim() === ''}
              aria-disabled={busy}
              onClick={() =>
                void act(
                  () => addEvidence(dispute.id, kind, description.trim()),
                  () => {
                    setDescription('');
                    // Only this case changed; the queue's order and states did not.
                    detail.reload();
                  },
                )
              }
            >
              {copy.add}
            </Pill>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-white/8 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill
                variant="outline"
                size="sm"
                disabled={!unsent}
                aria-disabled={busy}
                aria-describedby={unsent ? undefined : `${dispute.id}-nothing-unsent`}
                onClick={() =>
                  void act(
                    () => submitEvidence(dispute.id),
                    () => onDone({ title: copy.doneTitle, body: copy.answeredNotice }, false),
                  )
                }
              >
                {copy.markAnswered}
              </Pill>
              {!unsent && (
                <span id={`${dispute.id}-nothing-unsent`} className="text-xs text-white/64">
                  {copy.nothingUnsent}
                </span>
              )}
            </div>

            {confirming === null ? (
              <div className="flex flex-wrap gap-2">
                {DISPUTE_OUTCOMES.map((outcome) => (
                  <Pill
                    key={outcome}
                    variant="ghost"
                    size="sm"
                    aria-disabled={busy}
                    onClick={() => {
                      setError(null);
                      setConfirming(outcome);
                    }}
                  >
                    {copy.state[outcome]}
                  </Pill>
                ))}
              </div>
            ) : (
              <ConfirmOutcome
                dispute={dispute}
                outcome={confirming}
                copy={copy}
                busy={busy}
                onConfirm={() =>
                  void act(
                    () => resolveDispute(dispute.id, confirming),
                    () =>
                      onDone(
                        {
                          title: copy.doneTitle,
                          body: fillPlaceholders(copy.resolvedNotice, { outcome: copy.state[confirming] }),
                        },
                        true,
                      ),
                  )
                }
                onCancel={() => setConfirming(null)}
              />
            )}
          </div>

          <p className="mt-3 text-xs text-white/64">{copy.outcomeNote}</p>
        </>
      )}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}

/**
 * The second press: what this outcome does to the money, said before it is done. A loss or a
 * concession names the amount, the fee and the debt a paid-out creator would owe; a win says
 * nothing moves. Either way the outcome is final — the service refuses a second one.
 */
function ConfirmOutcome({
  dispute,
  outcome,
  copy,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly dispute: Dispute;
  readonly outcome: DisputeState;
  readonly copy: DisputeConsoleCopy;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const label = copy.state[outcome];
  const loss = outcome !== 'WON';
  const total =
    dispute.amount.currency === dispute.fee.currency
      ? formatMoney(toMoney(new Decimal(dispute.amount.amount).plus(dispute.fee.amount), dispute.amount.currency))
      : `${formatMoney(dispute.amount)} + ${formatMoney(dispute.fee)}`;

  return (
    <div role="group" aria-label={copy.confirmHeading} className="flex flex-col gap-2">
      <p className="max-w-[62ch] text-sm text-white">
        {loss
          ? fillPlaceholders(copy.confirmLoss, {
              outcome: label,
              amount: formatMoney(dispute.amount),
              fee: formatMoney(dispute.fee),
            })
          : fillPlaceholders(copy.confirmWon, { outcome: label })}
      </p>
      {loss && <p className="max-w-[62ch] text-sm text-white">{fillPlaceholders(copy.confirmDebt, { total })}</p>}
      <p className="max-w-[62ch] text-sm text-white">{copy.confirmFinal}</p>
      <div className="flex flex-wrap gap-2">
        <Pill size="sm" autoFocus aria-disabled={busy} onClick={onConfirm}>
          {busy ? copy.resolving : copy.confirmAction}
        </Pill>
        <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Pill>
      </div>
    </div>
  );
}

/** The three outcomes a closed case can carry, as the chips over the closed list. */
const CLOSED_STATES: readonly DisputeState[] = ['LOST', 'CONCEDED', 'WON'];

/**
 * Closed cases, one outcome at a time — `listDisputes`, newest first. Read-only: a closed case
 * cannot be resolved again, and the evidence on it was what it was.
 */
function ResolvedCases({ copy, round }: { readonly copy: DisputeConsoleCopy; readonly round: number }) {
  const locale = useRouteLocale();
  const [state, setState] = useState<DisputeState>('LOST');
  const [page, setPage] = useState(0);

  const closed = useConsoleResource(
    (signal) => listDisputes(state, page, signal),
    copy.resolvedSubject,
    copy.refusals,
    [state, page, round],
  );
  const disputes = closed.data?.disputes ?? [];
  const names = useDirectoryNames(
    disputes.map((dispute) => dispute.backerId).filter((id): id is string => id != null),
    disputes.map((dispute) => dispute.projectId),
  );

  if (closed.status === 'signed-out' || closed.status === 'forbidden') return null;

  return (
    <section aria-labelledby="dispute-closed-heading">
      <h2 id="dispute-closed-heading" className="flex items-baseline text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
        {copy.resolvedHeading}
        {closed.status === 'ready' && closed.data !== null && (
          <ConsoleCount loaded={disputes.length} more={closed.data.hasMore} copy={copy.count} className="ml-2" />
        )}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.resolvedIntro}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CLOSED_STATES.map((option) => (
          <Pill
            key={option}
            variant={state === option ? 'outline' : 'ghost'}
            size="sm"
            aria-pressed={state === option}
            onClick={() => {
              setState(option);
              setPage(0);
            }}
          >
            {copy.state[option]}
          </Pill>
        ))}
      </div>

      {closed.status === 'loading' && (
        <SkeletonGroup label={copy.loadingResolved} className="mt-4">
          <Skeleton height="4rem" />
        </SkeletonGroup>
      )}

      {closed.status === 'failed' && (
        <>
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {closed.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={closed.reload}>
            {copy.tryAgain}
          </Pill>
        </>
      )}

      {closed.status === 'ready' && disputes.length === 0 && (
        <EmptyState
          className="mt-4"
          variant="filtered"
          title={fillPlaceholders(copy.resolvedEmpty, { state: copy.state[state] })}
        />
      )}

      {closed.status === 'ready' && disputes.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-2">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="rounded-lg border border-white/8 bg-surface-1 p-4">
              <CaseSummary
                dispute={dispute}
                names={names}
                copy={copy}
                resolvedOn={dispute.resolvedAt == null ? '' : formatDate(dispute.resolvedAt, locale)}
              />
            </li>
          ))}
        </ul>
      )}

      {closed.status === 'ready' && (page > 0 || (closed.data?.hasMore ?? false)) && (
        <div className="mt-4 flex gap-2">
          <Pill variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            {copy.previous}
          </Pill>
          <Pill
            variant="ghost"
            size="sm"
            disabled={!(closed.data?.hasMore ?? false)}
            onClick={() => setPage((n) => n + 1)}
          >
            {copy.next}
          </Pill>
        </div>
      )}
    </section>
  );
}
