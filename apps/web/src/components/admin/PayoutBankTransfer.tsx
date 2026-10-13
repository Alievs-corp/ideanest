'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Field, InlineAlert, Pill, TextInput, Textarea } from '@ideanest/ui';
import {
  abandonBankTransfer,
  readBankTransfer,
  recordBankTransfer,
  startBankTransfer,
  type BankTransferInstruction,
} from '../../lib/admin/payout-bank-transfers';
import type { DirectoryNames } from '../../lib/admin/directory';
import { bankDay, bankTransferInProgress, type Payout } from '../../lib/admin/payouts';
import { figuresMoved, payoutRefusalFor } from '../../lib/admin/payout-refusals';
import { wasAborted } from '../../lib/admin/refusals';
import { formatMoney } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { PayoutQueueCopy } from '../../lib/i18n/admin/money-copy';
import { EntityName } from './ConsoleIdentity';

/**
 * Paying a payout by hand, from IdeyaNest's bank account — issue #398, epic #392.
 *
 * <h2>Why this replaces Send rather than sitting beside it</h2>
 *
 * A creator whose destination is an IBAN cannot be paid through the provider: the service
 * answers `send` with `PAYOUT_SETTLES_BY_BANK_TRANSFER`. A Send button that is certain to be
 * refused is a control describing an action nobody can take (#405), so for these payouts the
 * file draws this panel where Send used to be.
 *
 * <h2>Three steps, each with its own record</h2>
 *
 * <ol>
 *   <li><strong>Start</strong> re-runs every check `send` makes, marks the payout, and answers
 *       the account. From then on the payout cannot be cancelled or lose a signature, because
 *       the money may have left.
 *   <li><strong>Record</strong> is a person reading the statement: the bank's reference, the
 *       value date, and what they checked. It asks first, because it makes the payout paid and
 *       nothing undoes that.
 *   <li><strong>Abandon</strong> says the money never left, and how that is known.
 * </ol>
 *
 * <h2>The account is fetched on a press and held only while it is on screen</h2>
 *
 * Starting and showing it again are both audited reads of the creator's IBAN, so nothing here
 * asks until somebody presses, a second press while one is in flight does nothing, and the
 * answer lives in this component's state alone: hiding it, closing the file or leaving the page
 * drops it, and seeing it again is another audited read. The sentence saying so is beside the
 * control, before anybody presses it.
 *
 * <h2>The amount is the service's string</h2>
 *
 * Shown through `formatMoney`, which groups the digits as text, and copied as the bare decimal
 * string the service sent — a bank's form wants `1250.00`, not `1,250.00 AZN`. Nothing here
 * parses it into a number.
 *
 * <h2>What is offered is not what is allowed</h2>
 *
 * Every call needs `APPROVE_PAYOUT`, and the two that open the account need `READ_BANK_DETAILS`
 * too. A reader without them is told which, instead of being offered a button the service will
 * refuse. The service still decides.
 *
 * <h2>Loaded only by a file that needs it</h2>
 *
 * `PayoutQueue` imports this lazily: most payouts are sent through the provider and never draw
 * it, and the queue's route carries a First Load JS budget that the panel alone would break.
 *
 * <h2>Motion: none</h2>
 *
 * The step where money leaves.
 */
export interface PayoutBankTransferProps {
  readonly payout: Payout;
  readonly stillNeeded: number;
  /** Whether the reader holds `APPROVE_PAYOUT`. */
  readonly canPay: boolean;
  /** Whether the reader also holds `READ_BANK_DETAILS`, which opening the account needs. */
  readonly canReveal: boolean;
  readonly readerId: string | null;
  readonly names: DirectoryNames;
  readonly copy: PayoutQueueCopy;
  /** The service's answer to a write, so the file and the queue redraw from it without a read. */
  readonly onUpdated: (payout: Payout) => void;
  /**
   * #419: a start refused because the figures moved, which has cancelled the payout. The file says
   * so and reads it again; this panel draws nothing for a cancelled payout, so it cannot.
   */
  readonly onFiguresMoved: (message: string) => void;
}

