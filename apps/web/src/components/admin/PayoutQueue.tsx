'use client';

import { Suspense, lazy, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
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
  TextInput,
  Textarea,
} from '@ideanest/ui';
import {
  SETTLED_STATES,
  approvePayout,
  bankTransferInProgress,
  calculatePayout,
  cancelPayout,
  listPayouts,
  readPayout,
  readPayoutQueue,
  recordUnconfirmedNotSent,
  recordUnconfirmedSent,
  sendPayout,
  withdrawApproval,
  type Payout,
  type PayoutState,
} from '../../lib/admin/payouts';
import { holds, readMembership, type StaffMembership } from '../../lib/admin/staff';
import { calculateRefusalFor, figuresMoved, payoutRefusalFor } from '../../lib/admin/payout-refusals';
import { isIdentifier } from '../../lib/admin/coded-refusal';
import { bakuDate, bakuDateTime, calendarDate } from '../../lib/admin/console-dates';
import { shortId } from '../../lib/admin/refusals';
import { formatMoney, type Money } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { Locale } from '../../lib/i18n/locale';
import type { DirectoryNames } from '../../lib/admin/directory';
import type { PayoutQueueCopy } from '../../lib/i18n/admin/money-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-05: the payout queue and its approvals — issues #69 and #306.
 *
 * <h2>Every figure is shown, and they add up</h2>
 *
 * This is where somebody signs off money leaving the platform. The breakdown is a statement: what
 * came in, each deduction beneath it — the platform's fee, processing, refunds, tax and anything
 * withheld towards the creator's debts — and the net under a rule. Deductions that are zero are left
 * out, because a column of "− 0.00" is noise that hides the one line that is not.
 *
 * <h2>`payableNow` and `stillNeeded` come from the service</h2>
 *
 * A client comparing `payableAt` to its own clock would offer a signature a few seconds early, and
 * the browser cannot see that two approval rows are two different accounts.
 *
 * <h2>What a send came back as is said, and the payout can be found afterwards</h2>
 *
 * `send` answers 200 for three different outcomes: the money moved (`PAID`), the provider refused it
 * (`FAILED`), or the provider never answered (still `APPROVED`, with `sendUnconfirmedAt`). The queue
 * lists only payouts still on their way, so a paid or failed one leaves it; the outcome is said above
 * the queue, by name, and the history below lists what has left it. A send nobody answered stays in
 * the queue with the two resolutions the service offers from the provider's statement.
 *
 * <h2>Controls match the reader and the payout</h2>
 *
 * Signing, sending and cancelling are drawn only for a reader holding `APPROVE_PAYOUT`; anybody else
 * is told, in words, what it would take. Approve is offered only on a payout that is waiting for a
 * signature, past its hold, held on nothing, and not already signed by the reader. Send and Cancel
 * each ask first, naming the amount, the creator and the campaign: the first moves money and the
 * second cannot be undone. **None of this is a permission check** — the service decides all of it.
 *
 * <h2>A creator paid into a bank account is paid by hand — issue #398</h2>
 *
 * The service refuses to `send` a payout whose destination is an IBAN, so for those the file draws
 * `PayoutBankTransfer` where Send was.
 *
 * <h2>Motion: none</h2>
 *
 * The last screen on the platform that should feel eager.
 */
/**
 * The "transfer by hand" panel, fetched when a file draws it — #398. `React.lazy` rather than
 * `next/dynamic`: the file renders only in the browser, after its read.
 */
const PayoutBankTransfer = lazy(() =>
  import('./PayoutBankTransfer').then((module) => ({ default: module.PayoutBankTransfer })),
);

export interface PayoutQueueProps {
  readonly copy: PayoutQueueCopy;
}

/** Something said above the queue that outlives the row it was about. */
interface Notice {
  readonly variant: 'success' | 'danger' | 'warning' | 'info';
  readonly title: string;
  readonly body: ReactNode;
}

const IN_FLIGHT: readonly PayoutState[] = ['CALCULATED', 'PENDING_APPROVAL', 'APPROVED'];

