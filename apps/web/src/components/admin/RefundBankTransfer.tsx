'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { Refund, RefundBankTransfer } from '../../lib/admin/refunds';
import {
  recordRefundBankTransfer,
  revealRefundBankDetails,
  routeRefundToBankTransfer,
  todayInBaku,
  type RevealedRefundBankDetails,
} from '../../lib/admin/refund-bank-transfers';
import { actionMessageFor, shortId, statusFor, wasAborted } from '../../lib/admin/refusals';
import { bankFeeFrom } from '../../lib/admin/bank-fee';
import type { DirectoryNames } from '../../lib/admin/directory';
import { formatMoney } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { Locale } from '../../lib/i18n/locale';
import { formatDate } from '../../lib/time';
import type { RefundBankTransferCopy, RefundConsoleCopy } from '../../lib/i18n/admin/money-copy';
import { EntityName, Identifier } from './ConsoleIdentity';

/**
 * A refund paid by bank transfer, on its row of the refund console — issue #400, part of #392.
 *
 * <h2>Three people, in order</h2>
 *
 * A refund past the provider's window waits for support to record the backer's account from
 * their ticket (`AWAITING_BANK_DETAILS`), then for finance to reveal it, make the transfer from
 * IdeyaNest's bank and record it with the bank's reference (`AWAITING_TRANSFER`). The row says
 * which of those it is waiting for and who did the step before, by name.
 *
 * <h2>Whoever recorded the account does not record the transfer</h2>
 *
 * The service refuses it (`REFUND_DUTIES_NOT_SEPARATE`, and a CHECK beneath that), so the row does
 * not offer it either: to the member of staff who recorded the account it explains the rule in
 * place of the reveal and the form. Neither control would do them any good — the number is the
 * one they typed, and the record would be refused — and a control that can only fail teaches a
 * reader that the console's buttons are not to be trusted.
 *
 * <h2>The account is fetched on a press, held while it is on screen, and nowhere else</h2>
 *
 * `GET …/bank-details` is audited on every call, so it is asked for on the press and never before,
 * a second press while the first is in flight does nothing, and the answer lives in this
 * component's state alone. Hiding it, leaving, or the list reloading drops it; seeing it again is
 * another audited read. The sentence saying so sits beside the control before anybody presses it.
 *
 * <p>The amount is the largest thing in the reveal, in the charge's currency, because the transfer
 * is made in that currency and a transfer of the right number in the wrong currency is still the
 * wrong transfer. It is the service's decimal string throughout — formatted for reading, copied
 * as it came — and never a JavaScript number.
 *
 * <h2>Recording asks first</h2>
 *
 * The record settles the refund for good, so the first press repeats what is about to be recorded
 * — the amount, the account, the date and the reference — and the second records it.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5: nothing on this platform is closer to money than this.
 */

/** What the console says above the list once a row has acted. */
export interface RefundRowNotice {
  readonly title: string;
  readonly body: string;
  /** `info` for a press that found the work already done; `success` otherwise. */
  readonly variant?: 'success' | 'info';
}

/**
 * A calendar day the service sends without a time — a transfer's value date — in the reader's
 * language. Read at midday UTC, so no zone between Hawaii and Kiribati moves it to the day before.
 */