type Mode = 'idle' | 'confirm-record' | 'abandon';

/** In fours, the way it is printed on a statement and read aloud to a bank. */
export function groupedIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

export function PayoutBankTransfer({
  payout,
  stillNeeded,
  canPay,
  canReveal,
  readerId,
  names,
  copy,
  onUpdated,
  onFiguresMoved,
}: PayoutBankTransferProps) {
  const words = copy.bankTransfer;
  const headingId = useId();
  const auditedId = useId();

  const [instruction, setInstruction] = useState<BankTransferInstruction | null>(null);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reference, setReference] = useState('');
  const [transferredOn, setTransferredOn] = useState(() => bankDay());
  const [recordNote, setRecordNote] = useState('');
  const [abandonNote, setAbandonNote] = useState('');

  const inFlight = useRef<AbortController | null>(null);

  // A read still running when the file closes must not land in a component nobody sees.
  useEffect(() => () => inFlight.current?.abort(), []);

  const started = bankTransferInProgress(payout);

  /** Start and re-reveal: the two audited reads of the account. */
  async function open(read: (signal: AbortSignal) => Promise<BankTransferInstruction>): Promise<void> {
    if (inFlight.current !== null) return;

    const controller = new AbortController();
    inFlight.current = controller;
    setOpening(true);
    setError(null);
    try {
      const answer = await read(controller.signal);
      if (controller.signal.aborted) return;
      setInstruction(answer);
      onUpdated(answer.payout);
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      if (figuresMoved(cause)) onFiguresMoved(payoutRefusalFor(cause, copy, payout));
      else setError(payoutRefusalFor(cause, copy, payout));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setOpening(false);
    }
  }

  async function write(work: () => Promise<Payout>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setMode('idle');
      setInstruction(null);
      onUpdated(next);
    } catch (cause) {
      setError(payoutRefusalFor(cause, copy, payout));
    } finally {
      setBusy(false);
    }
  }

  // A cancelled or failed payout is paid by nobody, by hand or otherwise.
  if (payout.state === 'CANCELLED' || payout.state === 'FAILED') return null;

  const amount = instruction?.amount ?? payout.net;
  const startedOn = payout.bankTransferStartedAt == null ? null : bankDay(new Date(payout.bankTransferStartedAt));
  const today = bankDay();
  const recordReady = reference.trim() !== '' && transferredOn !== '' && recordNote.trim() !== '';

  return (
    <section aria-labelledby={headingId} className="mt-4 border-t border-white/8 pt-4">
      <h4 id={headingId} className="text-sm font-medium text-white">
        {words.heading}
      </h4>
      <p className="mt-1 max-w-[62ch] text-xs text-white/48">{words.intro}</p>

      {payout.state === 'PAID' && payout.bankTransferredOn != null ? (
        <p className="mt-3 text-sm text-white">
          {fillPlaceholders(words.paidOn, { date: payout.bankTransferredOn })}
        </p>
      ) : payout.state !== 'APPROVED' ? (
        <p className="mt-3 text-xs text-white/48">
          {stillNeeded > 0
            ? `${words.notApproved} ${fillPlaceholders(copy.needsMore, { count: String(stillNeeded) })}.`
            : words.notApproved}
        </p>
      ) : !canPay ? (
        <p className="mt-3 text-xs text-white/48">{words.needsApprovePayout}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {started && payout.bankTransferStartedBy != null && (
            <p className="text-sm text-white/80">
              {fillNodes(words.transferStarted, {
                who: (
                  <EntityName
                    id={payout.bankTransferStartedBy}
                    names={names}
                    kind="account"
                    copy={copy.identity}
                  />
                ),
                date: startedOn ?? '',
              })}
              {readerId === payout.bankTransferStartedBy ? ` — ${copy.thisIsYou}` : ''}
            </p>
          )}

          {instruction !== null ? (
            <Instruction instruction={instruction} copy={copy} onHide={() => setInstruction(null)} />
          ) : (
            <div className="flex flex-col gap-2">
              <p id={auditedId} className="max-w-[62ch] text-xs text-white/48">
                {words.audited}
              </p>
              {!canReveal && <p className="text-xs text-white/48">{words.needsReadBankDetails}</p>}
              {!started && stillNeeded > 0 && (
                <p className="text-xs text-white/48">
                  {fillPlaceholders(copy.needsMore, { count: String(stillNeeded) })}
                </p>
              )}
              <div>
                <Pill
                  variant="outline"
                  size="sm"
                  aria-describedby={auditedId}
                  aria-disabled={opening}
                  disabled={
                    !canReveal || (!started && (stillNeeded > 0 || payout.heldForDestination))
                  }
                  onClick={() =>
                    void open((signal) =>
                      started ? readBankTransfer(payout.id, signal) : startBankTransfer(payout.id, signal),
                    )
                  }
                >
                  {opening ? words.starting : started ? words.revealIban : words.startTransfer}
                </Pill>
              </div>
            </div>
          )}

          {started && (
            <RecordAndAbandon
              amount={amount}
              mode={mode}
              setMode={setMode}
              busy={busy}
              reference={reference}
              setReference={setReference}
              transferredOn={transferredOn}
              setTransferredOn={setTransferredOn}
              recordNote={recordNote}
              setRecordNote={setRecordNote}
              abandonNote={abandonNote}
              setAbandonNote={setAbandonNote}
              recordReady={recordReady}
              min={startedOn ?? undefined}
              max={today}
              copy={copy}
              onRecord={() =>
                void write(() =>
                  recordBankTransfer(payout.id, {
                    bankReference: reference.trim(),
                    transferredOn,
                    note: recordNote.trim(),
                  }),
                )
              }
              onAbandon={() => void write(() => abandonBankTransfer(payout.id, abandonNote.trim()))}
            />
          )}
        </div>
      )}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </section>
  );
}