export function PayoutQueue({ copy }: PayoutQueueProps) {
  const locale = useRouteLocale();
  const [page, setPage] = useState(0);
  const [openPayout, setOpenPayout] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calculated, setCalculated] = useState<Payout | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settled, setSettled] = useState<PayoutState>('PAID');
  const [historyPage, setHistoryPage] = useState(0);

  const queue = useConsoleResource(
    (signal) => readPayoutQueue(page, signal),
    copy.subject,
    copy.refusals,
    [page],
  );

  const history = useConsoleResource(
    (signal) => listPayouts(settled, historyPage, signal),
    copy.subject,
    copy.refusals,
    [settled, historyPage],
  );

  /*
   * Who is reading, so the file offers only what they can do (#405). Read once here: `/v1/admin/me`
   * answers the same thing every time, and a read per opened row would be a request per click.
   */
  const me = useConsoleResource(
    (signal) => readMembership(signal),
    copy.meSubject,
    copy.refusals,
    [],
  );

  const everyPayout = [...(queue.data?.payouts ?? []), ...(history.data?.payouts ?? [])];
  /* The creators, the campaigns, and whoever started a bank transfer, named — #402, #398. */
  const names = useDirectoryNames(
    everyPayout.flatMap((payout) =>
      payout.bankTransferStartedBy == null ? [payout.creatorId] : [payout.creatorId, payout.bankTransferStartedBy],
    ),
    [...everyPayout.map((payout) => payout.projectId), ...(calculated === null ? [] : [calculated.projectId])],
  );

  if (queue.status === 'signed-out' || queue.status === 'forbidden') {
    return <ConsoleRefusal status={queue.status} capability={queue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const who = whoFor(names);

  /*
   * A bank-transfer write answers the payout as it now stands, and the row takes it without a read:
   * reloading the queue would unmount the open file and the account the reader is copying from.
   */
  function updated(next: Payout): void {
    if (queue.data === null) return;
    queue.set({
      ...queue.data,
      payouts: queue.data.payouts.map((payout) => (payout.id === next.id ? next : payout)),
    });
  }

  /** A write that took the payout out of the queue, or changed what the queue should say about it. */
  function settledNow(next: Notice, closeFile: boolean): void {
    setNotice(next);
    if (closeFile) setOpenPayout(null);
    queue.reload();
    history.reload();
  }

  /** What `send` came back as — three different things behind one 200. */
  function sent(payout: Payout): void {
    const words = copy.outcome;
    const facts = {
      amount: formatMoney(payout.net),
      creator: who.creator(payout.creatorId),
      campaign: who.campaign(payout.projectId),
    };
    if (payout.state === 'PAID') {
      settledNow({ variant: 'success', title: words.paidTitle, body: fillPlaceholders(words.paidBody, facts) }, true);
    } else if (payout.state === 'FAILED') {
      settledNow(
        {
          variant: 'danger',
          title: words.failedTitle,
          body: fillPlaceholders(words.failedBody, { ...facts, reason: failureOf(payout, words.noReason) }),
        },
        true,
      );
    } else {
      settledNow(
        { variant: 'warning', title: words.unconfirmedTitle, body: fillPlaceholders(words.unconfirmedBody, facts) },
        false,
      );
    }
  }

  async function calculate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const id = projectId.trim();
    if (id === '') return;
    if (!isIdentifier(id)) {
      setError(copy.campaignInvalid);
      return;
    }

    setBusy(true);
    setError(null);
    setCalculated(null);
    try {
      const payout = await calculatePayout(id);
      setCalculated(payout);
      setProjectId('');
      queue.reload();
    } catch (cause) {
      setError(calculateRefusalFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="calculate-heading">
        <h2 id="calculate-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.calculateHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.calculateIntro}</p>

        <form onSubmit={(event) => void calculate(event)} className="mt-4 flex flex-wrap items-start gap-3">
          <Field label={copy.campaignLabel} hint={copy.campaignHint} className="min-w-[280px] flex-1">
            <TextInput
              value={projectId}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
          {/* Aligned with the input rather than with the hint under it. */}
          <Pill type="submit" variant="outline" size="sm" className="mt-8" disabled={busy}>
            {busy ? copy.working : copy.calculate}
          </Pill>
        </form>

        {calculated !== null && (
          <InlineAlert variant="success" title={copy.calculatedTitle} className="mt-4">
            {fillNodes(copy.calculatedNotice, {
              amount: formatMoney(calculated.net),
              campaign: <EntityName id={calculated.projectId} names={names} kind="project" copy={copy.identity} />,
              date: bakuDate(calculated.payableAt, locale),
            })}
          </InlineAlert>
        )}
        {error && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {error}
          </InlineAlert>
        )}
      </section>

      <section aria-labelledby="payout-queue-heading">
        <h2 id="payout-queue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.queueHeading}
          {queue.status === 'ready' && (
            <span className="ml-2 text-xs font-normal text-white/40">{queue.data?.payouts.length ?? 0}</span>
          )}
        </h2>

        {notice !== null && (
          <InlineAlert variant={notice.variant} title={notice.title} className="mt-4">
            {notice.body}
          </InlineAlert>
        )}

        {queue.status === 'loading' && (
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

        {queue.status === 'ready' && queue.data !== null && queue.data.payouts.length === 0 && (
          <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
        )}

        {queue.status === 'ready' && queue.data !== null && queue.data.payouts.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {queue.data.payouts.map((payout) => (
              <PayoutRow
                key={payout.id}
                payout={payout}
                names={names}
                copy={copy}
                open={openPayout === payout.id}
                onToggle={() => setOpenPayout(openPayout === payout.id ? null : payout.id)}
              >
                <PayoutDetail
                  payoutId={payout.id}
                  readerId={me.data?.accountId ?? null}
                  membership={me.data}
                  names={names}
                  copy={copy}
                  locale={locale}
                  onChanged={queue.reload}
                  onUpdated={updated}
                  onSent={sent}
                  onSettled={(next) => settledNow(next, true)}
                />
              </PayoutRow>
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

      <section aria-labelledby="payout-history-heading">
        <h2 id="payout-history-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.history.heading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.history.intro}</p>

        <ChipRow aria-label={copy.history.filterLabel} className="mt-4">
          {SETTLED_STATES.map((state) => (
            <Chip
              key={state}
              active={settled === state}
              onClick={() => {
                setSettled(state);
                setHistoryPage(0);
              }}
            >
              {copy.state[state]}
            </Chip>
          ))}
        </ChipRow>

        {history.status === 'loading' && history.data === null && (
          <SkeletonGroup label={copy.history.loading} className="mt-4">
            <Skeleton height="1rem" width="45%" />
          </SkeletonGroup>
        )}

        {history.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {history.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={history.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {history.status === 'ready' && history.data !== null && history.data.payouts.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.history.emptyTitle}
            description={copy.history.emptyBody}
          />
        )}

        {history.status === 'ready' && history.data !== null && history.data.payouts.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {history.data.payouts.map((payout) => (
              <HistoryRow key={payout.id} payout={payout} names={names} copy={copy} locale={locale} />
            ))}
          </ul>
        )}

        {history.status === 'ready' && (historyPage > 0 || (history.data?.hasMore ?? false)) && (
          <div className="mt-4 flex gap-2">
            <Pill variant="ghost" size="sm" disabled={historyPage === 0} onClick={() => setHistoryPage((n) => n - 1)}>
              {copy.previous}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              disabled={!(history.data?.hasMore ?? false)}
              onClick={() => setHistoryPage((n) => n + 1)}
            >
              {copy.next}
            </Pill>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------- */

/** Names as plain text, for sentences and accessible names; the eight-character fragment until they load. */
function whoFor(names: DirectoryNames) {
  return {
    creator: (id: string) => names.accounts.get(id)?.name ?? shortId(id),
    campaign: (id: string) => names.projects.get(id)?.title ?? shortId(id),
  };
}

/** The provider's own words for a refusal, with its code, which is what somebody quotes back to it. */
function failureOf(payout: Payout, none: string): string {
  const message = payout.failureMessage?.trim();
  const code = payout.failureCode?.trim();
  if (message && code) return `${message} (${code})`;
  return message || code || none;
}

/* -------------------------------------------------------------------------
 * One row of the queue
 * ---------------------------------------------------------------------- */

function PayoutRow({
  payout,
  names,
  copy,
  open,
  onToggle,
  children,
}: {
  readonly payout: Payout;
  readonly names: DirectoryNames;
  readonly copy: PayoutQueueCopy;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const fileId = useId();
  const who = whoFor(names);
  const summary = fillPlaceholders(copy.rowSummary, {
    campaign: who.campaign(payout.projectId),
    creator: who.creator(payout.creatorId),
    amount: formatMoney(payout.net),
    state: copy.state[payout.state],
  });
  const word = open ? copy.close : copy.open;

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">
            <EntityName id={payout.projectId} names={names} kind="project" copy={copy.identity} />
          </p>
          <p className="mt-1 text-xs text-white/64">
            {fillNodes(copy.toCreator, {
              id: <EntityName id={payout.creatorId} names={names} kind="account" copy={copy.identity} />,
            })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag>{copy.state[payout.state]}</Tag>
            {!payout.payableNow && <Tag>{copy.held}</Tag>}
            {/* #431 and #432: each hold is its own tag, because each is chased by somebody different. */}
            {payout.heldForVerification && <Tag variant="warning">{copy.verificationHeld}</Tag>}
            {payout.heldForDestination && <Tag variant="warning">{copy.destinationHeld}</Tag>}
            {bankTransferInProgress(payout) && <Tag>{copy.bankTransfer.inProgressTag}</Tag>}
            {payout.sendUnconfirmedAt != null && <Tag variant="warning">{copy.unconfirmed.title}</Tag>}
          </div>
        </div>

        <Pill
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? fileId : undefined}
          aria-label={`${word}: ${summary}`}
          onClick={onToggle}
        >
          {word}
          <ChevronDown aria-hidden="true" className={open ? 'ml-1 size-4 rotate-180' : 'ml-1 size-4'} />
        </Pill>
      </div>

      <div className="px-4 pb-4">
        <Breakdown payout={payout} copy={copy} />
      </div>

      {open && (
        <div id={fileId} className="border-t border-white/8 p-4">
          {children}
        </div>
      )}
    </li>
  );
}

/** Whether a figure is zero, read off its decimal string: nothing here does arithmetic on money. */
function isZero(money: Money | null | undefined): boolean {
  return money == null || /^0*(\.0*)?$/.test(money.amount);
}

/**
 * The figures as a statement, in the order they subtract: gross, each deduction that is not zero, and
 * the net under a rule. The minus signs are the component's, not the catalogue's — arithmetic notation,
 * and a translation that lost one would turn a deduction into an addition.
 */
function Breakdown({ payout, copy }: { readonly payout: Payout; readonly copy: PayoutQueueCopy }) {
  const deductions: ReadonlyArray<readonly [string, Money | null | undefined]> = [
    [copy.platformFee, payout.platformFee],
    [copy.processing, payout.processingFee],
    [copy.refunded, payout.refunded],
    [copy.taxWithheld, payout.taxWithheld],
    [copy.debtWithheld, payout.debtWithheld],
  ];

  return (
    <dl className="grid w-full max-w-[420px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      <dt className="text-white/64">{copy.collected}</dt>
      <dd className="text-right font-mono tabular-nums text-white/80">{formatMoney(payout.gross)}</dd>
      {deductions
        .filter(([, amount]) => !isZero(amount))
        .map(([label, amount]) => (
          <Line key={label} label={label} value={`− ${formatMoney(amount)}`} />
        ))}
      <dt className="mt-1 border-t border-white/8 pt-1 font-medium text-white">{copy.net}</dt>
      <dd className="mt-1 border-t border-white/8 pt-1 text-right font-mono text-base font-medium tabular-nums text-white">
        {formatMoney(payout.net)}
      </dd>
    </dl>
  );
}

function Line({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt className="text-white/48">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-white/64">{value}</dd>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Asking first
 * ---------------------------------------------------------------------- */

/** The second step of a control that moves money or cannot be undone: what is about to happen, then do it. */
function Confirm({
  label,
  text,
  action,
  working,
  back,
  busy,
  onConfirm,
  onBack,
}: {
  readonly label: string;
  readonly text: string;
  readonly action: string;
  readonly working: string;
  readonly back: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full flex-col gap-2 rounded-lg border border-white/16 p-3">
      <p className="max-w-[62ch] text-sm text-white">{text}</p>
      <div className="flex flex-wrap gap-2">
        <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => (busy ? undefined : onConfirm())}>
          {busy ? working : action}
        </Pill>
        <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => (busy ? undefined : onBack())}>
          {back}
        </Pill>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One payout's file
 * ---------------------------------------------------------------------- */

type Asking = 'none' | 'send' | 'cancel';

/**
 * One payout, who has signed it, and what can be done to it.
 *
 * <p>`readerId` is null while `/v1/admin/me` is still loading, and so is `membership`: nothing that
 * needs `APPROVE_PAYOUT` is drawn until the answer arrives, rather than drawn and then taken away.
 */
function PayoutDetail({
  payoutId,
  readerId,
  membership,
  names,
  copy,
  locale,
  onChanged,
  onUpdated,
  onSent,
  onSettled,
}: {
  readonly payoutId: string;
  readonly readerId: string | null;
  readonly membership: StaffMembership | null;
  readonly names: DirectoryNames;
  readonly copy: PayoutQueueCopy;
  readonly locale: Locale;
  readonly onChanged: () => void;
  readonly onUpdated: (payout: Payout) => void;
  readonly onSent: (payout: Payout) => void;
  readonly onSettled: (notice: Notice) => void;
}) {
  const file = useConsoleResource(
    (signal) => readPayout(payoutId, signal),
    copy.payoutSubject,
    copy.refusals,
    [payoutId],
  );

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking>('none');

  async function act(work: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      file.reload();
      onChanged();
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  function refused(cause: unknown): void {
    setAsking('none');
    const message = payoutRefusalFor(cause, copy, file.data?.payout, locale);
    if (figuresMoved(cause)) void cancelledUnderneath(message);
    else setError(message);
  }

  async function send(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await sendPayout(payoutId);
      setAsking('none');
      // An unanswered send stays in the queue, so its file is read again to offer the resolution.
      if (outcome.state === 'APPROVED') file.reload();
      onSent(outcome);
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelPayout(payoutId);
      onSettled({ variant: 'info', title: copy.state.CANCELLED, body: copy.cancelledNotice });
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  /*
   * #419: the figures moved and the service has cancelled this payout (#421), so the file and its
   * queue row are read again rather than left offering it. Read and set rather than `reload`, which
   * would unmount the file and the sentence saying what happened and what to do next.
   */
  async function cancelledUnderneath(message: string): Promise<void> {
    setError(message);
    try {
      const next = await readPayout(payoutId);
      file.set(next);
      onUpdated(next.payout);
    } catch {
      // The sentence already says to work out a new payout; the queue's next read shows the rest.
    }
  }

  if (file.status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingPayout}>
        <Skeleton height="0.875rem" width="60%" />
      </SkeletonGroup>
    );
  }

  if (file.status !== 'ready' || file.data === null) {
    return (
      <InlineAlert variant="danger" title={copy.payoutFailedTitle}>
        {file.error ?? copy.tryAgainShort}
      </InlineAlert>
    );
  }

  const { payout, approvals, stillNeeded } = file.data;
  const who = whoFor(names);
  const facts = {
    amount: formatMoney(payout.net),
    creator: who.creator(payout.creatorId),
    campaign: who.campaign(payout.projectId),
  };

  const canAct = holds(membership, 'APPROVE_PAYOUT');
  const inFlight = IN_FLIGHT.includes(payout.state);
  const iHaveSigned = readerId !== null && approvals.some((one) => one.approverId === readerId);
  const held = payout.heldForVerification || payout.heldForDestination;
  const waiting = payout.state === 'CALCULATED' || payout.state === 'PENDING_APPROVAL';
  const signable = waiting && payout.payableNow && !held && !iHaveSigned;
  // #398. Paid into a bank account by hand rather than sent, and while a transfer is in progress
  // the money may have left, so neither cancelling nor withdrawing a signature is offered.
  const byBankTransfer = payout.destinationKind === 'BANK_TRANSFER';
  const transferring = bankTransferInProgress(payout);
  const unconfirmed = payout.state === 'APPROVED' && payout.sendUnconfirmedAt != null;
  const current = file.data;

  /* Why Approve is not drawn, in the order a reader can do something about it. */
  const notSignable = !inFlight || signable
    ? null
    : iHaveSigned
      ? copy.youHaveSigned
      : payout.state === 'APPROVED'
        ? copy.alreadyApproved
        : !payout.payableNow
          ? fillPlaceholders(copy.awaitingHold, { date: bakuDate(payout.payableAt, locale) })
          : copy.heldNoSign;

  return (
    <div>
      <h3 className="text-sm font-medium text-white">
        {copy.signatures}
        <span className="ml-2 text-xs font-normal text-white/48">
          {fillPlaceholders(copy.signatureCount, {
            have: String(approvals.length),
            need: String(payout.approvalsRequired),
          })}
        </span>
      </h3>

      {approvals.length === 0 ? (
        <p className="mt-2 text-xs text-white/48">
          {copy.noSignatures}
          {payout.approvalsRequired > 1 ? ` ${copy.needsTwo}` : ''}
        </p>
      ) : (
        <ul className="mt-2 flex list-none flex-col gap-1">
          {approvals.map((approval) => (
            <li key={approval.approverId} className="text-xs text-white/64">
              {fillNodes(copy.approvalLine, {
                approver: <EntityName id={approval.approverId} names={names} kind="account" copy={copy.identity} />,
                date: bakuDateTime(approval.approvedAt, locale),
              })}
              {approval.note ? ` — ${approval.note}` : ''}
              {readerId === approval.approverId ? ` — ${copy.thisIsYou}` : ''}
            </li>
          ))}
        </ul>
      )}

      {!payout.payableNow && inFlight && (
        <InlineAlert variant="info" title={copy.stillHeldTitle} className="mt-4">
          {fillPlaceholders(copy.stillHeldBody, { date: bakuDate(payout.payableAt, locale) })}
        </InlineAlert>
      )}

      {payout.heldForVerification && (
        <InlineAlert variant="warning" title={copy.verificationHeldTitle} className="mt-4">
          {fillPlaceholders(copy.verificationHeldBody, { standing: copy.standing[payout.creatorStanding] })}
        </InlineAlert>
      )}

      {/*
        #432: there is deliberately nothing on this screen that decides where money goes; the account
        is the creator's to supply and a compliance reviewer's to confirm.
      */}
      {payout.heldForDestination && (
        <InlineAlert variant="warning" title={copy.destinationHeldTitle} className="mt-4">
          {fillPlaceholders(copy.destinationHeldBody, {
            standing: copy.destinationStanding[payout.destinationStanding],
          })}
        </InlineAlert>
      )}

      {unconfirmed && (
        <UnconfirmedSend
          payout={payout}
          canAct={canAct}
          copy={copy}
          locale={locale}
          onResolved={(next) =>
            onSettled({
              variant: next.state === 'PAID' ? 'success' : 'info',
              title: copy.state[next.state],
              body: next.state === 'PAID' ? copy.unconfirmed.resolvedSent : copy.unconfirmed.resolvedNotSent,
            })
          }
        />
      )}

      {inFlight && !canAct && membership !== null && (
        <p className="mt-4 border-t border-white/8 pt-4 text-xs text-white/48">{copy.needsApprovePayout}</p>
      )}

      {inFlight && canAct && (
        <div className="mt-4 flex flex-col gap-3 border-t border-white/8 pt-4">
          {signable ? (
            <div className="flex flex-wrap items-start gap-3">
              <Field label={copy.noteLabel} hint={copy.noteHint} className="min-w-[240px] flex-1">
                <TextInput value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <Pill
                variant="outline"
                size="sm"
                className="mt-8"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await approvePayout(payoutId, note.trim() === '' ? null : note.trim());
                    setNote('');
                  })
                }
              >
                {copy.approve}
              </Pill>
            </div>
          ) : (
            notSignable !== null && <p className="text-xs text-white/48">{notSignable}</p>
          )}

          {/* Offered only to somebody who has a signature to take back. */}
          {iHaveSigned && (
            <div>
              <Pill
                variant="ghost"
                size="sm"
                disabled={busy || transferring}
                onClick={() => void act(() => withdrawApproval(payoutId))}
              >
                {copy.withdrawMine}
              </Pill>
            </div>
          )}
        </div>
      )}

      {byBankTransfer && (
        <Suspense
          fallback={
            <SkeletonGroup label={copy.loadingPayout} className="mt-4 border-t border-white/8 pt-4">
              <Skeleton height="0.875rem" width="40%" />
            </SkeletonGroup>
          }
        >
          <PayoutBankTransfer
            payout={payout}
            stillNeeded={stillNeeded}
            canPay={holds(membership, 'APPROVE_PAYOUT')}
            canReveal={holds(membership, 'READ_BANK_DETAILS')}
            readerId={readerId}
            names={names}
            copy={copy}
            onUpdated={(next) => {
              file.set({ ...current, payout: next });
              onUpdated(next);
            }}
            onFiguresMoved={(message) => void cancelledUnderneath(message)}
          />
        </Suspense>
      )}

      {inFlight && canAct && (
        <div className="mt-4 flex flex-col gap-3">
          {asking === 'send' ? (
            <Confirm
              label={copy.send}
              text={fillPlaceholders(copy.confirmSend, facts)}
              action={copy.confirmSendAction}
              working={copy.sending}
              back={copy.back}
              busy={busy}
              onConfirm={() => void send()}
              onBack={() => setAsking('none')}
            />
          ) : asking === 'cancel' ? (
            <Confirm
              label={copy.cancelPayout}
              text={fillPlaceholders(copy.confirmCancel, facts)}
              action={copy.confirmCancelAction}
              working={copy.cancelling}
              back={copy.back}
              busy={busy}
              onConfirm={() => void cancel()}
              onBack={() => setAsking('none')}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {/*
                #398: not drawn for a creator paid into a bank account, which the service refuses to
                send. The panel above is that payout's way out.
              */}
              {!byBankTransfer && payout.state === 'APPROVED' && (
                <>
                  <Pill
                    variant="outline"
                    size="sm"
                    disabled={busy || stillNeeded > 0 || payout.heldForDestination}
                    onClick={() => {
                      setError(null);
                      setAsking('send');
                    }}
                  >
                    {copy.send}
                  </Pill>
                  {stillNeeded > 0 && (
                    <span className="text-xs text-white/48">
                      {fillPlaceholders(copy.sendNeedsSignatures, { count: String(stillNeeded) })}
                    </span>
                  )}
                  {stillNeeded === 0 && payout.heldForDestination && (
                    <span className="text-xs text-white/48">{copy.sendHeldForDestination}</span>
                  )}
                </>
              )}

              <Pill
                variant="ghost"
                size="sm"
                disabled={busy || transferring || unconfirmed}
                onClick={() => {
                  setError(null);
                  setAsking('cancel');
                }}
              >
                {copy.cancelPayout}
              </Pill>
              {transferring && (
                <span className="text-xs text-white/48">{copy.refusal.PAYOUT_BANK_TRANSFER_IN_PROGRESS}</span>
              )}
              {unconfirmed && <span className="text-xs text-white/48">{copy.refusal.PAYOUT_SEND_UNCONFIRMED}</span>}
            </div>
          )}
        </div>
      )}

      {error && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * A send nobody answered
 * ---------------------------------------------------------------------- */

type Resolving = 'idle' | 'sent' | 'not-sent' | 'confirm-sent' | 'confirm-not-sent';

/**
 * The two ways out of a send the provider never answered, from its statement (#184's review): it was
 * sent, under this transaction, or it was not. Both are a person's reading of a statement, so both
 * take a note and both ask first — the second especially, because if the money did leave, recording
 * it as not sent lets the campaign be paid twice.
 */
function UnconfirmedSend({
  payout,
  canAct,
  copy,
  locale,
  onResolved,
}: {
  readonly payout: Payout;
  readonly canAct: boolean;
  readonly copy: PayoutQueueCopy;
  readonly locale: Locale;
  readonly onResolved: (payout: Payout) => void;
}) {
  const words = copy.unconfirmed;
  const [mode, setMode] = useState<Resolving>('idle');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = formatMoney(payout.net);

  async function record(sent: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = sent
        ? await recordUnconfirmedSent(payout.id, reference.trim(), note.trim())
        : await recordUnconfirmedNotSent(payout.id, note.trim());
      onResolved(next);
    } catch (cause) {
      setError(payoutRefusalFor(cause, copy, payout, locale));
      setMode(sent ? 'sent' : 'not-sent');
    } finally {
      setBusy(false);
    }
  }

  const ready = note.trim() !== '' && (mode === 'not-sent' || reference.trim() !== '');

  return (
    <div className="mt-4">
      <InlineAlert variant="warning" title={words.title}>
        {fillPlaceholders(words.body, { date: bakuDateTime(payout.sendUnconfirmedAt ?? payout.calculatedAt, locale) })}
      </InlineAlert>

      {canAct && mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill variant="outline" size="sm" onClick={() => setMode('sent')}>
            {words.sent}
          </Pill>
          <Pill variant="ghost" size="sm" onClick={() => setMode('not-sent')}>
            {words.notSent}
          </Pill>
        </div>
      )}

      {canAct && (mode === 'sent' || mode === 'not-sent') && (
        <form
          aria-label={mode === 'sent' ? words.sent : words.notSent}
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) setMode(mode === 'sent' ? 'confirm-sent' : 'confirm-not-sent');
          }}
        >
          {mode === 'sent' && (
            <Field label={words.transactionLabel} hint={words.transactionHint} required className="max-w-[420px]">
              <TextInput
                value={reference}
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          )}
          <Field label={words.noteLabel} hint={words.noteHint} required>
            <Textarea rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Pill type="submit" variant="outline" size="sm" disabled={!ready}>
              {mode === 'sent' ? words.sent : words.notSent}
            </Pill>
            <Pill variant="ghost" size="sm" onClick={() => setMode('idle')}>
              {copy.back}
            </Pill>
          </div>
        </form>
      )}

      {canAct && (mode === 'confirm-sent' || mode === 'confirm-not-sent') && (
        <div className="mt-3">
          <Confirm
            label={mode === 'confirm-sent' ? words.sent : words.notSent}
            text={
              mode === 'confirm-sent'
                ? fillPlaceholders(words.confirmSent, { amount, reference: reference.trim() })
                : fillPlaceholders(words.confirmNotSent, { amount })
            }
            action={words.confirmAction}
            working={words.recording}
            back={copy.back}
            busy={busy}
            onConfirm={() => void record(mode === 'confirm-sent')}
            onBack={() => setMode(mode === 'confirm-sent' ? 'sent' : 'not-sent')}
          />
        </div>
      )}

      {error && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-3">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One payout that has left the queue
 * ---------------------------------------------------------------------- */

function HistoryRow({
  payout,
  names,
  copy,
  locale,
}: {
  readonly payout: Payout;
  readonly names: DirectoryNames;
  readonly copy: PayoutQueueCopy;
  readonly locale: Locale;
}) {
  const words = copy.history;
  const when =
    payout.state === 'PAID'
      ? fillPlaceholders(words.paidOn, {
          date:
            payout.bankTransferredOn != null
              ? calendarDate(payout.bankTransferredOn, locale)
              : bakuDate(payout.sentAt ?? payout.calculatedAt, locale),
        })
      : payout.state === 'FAILED'
        ? fillPlaceholders(words.failedOn, { date: bakuDate(payout.sentAt ?? payout.calculatedAt, locale) })
        : fillPlaceholders(words.calculatedOn, { date: bakuDate(payout.calculatedAt, locale) });

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">
            <EntityName id={payout.projectId} names={names} kind="project" copy={copy.identity} />
          </p>
          <p className="mt-1 text-xs text-white/64">
            {fillNodes(copy.toCreator, {
              id: <EntityName id={payout.creatorId} names={names} kind="account" copy={copy.identity} />,
            })}
          </p>
          <p className="mt-1 text-xs text-white/48">{when}</p>
          {payout.state === 'FAILED' && (
            <p className="mt-1 text-xs text-white/64">
              {fillPlaceholders(words.failure, { reason: failureOf(payout, copy.outcome.noReason) })}
            </p>
          )}
        </div>
        <Tag variant={payout.state === 'PAID' ? 'success' : payout.state === 'FAILED' ? 'danger' : 'default'}>
          {copy.state[payout.state]}
        </Tag>
      </div>
      <div className="mt-3">
        <Breakdown payout={payout} copy={copy} />
      </div>
    </li>
  );
}