export function formatDay(day: string, locale: Locale): string {
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00Z` : day, locale);
}

/** In fours, the way a bank prints it and the way it is read aloud to one. */
function grouped(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * A refusal in the bank-transfer table's words where it has some, else in the console's — as a
 * refused act, since every caller is one: "this action needs…", never "reading … needs".
 */
export function bankRefusalMessage(cause: unknown, copy: RefundConsoleCopy): string {
  const code = cause instanceof ApiError ? cause.problem?.code : undefined;
  if (code !== undefined && code !== null) {
    const sentence = copy.bank.errors[code];
    if (sentence !== undefined) return sentence;
  }
  return actionMessageFor(cause, copy.subject, copy.refusals);
}

/** The account, the ticket and who recorded what — the facts the list carries, no reveal needed. */
export function BankTransferFacts({
  transfer,
  names,
  copy,
}: {
  readonly transfer: RefundBankTransfer;
  readonly names: DirectoryNames;
  readonly copy: RefundConsoleCopy;
}) {
  const locale = useRouteLocale();
  const person = (id: string) => <EntityName id={id} names={names} kind="account" copy={copy.identity} />;

  return (
    <div className="mt-2 flex flex-col gap-1 text-xs text-white/64">
      <p>
        {fillNodes(copy.bank.accountOnFile, {
          hint: <span className="font-mono text-white">{transfer.ibanHint}</span>,
          ticket: <Identifier id={transfer.ticketId} />,
        })}
      </p>
      <p>
        {fillNodes(copy.bank.detailsRecordedBy, {
          by: person(transfer.detailsRecordedBy),
          date: formatDate(transfer.detailsRecordedAt, locale),
        })}
      </p>
      {transfer.transferredOn != null && transfer.bankReference != null && transfer.transferRecordedBy != null && (
        <p>
          {fillNodes(copy.bank.transferRecorded, {
            date: formatDay(transfer.transferredOn, locale),
            reference: <span className="font-mono text-white">{transfer.bankReference}</span>,
            by: person(transfer.transferRecordedBy),
          })}
        </p>
      )}
    </div>
  );
}

/** A refund the backer's account is on file for: the reveal and the record, or the four-eyes rule. */
export function AwaitingTransfer({
  refund,
  transfer,
  readerId,
  copy,
  onSettled,
}: {
  readonly refund: Refund;
  readonly transfer: RefundBankTransfer;
  /** The member of staff reading, from the console's membership. Null until it has been read. */
  readonly readerId: string | null;
  readonly copy: RefundConsoleCopy;
  readonly onSettled: (notice: RefundRowNotice) => void;
}) {
  if (readerId !== null && readerId === transfer.detailsRecordedBy) {
    return (
      <InlineAlert variant="info" title={copy.bank.fourEyesTitle} className="mt-3">
        {copy.bank.fourEyes}
      </InlineAlert>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-white/8 pt-3">
      <p className="max-w-[62ch] text-xs text-white/64">{copy.bank.awaitingTransfer}</p>
      <AccountReveal refundId={refund.id} copy={copy} />
      <RecordTransfer refund={refund} transfer={transfer} copy={copy} onSettled={onSettled} />
    </div>
  );
}

type Reveal =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'shown'; readonly details: RevealedRefundBankDetails }
  | { readonly kind: 'refused'; readonly message: string };

function AccountReveal({ refundId, copy }: { readonly refundId: string; readonly copy: RefundConsoleCopy }) {
  const words = copy.bank;
  const [reveal, setReveal] = useState<Reveal>({ kind: 'hidden' });
  const inFlight = useRef<AbortController | null>(null);
  const auditedId = useId();

  // A read still running when the row goes away must not land in a component nobody sees.
  useEffect(() => () => inFlight.current?.abort(), []);

  async function open(): Promise<void> {
    if (inFlight.current !== null) return;

    const controller = new AbortController();
    inFlight.current = controller;
    setReveal({ kind: 'opening' });
    try {
      const details = await revealRefundBankDetails(refundId, controller.signal);
      if (controller.signal.aborted) return;
      setReveal({ kind: 'shown', details });
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      const known = code != null ? words.errors[code] : undefined;
      setReveal({
        kind: 'refused',
        message:
          known ?? (statusFor(cause) === 'forbidden' ? words.reveal.forbidden : words.reveal.failed),
      });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  const opening = reveal.kind === 'opening';

  return (
    <div className="flex flex-col gap-2">
      <p id={auditedId} className="max-w-[62ch] text-xs text-white/48">
        {words.reveal.audited}
      </p>

      <div aria-live="polite">
        {reveal.kind === 'shown' && (
          <dl className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-white/48">{words.amountLabel}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-2xl font-medium tabular-nums tracking-[-0.02em] text-white">
                  {formatMoney(reveal.details.amount)}
                </span>
                <CopyValue value={reveal.details.amount.amount} label={words.copy.amount} copy={words} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-white/48">{words.ibanLabel}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="select-all break-all font-mono text-base text-white">
                  {grouped(reveal.details.iban)}
                </span>
                <CopyValue value={reveal.details.iban} label={words.copy.iban} copy={words} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-white/48">{words.holderLabel}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="select-all text-white">{reveal.details.holderName}</span>
                <CopyValue value={reveal.details.holderName} label={words.copy.holder} copy={words} />
              </dd>
            </div>
          </dl>
        )}
        {reveal.kind === 'refused' && <InlineAlert variant="danger">{reveal.message}</InlineAlert>}
      </div>

      <div>
        {reveal.kind === 'shown' ? (
          <Pill variant="ghost" size="sm" onClick={() => setReveal({ kind: 'hidden' })}>
            {words.reveal.hide}
          </Pill>
        ) : (
          <Pill
            variant="outline"
            size="sm"
            aria-describedby={auditedId}
            aria-disabled={opening}
            onClick={() => void open()}
          >
            {opening ? words.reveal.revealing : words.reveal.action}
          </Pill>
        )}
      </div>
    </div>
  );
}

/**
 * One value onto the clipboard, with its own accessible name — three sit side by side, and three
 * controls all called "Copy" cannot be told apart by name. The confirmation is a word, announced,
 * because colour alone never carries meaning. A refusal from the browser is silent: the value is
 * selectable text beside the control.
 */
function CopyValue({
  value,
  label,
  copy,
}: {
  readonly value: string;
  readonly label: string;
  readonly copy: RefundBankTransferCopy;
}) {
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
        aria-label={label}
        className="rounded text-xs text-white/64 underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
      >
        {copy.copy.copy}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-white/48">
        {copied ? copy.copy.copied : ''}
      </span>
    </span>
  );
}

function RecordTransfer({
  refund,
  transfer,
  copy,
  onSettled,
}: {
  readonly refund: Refund;
  readonly transfer: RefundBankTransfer;
  readonly copy: RefundConsoleCopy;
  readonly onSettled: (notice: RefundRowNotice) => void;
}) {
  const words = copy.bank;
  const locale = useRouteLocale();
  const today = todayInBaku();
  const [reference, setReference] = useState('');
  const [on, setOn] = useState(today);
  const [bankFee, setBankFee] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = bankFeeFrom(bankFee);
  const ready = reference.trim() !== '' && on !== '' && fee !== undefined;

  async function record(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const settled = await recordRefundBankTransfer(refund.id, {
        bankReference: reference.trim(),
        transferredOn: on,
        ...(fee ? { bankFee: fee } : {}),
      });
      onSettled({
        title: words.recordedTitle,
        body: fillPlaceholders(words.recordedBody, {
          amount: formatMoney(settled.amount),
          id: shortId(settled.pledgeId),
        }),
      });
    } catch (cause) {
      setError(bankRefusalMessage(cause, copy));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={words.recordTransfer}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) setConfirming(true);
      }}
    >
      <h3 className="text-sm font-medium text-white">{words.recordTransfer}</h3>
      <p className="max-w-[62ch] text-xs text-white/64">{words.recordIntro}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={words.bankReference} hint={words.bankReferenceHint} required className="min-w-[240px] flex-1">
          <TextInput
            value={reference}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            disabled={confirming}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        <Field label={words.transferredOn} hint={words.transferredOnHint} required className="min-w-[180px]">
          <TextInput
            type="date"
            value={on}
            max={today}
            disabled={confirming}
            onChange={(event) => setOn(event.target.value)}
          />
        </Field>
        <Field
          label={words.bankFee}
          hint={words.bankFeeHint}
          error={fee === undefined ? words.bankFeeInvalid : undefined}
          className="min-w-[160px]"
        >
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={bankFee}
            maxLength={16}
            disabled={confirming}
            onChange={(event) => setBankFee(event.target.value)}
          />
        </Field>
      </div>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}

      {confirming ? (
        <div role="group" aria-label={words.recordTransfer} className="flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-white">
            {fillPlaceholders(words.confirmRecord, {
              amount: formatMoney(refund.amount),
              hint: transfer.ibanHint,
              date: formatDay(on, locale),
              reference: reference.trim(),
            })}
          </p>
          {fee && (
            <p className="max-w-[62ch] text-sm text-white">
              {fillPlaceholders(words.confirmBankFee, {
                amount: formatMoney({ amount: fee, currency: refund.amount.currency }),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => void record()}>
              {busy ? words.recording : words.confirmRecordAction}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setConfirming(false)}>
              {words.cancel}
            </Pill>
          </div>
        </div>
      ) : (
        <div>
          <Pill type="submit" variant="outline" size="sm" disabled={!ready}>
            {words.recordTransfer}
          </Pill>
        </div>
      )}
    </form>
  );
}

/**
 * A refund the provider refused, sent by bank transfer instead — #399's fallback.
 *
 * <p>For a refusal the provider adapter did not recognise as "too old to refund". The answer is a
 * new refund, waiting for the backer's bank details, for what the charge still has left; pressing
 * again answers the same one. It asks first, because it commits the platform to a transfer.
 */
export function RouteToBankTransfer({
  refund,
  copy,
  onSettled,
}: {
  readonly refund: Refund;
  readonly copy: RefundConsoleCopy;
  readonly onSettled: (notice: RefundRowNotice) => void;
}) {
  const words = copy.bank;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function route(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await routeRefundToBankTransfer(refund.id);
      // A repeat answers with the bank refund it made the first time, whatever has become of it
      // since — it may have been paid already. Said as it is, not as freshly waiting.
      onSettled(
        created.state === 'AWAITING_BANK_DETAILS'
          ? {
              title: words.routedTitle,
              body: fillPlaceholders(words.routedBody, {
                amount: formatMoney(created.amount),
                id: shortId(created.pledgeId),
              }),
            }
          : {
              variant: 'info',
              title: words.routedAlreadyTitle,
              body: fillPlaceholders(words.routedAlready, {
                id: shortId(created.pledgeId),
                state: copy.state[created.state],
              }),
            },
      );
    } catch (cause) {
      setError(bankRefusalMessage(cause, copy));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}
      {confirming ? (
        <div role="group" aria-label={words.refundByBank} className="flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-white">{words.confirmRefundByBank}</p>
          <div className="flex flex-wrap gap-2">
            <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => void route()}>
              {busy ? words.routing : words.confirmRefundByBankAction}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setConfirming(false)}>
              {words.cancel}
            </Pill>
          </div>
        </div>
      ) : (
        <div>
          <Pill variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {words.refundByBank}
          </Pill>
        </div>
      )}
    </div>
  );
}