/** What to type into the bank's form, each with a copy control. */
function Instruction({
  instruction,
  copy,
  onHide,
}: {
  readonly instruction: BankTransferInstruction;
  readonly copy: PayoutQueueCopy;
  readonly onHide: () => void;
}) {
  const words = copy.bankTransfer;

  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <dl className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-4">
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-white/48">{words.amountLabel}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/*
              The currency is part of the figure and as large as it, because a transfer typed in
              the wrong currency is a different amount of money.
            */}
            <span className="text-2xl font-semibold tracking-[-0.02em] text-white">
              {formatMoney(instruction.amount)}
            </span>
            <CopyValue value={instruction.amount.amount} field={words.amountLabel} copy={copy} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-white/48">{words.ibanLabel}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="select-all break-all font-mono text-base text-white">
              {groupedIban(instruction.iban)}
            </span>
            <CopyValue value={instruction.iban.replace(/\s+/g, '')} field={words.ibanLabel} copy={copy} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-white/48">{words.holderLabel}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm text-white">{instruction.holderName}</span>
            <CopyValue value={instruction.holderName} field={words.holderLabel} copy={copy} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-white/48">{words.descriptionLabel}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="break-all font-mono text-sm text-white">{instruction.description}</span>
            <CopyValue value={instruction.description} field={words.descriptionLabel} copy={copy} />
          </dd>
        </div>
      </dl>
      <div>
        <Pill variant="ghost" size="sm" onClick={onHide}>
          {words.hide}
        </Pill>
      </div>
    </div>
  );
}

/**
 * Puts one value on the clipboard. `CopyIdentifier`'s behaviour, with a name per field.
 *
 * <p>The accessible name says which field, because four controls all called "Copy" are four
 * controls nobody can tell apart by name. A refused clipboard is silent, as there: the value is
 * selectable text beside the control.
 */
function CopyValue({
  value,
  field,
  copy,
}: {
  readonly value: string;
  readonly field: string;
  readonly copy: PayoutQueueCopy;
}) {
  const words = copy.bankTransfer;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function put(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        type="button"
        onClick={() => void put()}
        aria-label={fillPlaceholders(words.copyField, { field })}
        className="rounded text-xs text-white/48 underline decoration-dotted underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
      >
        {words.copy}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-white/48">
        {copied ? words.copied : ''}
      </span>
    </span>
  );
}

