'use client';

import { useId, useState } from 'react';
import { EmptyState, Field, InlineAlert, Pill, Skeleton, SkeletonGroup, Textarea, TextInput } from '@ideanest/ui';
import {
  cardWindowOpen,
  listUnappliedPlanPayments,
  planPaymentAmount,
  recordPlanPaymentBankTransfer,
  refundPlanPaymentToCard,
  type UnappliedPlanPayment,
  type UnappliedPlanPaymentList,
} from '../../lib/admin/plan-payment-refunds';
import { shortId } from '../../lib/admin/refusals';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import { bakuDate } from '../../lib/admin/console-dates';
import type { DirectoryNames } from '../../lib/admin/directory';
// The printing half only: the money module's root brings decimal.js, which nothing here needs.
import { formatMoney } from '@ideanest/money/format';
import type { Locale } from '../../lib/i18n/locale';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { RefundConsoleCopy } from '../../lib/i18n/admin/money-copy';
import { Link } from '../../i18n/navigation';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * Plan payments to return, on the refund console — issue #457, a follow-up to epic #448.
 *
 * <h2>What these are</h2>
 *
 * A card payment for a creator plan that arrived after the subscription had ended — staff ended
 * it, or it was replaced — buys nothing and cannot be applied. The service marks it `UNAPPLIED`;
 * before this section the only trace of one was an ERROR line in the logs. Each row says what was
 * paid, when, through which provider order and by whom, and whether the provider still takes a
 * refund to the card.
 *
 * <h2>Two ways back, and the card one only while the provider takes it</h2>
 *
 * "Refund to card" sends the whole payment back through the provider. Past the provider's window
 * it is disabled, with the reason written beside it rather than carried by its greyed-out look.
 * The service checks the window again on the write: a page left open past the deadline is refused
 * with `PLAN_REFUND_CARD_WINDOW_CLOSED`, and the row turns to the bank-transfer form in its place.
 *
 * "Record bank transfer" is for the money staff sent back from IdeyaNest's bank, recorded with the
 * bank's reference. Both ask first, the way every money-moving control on this console does: the
 * first press repeats what is about to happen and the second does it.
 *
 * <h2>A returned payment leaves the list</h2>
 *
 * On success the row is removed from what is held rather than read again, and what happened is
 * said above the list, where it survives the row. A payment somebody else returned first is
 * refused `PLAN_REFUND_NOT_UNAPPLIED`; that is said as "already returned" and the list is read
 * again, because the screen is out of date and a reader should see what is actually left.
 *
 * <h2>Who sees the controls</h2>
 *
 * The list is `VIEW_FINANCE`'s, like the refund log beside it. The controls are offered to a
 * reader holding `ISSUE_REFUND` — what is offered, never what is allowed: the service refuses both
 * on its own. The account link is offered to a reader holding `ADMINISTER_ACCOUNTS`, which is what
 * `/admin/users/{id}` reads with; everyone else sees the account's name.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5: nothing on this platform is closer to money than this.
 */
export interface PlanPaymentReturnsProps {
  readonly copy: RefundConsoleCopy;
  /** Whether the reader holds `ISSUE_REFUND`. */
  readonly canIssue: boolean;
  /** Whether the reader holds `ADMINISTER_ACCOUNTS`, which the account page needs. */
  readonly canOpenAccount: boolean;
}

interface Notice {
  readonly variant: 'success' | 'info';
  readonly title: string;
  readonly body: string;
}