/** The record form, its confirmation, and abandoning. Only drawn while a transfer is in progress. */
function RecordAndAbandon({
  amount,
  mode,
  setMode,
  busy,
  reference,
  setReference,
  transferredOn,
  setTransferredOn,
  recordNote,
  setRecordNote,
  abandonNote,
  setAbandonNote,
  recordReady,
  min,
  max,
  copy,
  onRecord,
  onAbandon,
}: {
  readonly amount: Payout['net'];
  readonly mode: Mode;
  readonly setMode: (mode: Mode) => void;
  readonly busy: boolean;
  readonly reference: string;
  readonly setReference: (value: string) => void;
  readonly transferredOn: string;
  readonly setTransferredOn: (value: string) => void;
  readonly recordNote: string;
  readonly setRecordNote: (value: string) => void;
  readonly abandonNote: string;
  readonly setAbandonNote: (value: string) => void;
  readonly recordReady: boolean;
  readonly min: string | undefined;
  readonly max: string;
  readonly copy: PayoutQueueCopy;
  readonly onRecord: () => void;
  readonly onAbandon: () => void;
}) {
  const words = copy.bankTransfer;
  const recordHeadingId = useId();

  if (mode === 'abandon') {
    return (
      <form
        aria-label={words.abandonTransfer}
        className="flex flex-col gap-3 border-t border-white/8 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (abandonNote.trim() === '') return;
          onAbandon();
        }}
      >
        <p className="max-w-[62ch] text-sm text-white">{words.abandonIntro}</p>
        <Field label={words.abandonNoteLabel} required className="max-w-[520px]">
          <Textarea rows={3} value={abandonNote} onChange={(event) => setAbandonNote(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Pill type="submit" variant="danger" size="sm" disabled={abandonNote.trim() === ''} aria-disabled={busy}>
            {busy ? words.abandoning : words.confirmAbandon}
          </Pill>
          <Pill type="button" variant="ghost" size="sm" aria-disabled={busy} onClick={() => setMode('idle')}>
            {words.back}
          </Pill>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/8 pt-4">
      <h5 id={recordHeadingId} className="text-sm font-medium text-white">
        {words.recordHeading}
      </h5>
      <p className="max-w-[62ch] text-xs text-white/48">{words.recordIntro}</p>

      {mode === 'confirm-record' ? (
        <div role="group" aria-labelledby={recordHeadingId} className="flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-white">
            {fillPlaceholders(words.confirmRecord, {
              amount: formatMoney(amount),
              reference: reference.trim(),
              date: transferredOn,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Pill size="sm" autoFocus aria-disabled={busy} onClick={onRecord}>
              {busy ? words.recording : words.confirmRecordAction}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setMode('idle')}>
              {words.back}
            </Pill>
          </div>
        </div>
      ) : (
        <form
          aria-labelledby={recordHeadingId}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (recordReady) setMode('confirm-record');
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={words.bankReference} hint={words.bankReferenceHint} required className="min-w-[240px] flex-1">
              <TextInput value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} />
            </Field>
            {/*
              `type="date"`, as on the audit trail: the browser renders the reader's format over a
              value that is always `YYYY-MM-DD`. The bounds are the service's own — the day the
              transfer started and today, both in Baku.
            */}
            <Field label={words.transferredOn} hint={words.transferredOnHint} required className="min-w-[180px]">
              <TextInput
                type="date"
                value={transferredOn}
                min={min}
                max={max}
                onChange={(event) => setTransferredOn(event.target.value)}
              />
            </Field>
          </div>
          <Field label={words.noteLabel} hint={words.recordNoteHint} required className="max-w-[520px]">
            <Textarea
              rows={2}
              value={recordNote}
              maxLength={2000}
              onChange={(event) => setRecordNote(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Pill type="submit" variant="outline" size="sm" disabled={!recordReady}>
              {words.recordTransfer}
            </Pill>
            <Pill type="button" variant="ghost" size="sm" onClick={() => setMode('abandon')}>
              {words.abandonTransfer}
            </Pill>
          </div>
        </form>
      )}
    </div>
  );
}