export function PlanPaymentReturns({ copy, canIssue, canOpenAccount }: PlanPaymentReturnsProps) {
  const words = copy.planPayments;
  const locale = useRouteLocale();
  const [notice, setNotice] = useState<Notice | null>(null);

  const payments = useConsoleResource<UnappliedPlanPaymentList>(
    (signal) => listUnappliedPlanPayments(signal),
    words.subject,
    copy.refusals,
    [],
  );

  const names = useDirectoryNames(
    (payments.data?.payments ?? []).map((payment) => payment.accountId),
    [],
  );

  if (payments.status === 'signed-out' || payments.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={payments.status}
        capability={payments.capability}
        subject={words.subject}
        copy={copy.refusals}
      />
    );
  }

  function returned(id: string, next: Notice): void {
    setNotice(next);
    const held = payments.data;
    if (held !== null) payments.set({ payments: held.payments.filter((payment) => payment.id !== id) });
  }

  function alreadyReturned(message: string): void {
    setNotice({ variant: 'info', title: words.alreadyReturnedTitle, body: message });
    payments.reload();
  }

  const list = payments.data?.payments ?? [];

  return (
    <section aria-labelledby="plan-payments-heading">
      <h2 id="plan-payments-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
        {words.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{words.intro}</p>

      {notice !== null && (
        <InlineAlert variant={notice.variant} title={notice.title} className="mt-4">
          {notice.body}
        </InlineAlert>
      )}

      {payments.status === 'loading' && payments.data === null && (
        <SkeletonGroup label={words.loadingList} className="mt-4">
          <div className="space-y-3">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="30%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {payments.status === 'failed' && (
        <>
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {payments.error}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={payments.reload}>
            {copy.tryAgain}
          </Pill>
        </>
      )}

      {payments.status === 'ready' && list.length === 0 && (
        <EmptyState className="mt-4" variant="empty" title={words.emptyTitle} description={words.emptyBody} />
      )}

      {payments.data !== null && list.length > 0 && payments.status !== 'failed' && (
        <ul className="mt-4 flex list-none flex-col gap-2">
          {list.map((payment) => (
            <PlanPaymentRow
              key={payment.id}
              payment={payment}
              names={names}
              copy={copy}
              locale={locale}
              canIssue={canIssue}
              canOpenAccount={canOpenAccount}
              onReturned={(next) => returned(payment.id, next)}
              onAlreadyReturned={alreadyReturned}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const codeOf = refusalCode;

/** A refusal in this section's words where it has some, else in the console's — never the service's English. */
function planRefusalMessage(cause: unknown, copy: RefundConsoleCopy): string {
  const words = copy.planPayments.errors;
  return codedRefusalFor(cause, words, words['INVALID_REQUEST'] ?? copy.refusals.refused, copy.planPayments.subject, copy.refusals);
}

/** A provider as staff say it — `Payriff`, not `PAYRIFF`. One with no word falls through as sent. */
function providerName(provider: string, copy: RefundConsoleCopy): string {
  return copy.planPayments.providerName?.[provider] ?? provider;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type Mode = 'idle' | 'confirm-card' | 'bank';

function PlanPaymentRow({
  payment,
  names,
  copy,
  locale,
  canIssue,
  canOpenAccount,
  onReturned,
  onAlreadyReturned,
}: {
  readonly payment: UnappliedPlanPayment;
  readonly names: DirectoryNames;
  readonly copy: RefundConsoleCopy;
  readonly locale: Locale;
  readonly canIssue: boolean;
  readonly canOpenAccount: boolean;
  readonly onReturned: (notice: Notice) => void;
  readonly onAlreadyReturned: (message: string) => void;
}) {
  const words = copy.planPayments;
  const amount = formatMoney(planPaymentAmount(payment));
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Closed by the clock on load, or by the service's refusal after a press. */
  const [refusedAsClosed, setRefusedAsClosed] = useState<string | null>(null);
  /* A card refund was sent and never answered — on load, or after a press the provider left unanswered. */
  const [unconfirmedSince, setUnconfirmedSince] = useState<string | null>(payment.cardRefundStartedAt ?? null);
  const unconfirmed = unconfirmedSince !== null;
  const windowOpen = (cardWindowOpen(payment) || unconfirmed) && refusedAsClosed === null;
  const reasonId = useId();
  const provider = providerName(payment.provider, copy);

  async function refund(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const settled = await refundPlanPaymentToCard(payment.id);
      onReturned({
        variant: 'success',
        title: words.refundedTitle,
        body: fillPlaceholders(words.refundedBody, {
          amount: formatMoney(planPaymentAmount(settled)),
          order: settled.providerTransactionId,
        }),
      });
    } catch (cause) {
      const code = codeOf(cause);
      const message = planRefusalMessage(cause, copy);
      if (code === 'PLAN_REFUND_NOT_UNAPPLIED') {
        onAlreadyReturned(message);
        return;
      }
      if (code === 'PLAN_REFUND_CARD_WINDOW_CLOSED') {
        setUnconfirmedSince(null);
        setRefusedAsClosed(message);
        setMode('bank');
        return;
      }
      if (code === 'PLAN_REFUND_UNCONFIRMED') {
        // The money may already be on its way back: the bank transfer is not offered beside it.
        setUnconfirmedSince((since) => since ?? new Date().toISOString());
      }
      setError(message);
      setMode('idle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-fg/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-fg">
          <span className="tabular-nums">{amount}</span>
          <span className="ml-2 text-fg-64">
            {fillPlaceholders(words.paidOn, { date: bakuDate(payment.paidAt, locale) })}
          </span>
        </p>
        <CardWindow payment={payment} closedByRefusal={refusedAsClosed !== null} copy={copy} locale={locale} />
      </div>

      <p className="mt-2 text-xs text-fg-64">
        {fillNodes(words.providerOrder, {
          provider,
          order: <span className="select-all font-mono text-fg">{payment.providerTransactionId}</span>,
        })}
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-64">
        <p>
          {fillNodes(words.paidBy, {
            account: <EntityName id={payment.accountId} names={names} kind="account" copy={copy.identity} />,
          })}
        </p>
        {canOpenAccount && (
          <Link
            href={`/admin/users/${encodeURIComponent(payment.accountId)}`}
            aria-label={fillPlaceholders(words.openAccountLabel, { id: shortId(payment.accountId) })}
            className="rounded text-fg-64 underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {words.openAccount}
          </Link>
        )}
      </div>

      {canIssue && (
        <div className="mt-3 flex flex-col gap-3 border-t border-fg/8 pt-3">
          {error !== null && (
            <InlineAlert variant="danger" title={copy.failedTitle}>
              {error}
            </InlineAlert>
          )}
          {refusedAsClosed !== null && <InlineAlert variant="info">{refusedAsClosed}</InlineAlert>}
          {unconfirmedSince !== null && (
            <InlineAlert variant="warning" title={words.unconfirmedTitle}>
              {fillPlaceholders(words.unconfirmedBody, { date: bakuDate(unconfirmedSince, locale) })}
            </InlineAlert>
          )}

          {mode === 'confirm-card' ? (
            <div role="group" aria-label={words.refundToCard} className="flex flex-col gap-2">
              <p className="max-w-[62ch] text-sm text-fg">
                {fillPlaceholders(words.confirmRefund, { amount, provider })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => void refund()}>
                  {busy ? words.refunding : words.confirmRefundAction}
                </Pill>
                <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setMode('idle')}>
                  {words.cancel}
                </Pill>
              </div>
            </div>
          ) : mode === 'bank' ? (
            <RecordReturn
              payment={payment}
              copy={copy}
              onReturned={onReturned}
              onAlreadyReturned={onAlreadyReturned}
              onUnsettled={() => {
                setUnconfirmedSince((since) => since ?? new Date().toISOString());
                setMode('idle');
              }}
              onCancel={() => setMode('idle')}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {/*
                  Past the provider's window the card refund is not drawn at all: a control that
                  cannot succeed is not offered, and the sentence below says why. While a card
                  refund is unconfirmed it is the only way out, because it asks the provider first.
                */}
                {windowOpen && (
                  <Pill
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setMode('confirm-card');
                    }}
                  >
                    {words.refundToCard}
                  </Pill>
                )}
                {!unconfirmed && (
                  <Pill
                    variant="ghost"
                    size="sm"
                    aria-describedby={windowOpen ? undefined : reasonId}
                    onClick={() => {
                      setError(null);
                      setMode('bank');
                    }}
                  >
                    {words.recordBankTransfer}
                  </Pill>
                )}
              </div>
              {!windowOpen && (
                <p id={reasonId} className="max-w-[62ch] text-xs text-fg-64">
                  {words.cardClosedReason}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Whether the provider still takes a refund to the card, in words — never a colour alone. */
function CardWindow({
  payment,
  closedByRefusal,
  copy,
  locale,
}: {
  readonly payment: UnappliedPlanPayment;
  readonly closedByRefusal: boolean;
  readonly copy: RefundConsoleCopy;
  readonly locale: Locale;
}) {
  const words = copy.planPayments;
  const until = payment.cardRefundUntil;

  /* Refused as closed with no deadline to name: the row's own alert says so, in full. */
  if (until == null && closedByRefusal) return null;

  let text: string;
  if (until == null) {
    text = words.noCardWindow;
  } else if (!closedByRefusal && cardWindowOpen(payment)) {
    const days = Math.floor((new Date(until).getTime() - Date.now()) / DAY_MS);
    text = fillPlaceholders(words.cardOpenUntil, {
      date: bakuDate(until, locale),
      left: days < 1 ? words.lastDay : fillPlaceholders(words.daysLeft, { count: String(days) }),
    });
  } else {
    text = fillPlaceholders(words.cardClosed, { date: bakuDate(until, locale) });
  }

  return <p className="text-xs text-fg-64">{text}</p>;
}

/** The bank transfer that returned the money: the reference and a note, asked before it is recorded. */
function RecordReturn({
  payment,
  copy,
  onReturned,
  onAlreadyReturned,
  onUnsettled,
  onCancel,
}: {
  readonly payment: UnappliedPlanPayment;
  readonly copy: RefundConsoleCopy;
  readonly onReturned: (notice: Notice) => void;
  readonly onAlreadyReturned: (message: string) => void;
  readonly onUnsettled: () => void;
  readonly onCancel: () => void;
}) {
  const words = copy.planPayments;
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = reference.trim() !== '';

  async function record(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedNote = note.trim();
      const settled = await recordPlanPaymentBankTransfer(payment.id, {
        bankReference: reference.trim(),
        ...(trimmedNote === '' ? {} : { note: trimmedNote }),
      });
      onReturned({
        variant: 'success',
        title: words.recordedTitle,
        body: fillPlaceholders(words.recordedBody, {
          amount: formatMoney(planPaymentAmount(settled)),
          reference: reference.trim(),
        }),
      });
    } catch (cause) {
      const message = planRefusalMessage(cause, copy);
      if (codeOf(cause) === 'PLAN_REFUND_NOT_UNAPPLIED') {
        onAlreadyReturned(message);
        return;
      }
      if (codeOf(cause) === 'PLAN_REFUND_CARD_REFUND_UNSETTLED') {
        // A card refund may already have returned this money; the row stops offering the transfer.
        onUnsettled();
        return;
      }
      setError(message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={words.recordBankTransfer}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) setConfirming(true);
      }}
    >
      <h3 className="text-sm font-medium text-fg">{words.recordBankTransfer}</h3>
      <p className="max-w-[62ch] text-xs text-fg-64">{words.bankIntro}</p>

      <Field label={words.bankReference} hint={words.bankReferenceHint} required className="max-w-[420px]">
        <TextInput
          value={reference}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          disabled={confirming}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <Field label={words.note} hint={words.noteHint}>
        <Textarea
          rows={2}
          value={note}
          maxLength={500}
          disabled={confirming}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}

      {confirming ? (
        <div role="group" aria-label={words.recordBankTransfer} className="flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-fg">
            {fillPlaceholders(words.confirmRecord, {
              amount: formatMoney(planPaymentAmount(payment)),
              reference: reference.trim(),
            })}
          </p>
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
        <div className="flex flex-wrap gap-2">
          <Pill type="submit" variant="outline" size="sm" disabled={!ready}>
            {words.recordBankTransfer}
          </Pill>
          <Pill variant="ghost" size="sm" onClick={onCancel}>
            {words.cancel}
          </Pill>
        </div>
      )}
    </form>
  );
}
