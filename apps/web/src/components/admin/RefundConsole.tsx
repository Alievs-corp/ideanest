'use client';

import { Suspense, lazy, useState, type ReactNode } from 'react';
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
  TextInput,
} from '@ideanest/ui';
import {
  REFUND_REASONS,
  isPledgeId,
  issueRefund,
  issuedTotal,
  listRefunds,
  newRefundKey,
  readRefundable,
  refundAmountFrom,
  type Refund,
  type RefundableAmount,
  type RefundReason,
  type RefundState,
} from '../../lib/admin/refunds';
import { ApiError } from '../../lib/api/problem';
import { actionMessageFor, shortId } from '../../lib/admin/refusals';
import { formatMoney, type Money } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { RefundConsoleCopy } from '../../lib/i18n/admin/money-copy';
import type { DirectoryNames } from '../../lib/admin/directory';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName, Identifier } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';
import { useConsoleMembership } from './ConsoleMembership';
import { holds } from '../../lib/admin/staff';
import type { RefundRowNotice } from './RefundBankTransfer';

/*
 * #400's bank-transfer pieces, fetched when a row draws one. Most refunds go back through the
 * provider, and bundled with the console they would take `/admin/refunds` past its First Load JS
 * budget. `React.lazy` for `PayoutQueue`'s reason: the rows render in the browser after the read.
 */
const BankTransferFacts = lazy(() =>
  import('./RefundBankTransfer').then((module) => ({ default: module.BankTransferFacts })),
);
const AwaitingTransfer = lazy(() =>
  import('./RefundBankTransfer').then((module) => ({ default: module.AwaitingTransfer })),
);
const RouteToBankTransfer = lazy(() =>
  import('./RefundBankTransfer').then((module) => ({ default: module.RouteToBankTransfer })),
);
/* #416's ticket for the backer and the account recorded from it, for the same reason. */
const BackerTicketForm = lazy(() =>
  import('./BackerTicketForm').then((module) => ({ default: module.BackerTicketForm })),
);
/*
 * #457's plan payments to return, for the same reason. The section reads its own list, so it costs
 * the route nothing until it renders, and nothing at all to a reader the log has already refused.
 */
const PlanPaymentReturns = lazy(() =>
  import('./PlanPaymentReturns').then((module) => ({ default: module.PlanPaymentReturns })),
);

/*
 * #400: the two bank-transfer states sit after REQUESTED, because they are the same kind of thing
 * — money the platform decided to send back and has not sent yet — and before the settled two.
 */
const STATES: readonly RefundState[] = [
  'REQUESTED',
  'AWAITING_BANK_DETAILS',
  'AWAITING_TRANSFER',
  'SUCCEEDED',
  'FAILED',
];

/** The reasons whose refund the service writes the sentence for itself, in English (#40, #171). */
const PLATFORM_REASONS: ReadonlySet<RefundReason> = new Set(['CAMPAIGN_FAILED', 'CAMPAIGN_HALTED', 'RAISE_NOT_APPLIED']);

/**
 * §4.11's AD-06: full and partial refunds with reason codes — issues #67 and #307.
 *
 * <h2>REQUESTED is the state worth watching, and it is the default filter</h2>
 *
 * A refund that stays `REQUESTED` is one the platform decided on and did not complete: the
 * provider was called and the answer was lost, or the job has not run. Both mean somebody is
 * still waiting for their money, and neither shows up anywhere else — so the screen opens on
 * that filter rather than on everything. The log sits straight under the form, because it is
 * what the page is about; #457's plan payments come after it.
 *
 * <h2>Issuing asks first, and says what it is about to send</h2>
 *
 * The first press checks the form here — a whole pledge identifier, an amount with at most two
 * places, a comma read as the decimal mark — then asks the service what the pledge has left
 * (`GET /refunds/refundable`). The answer names the pledge's currency, which is the one the
 * refund is sent in (a USD campaign's refund is in USD), the figure a blank amount means, the
 * campaign and the backer, and the provider fee a campaign's reason keeps back (#436). The
 * second press sends it. Only a reader holding `ISSUE_REFUND` is offered the form at all.
 *
 * <h2>The idempotency key belongs to the attempt, not to the request</h2>
 *
 * It is made when the form is opened and reused if the send fails and somebody presses again.
 * A key generated inside the request would be a new key on every retry, which is the same as
 * having none — and on this screen that is money leaving twice.
 *
 * <p>But it is not reused for a different refund. When the service <em>answered</em> a refusal
 * — nothing was recorded — and the pledge, amount or reason is then changed, the next send is a
 * new attempt with a new key. When the answer was lost the key is kept whatever changed: the
 * first send may have gone through, and the key is what lets the service say so. If the pledge
 * changed, the service refuses the key as spent on another pledge (`IDEMPOTENCY_KEY_REUSED`);
 * the form then takes a new key and says to check the log before sending again.
 *
 * <h2>Leaving the amount blank refunds the rest</h2>
 *
 * Deliberately, rather than pre-filling the pledge total. A figure computed from a page loaded
 * before an earlier partial refund would be both wrong and confident; blank makes the service
 * work it out from the row it has locked. The confirmation shows the figure it means now.
 *
 * <h2>A refund past the provider's window is paid by bank transfer — #400</h2>
 *
 * Its row says what it waits for and who did the step before. To a reader holding
 * `ISSUE_REFUND` it offers the next step: revealing the account and recording the transfer, or,
 * on a refund the provider refused and nobody has routed yet, sending it by bank transfer
 * instead. `RefundBankTransfer.tsx` has the rules those controls keep. What a row did is said
 * above the list rather than in the row, because the list reloads after it and the row it would
 * have been said in is redrawn.
 *
 * <h2>And support's step, on a refund waiting for bank details — #416</h2>
 *
 * The account is recorded only from a ticket the backer raised, and a backer cannot raise one.
 * To a reader holding `HANDLE_SUPPORT` the row offers to open that ticket in the backer's name
 * from the row's pledge and record the account against it straight away; `BackerTicketForm` has
 * the rest.
 *
 * <h2>Rows name people and campaigns, in the reader's language</h2>
 *
 * The backer and the campaign through the console directory, the identifier beside them; the day
 * in the reader's locale; and the sentences the service writes itself in English — a bank-routed
 * refund, a lost chargeback, the platform's own refunds, a failure code — worded here from the
 * row's fields.
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
  const [rowNotice, setRowNotice] = useState<RefundRowNotice | null>(null);
  const { membership } = useConsoleMembership();
  /* What is offered, never what is allowed: the service refuses every one of these on its own. */
  const canIssue = holds(membership, 'ISSUE_REFUND');
  const readerId = membership?.accountId ?? null;

  const refunds = useConsoleResource(
    (signal) => listRefunds({ state, page, signal }),
    copy.subject,
    copy.refusals,
    [state, page],
  );

  const rows = refunds.data?.refunds ?? [];
  /* Who asked for each refund (#402), whose money it is, and which campaign — by name. */
  const names = useDirectoryNames(
    rows
      .flatMap((refund) => [
        refund.requestedBy,
        refund.backerId,
        refund.bankTransfer?.detailsRecordedBy,
        refund.bankTransfer?.transferRecordedBy,
      ])
      .filter((id): id is string => id != null),
    rows.map((refund) => refund.projectId),
  );

  function settled(notice: RefundRowNotice): void {
    setRowNotice(notice);
    refunds.reload();
  }

  if (refunds.status === 'signed-out' || refunds.status === 'forbidden') {
    return <ConsoleRefusal status={refunds.status} capability={refunds.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  return (
    <div className="flex flex-col gap-10">
      {canIssue && <IssueRefund copy={copy} onIssued={refunds.reload} />}

      <section aria-labelledby="refund-log-heading">
        <h2 id="refund-log-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
          {copy.logHeading}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[null, ...STATES].map((option) => (
            <Pill
              key={option ?? 'all'}
              variant={state === option ? 'outline' : 'ghost'}
              size="sm"
              aria-pressed={state === option}
              onClick={() => {
                setState(option);
                setPage(0);
                setRowNotice(null);
              }}
            >
              {option === null ? copy.all : copy.state[option]}
            </Pill>
          ))}
        </div>

        {rowNotice !== null && (
          <InlineAlert variant={rowNotice.variant ?? 'success'} title={rowNotice.title} className="mt-4">
            {rowNotice.body}
          </InlineAlert>
        )}

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
              <RefundRow
                key={refund.id}
                refund={refund}
                names={names}
                copy={copy}
                canIssue={canIssue}
                readerId={readerId}
                onSettled={settled}
              />
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

      <Suspense fallback={null}>
        <PlanPaymentReturns
          copy={copy}
          canIssue={canIssue}
          canOpenAccount={holds(membership, 'ADMINISTER_ACCOUNTS')}
        />
      </Suspense>
    </div>
  );
}

/** Where the form has got to. */
type Step =
  | { readonly kind: 'editing' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'confirming'; readonly refundable: RefundableAmount; readonly amount: string | null }
  | { readonly kind: 'sending'; readonly refundable: RefundableAmount; readonly amount: string | null };

/** What the last send was for, and whether the service answered it. */
interface LastAttempt {
  readonly signature: string;
  /** The service said no and recorded nothing. False when the answer was lost. */
  readonly refused: boolean;
}

/** A thing the service said, read off `meta`. */
function metaOf(cause: unknown, key: string): string | null {
  const value = cause instanceof ApiError ? cause.problem?.meta?.[key] : undefined;
  return typeof value === 'string' ? value : null;
}

/** `Money.toString()` as the service writes it into `meta` — "40.00 AZN" — read back as money. */
function moneyFromMeta(value: string | null): Money | null {
  const match = value === null ? null : /^(-?\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(value.trim());
  return match === null ? null : { amount: match[1] ?? '0', currency: match[2] ?? '' };
}

/** A refusal of the refund form, in the form's own words where it has some. */
function issueRefusalMessage(cause: unknown, copy: RefundConsoleCopy): string {
  const code = cause instanceof ApiError ? cause.problem?.code : undefined;
  if (code === 'REFUND_EXCEEDS_COLLECTION') {
    const remaining = moneyFromMeta(metaOf(cause, 'remaining'));
    if (remaining !== null && new Decimal(remaining.amount).lte(0)) {
      return copy.issueErrors['NOTHING_TO_REFUND'] ?? copy.refusals.refused;
    }
    const sentence = copy.issueErrors['REFUND_EXCEEDS_COLLECTION'];
    if (sentence !== undefined && remaining !== null) {
      return fillPlaceholders(sentence, { remaining: formatMoney(remaining) });
    }
  }
  if (code === 'CURRENCY_MISMATCH') {
    const sentence = copy.issueErrors['CURRENCY_MISMATCH'];
    const currency = metaOf(cause, 'currency');
    if (sentence !== undefined && currency !== null) return fillPlaceholders(sentence, { currency });
  }
  if (code != null && code !== 'REFUND_EXCEEDS_COLLECTION' && code !== 'CURRENCY_MISMATCH') {
    const sentence = copy.issueErrors[code];
    if (sentence !== undefined) return sentence;
  }
  return actionMessageFor(cause, copy.subject, copy.refusals);
}

/**
 * The form that sends money back, behind a confirmation — see the component comment's two
 * sections on issuing and on the idempotency key.
 */
function IssueRefund({ copy, onIssued }: { readonly copy: RefundConsoleCopy; readonly onIssued: () => void }) {
  const [pledgeId, setPledgeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('BACKER_REQUEST');
  const [detail, setDetail] = useState('');
  const [key, setKey] = useState(newRefundKey);
  const [last, setLast] = useState<LastAttempt | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'editing' });
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Refund | null>(null);

  const confirming = step.kind === 'confirming' || step.kind === 'sending' ? step : null;
  const names = useDirectoryNames(
    confirming?.refundable.backerId != null ? [confirming.refundable.backerId] : [],
    confirming?.refundable.projectId != null ? [confirming.refundable.projectId] : [],
  );

  /** What makes two sends the same refund, for deciding whether the key is spent. */
  function signatureOf(pledge: string, sent: string | null): string {
    return `${pledge}|${sent ?? ''}|${reason}`;
  }

  async function check(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (step.kind !== 'editing') return;
    setWriteError(null);
    setIssued(null);

    const pledge = pledgeId.trim();
    const sent = refundAmountFrom(amount);
    const pledgeOk = isPledgeId(pledge);
    setPledgeError(pledgeOk ? null : copy.pledgeInvalid);
    setAmountError(sent === undefined ? copy.amountInvalid : null);
    if (!pledgeOk || sent === undefined || detail.trim() === '') return;

    setStep({ kind: 'checking' });
    try {
      const refundable = await readRefundable(pledge, reason);
      const left = new Decimal(refundable.remaining.amount);
      if (left.lte(0)) {
        setWriteError(copy.issueErrors['NOTHING_TO_REFUND'] ?? copy.refusals.refused);
        setStep({ kind: 'editing' });
        return;
      }
      if (sent !== null && new Decimal(sent).gt(left)) {
        const sentence = copy.issueErrors['REFUND_EXCEEDS_COLLECTION'];
        setWriteError(
          sentence === undefined
            ? copy.refusals.refused
            : fillPlaceholders(sentence, { remaining: formatMoney(refundable.remaining) }),
        );
        setStep({ kind: 'editing' });
        return;
      }
      setStep({ kind: 'confirming', refundable, amount: sent });
    } catch (cause) {
      setWriteError(issueRefusalMessage(cause, copy));
      setStep({ kind: 'editing' });
    }
  }

  async function send(): Promise<void> {
    if (step.kind !== 'confirming') return;
    const { refundable, amount: sent } = step;
    const pledge = pledgeId.trim();
    const signature = signatureOf(pledge, sent);

    // A new attempt when the service refused the last one and it was for something else; the
    // same key otherwise — see the component comment.
    const attemptKey = last !== null && last.refused && last.signature !== signature ? newRefundKey() : key;
    if (attemptKey !== key) setKey(attemptKey);

    setStep({ kind: 'sending', refundable, amount: sent });
    setWriteError(null);
    try {
      const refund = await issueRefund({
        pledgeId: pledge,
        // Blank is "the rest of it". The currency is the pledge's, as the service said it, and
        // the service refuses one that disagrees rather than converting -- §21.2.
        amount: sent === null ? null : { amount: sent, currency: refundable.remaining.currency },
        reason,
        detail: detail.trim(),
        idempotencyKey: attemptKey,
      });

      setIssued(refund);
      setPledgeId('');
      setAmount('');
      setDetail('');
      setLast(null);
      // A fresh key for the next refund. The one just used is spent: replaying it would
      // return this same row rather than sending anything, which is correct and is not
      // what somebody filling the form in again means.
      setKey(newRefundKey());
      setStep({ kind: 'editing' });
      onIssued();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      if (code === 'IDEMPOTENCY_KEY_REUSED') {
        // Spent on another pledge's refund whose answer was lost. Never this pledge's money,
        // so a new key cannot pay anybody twice; the sentence says to check the log first.
        setKey(newRefundKey());
        setLast(null);
      } else {
        // The service answered, so nothing was recorded — unless it is the gateway's answer,
        // a 5xx, which says nothing about whether the refund went through.
        const answered = cause instanceof ApiError && cause.status < 500;
        setLast({ signature, refused: answered });
      }
      setWriteError(issueRefusalMessage(cause, copy));
      setStep({ kind: 'editing' });
    }
  }

  const busy = step.kind === 'checking' || step.kind === 'sending';
  const editing = step.kind === 'editing' || step.kind === 'checking';
  const total = issued === null ? null : issuedTotal(issued);
  const parts = issued?.parts?.length ?? 0;

  return (
    <section aria-labelledby="issue-refund-heading">
      <h2 id="issue-refund-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
        {copy.issueHeading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.issueIntro}</p>

      <form onSubmit={(event) => void check(event)} noValidate className="mt-4 flex flex-col gap-3">
        {/* `items-start`: a hint under one control must not push the others' labels down. */}
        <div className="flex flex-wrap items-start gap-3">
          <Field label={copy.pledgeLabel} hint={copy.pledgeHint} error={pledgeError} required className="min-w-[280px] flex-1">
            <TextInput
              value={pledgeId}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={!editing}
              onChange={(event) => {
                setPledgeId(event.target.value);
                setPledgeError(null);
              }}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>

          <Field label={copy.amountLabel} hint={copy.amountHint} error={amountError} className="min-w-[160px]">
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              disabled={!editing}
              onChange={(event) => {
                setAmount(event.target.value);
                setAmountError(null);
              }}
              placeholder="25,00"
            />
          </Field>

          <Field label={copy.reasonLabel} className="min-w-[220px]">
            <Select
              value={reason}
              disabled={!editing}
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

        <Field label={copy.noteLabel} hint={copy.noteHint} required>
          <Textarea
            rows={2}
            value={detail}
            disabled={!editing}
            onChange={(event) => setDetail(event.target.value)}
            maxLength={2000}
          />
        </Field>

        {editing && (
          <div>
            <Pill
              type="submit"
              variant="outline"
              size="sm"
              disabled={pledgeId.trim() === '' || detail.trim() === ''}
              aria-disabled={busy}
            >
              {step.kind === 'checking' ? copy.checking : copy.issue}
            </Pill>
          </div>
        )}
      </form>

      {confirming !== null && (
        <div role="group" aria-label={copy.confirmHeading} className="mt-4 flex flex-col gap-2 rounded-lg border border-white/16 bg-surface-1 p-4">
          <h3 className="text-sm font-medium text-white">{copy.confirmHeading}</h3>
          <p className="max-w-[62ch] text-sm text-white">
            {fillNodes(copy.confirmIssue, {
              amount:
                confirming.amount === null
                  ? fillPlaceholders(copy.allRemaining, { amount: formatMoney(confirming.refundable.remaining) })
                  : formatMoney({ amount: confirming.amount, currency: confirming.refundable.remaining.currency }),
              backer: nameOrDash(confirming.refundable.backerId, 'account', names, copy),
              campaign: nameOrDash(confirming.refundable.projectId, 'project', names, copy),
              pledge: <Identifier id={confirming.refundable.pledgeId} />,
              reason: copy.reason[reason],
            })}
          </p>
          {new Decimal(confirming.refundable.withheldFee.amount).gt(0) && (
            <p className="max-w-[62ch] text-sm text-white">
              {fillPlaceholders(copy.confirmWithheld, { fee: formatMoney(confirming.refundable.withheldFee) })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Pill size="sm" autoFocus aria-disabled={step.kind === 'sending'} onClick={() => void send()}>
              {step.kind === 'sending' ? copy.sending : copy.confirmAction}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              aria-disabled={step.kind === 'sending'}
              onClick={() => {
                if (step.kind === 'confirming') setStep({ kind: 'editing' });
              }}
            >
              {copy.cancel}
            </Pill>
          </div>
        </div>
      )}

      <div aria-live="polite">
        {issued !== null && total !== null && (
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
              amount: formatMoney(total),
              id: shortId(issued.pledgeId),
            })}
            {parts > 1 ? ` ${fillPlaceholders(copy.partsNote, { count: String(parts) })}` : ''}
            {issued.withheldFee != null
              ? ` ${fillPlaceholders(copy.confirmWithheld, { fee: formatMoney(issued.withheldFee) })}`
              : ''}
            {issued.failureCode ? ` ${failureSentence(issued.failureCode, copy)}` : ''}
            {issued.state === 'REQUESTED' ? ` ${copy.awaitingProvider}` : ''}
            {issued.state === 'AWAITING_BANK_DETAILS' ? ` ${copy.bank.awaitingBankDetails}` : ''}
          </InlineAlert>
        )}
      </div>
      {writeError !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {writeError}
        </InlineAlert>
      )}
    </section>
  );
}

/** A name from the directory with its identifier, or a dash where there is nothing to name. */
function nameOrDash(
  id: string | null | undefined,
  kind: 'account' | 'project',
  names: DirectoryNames,
  copy: RefundConsoleCopy,
): ReactNode {
  return id == null ? copy.unnamed : <EntityName id={id} names={names} kind={kind} copy={copy.identity} />;
}

/** Why a refund failed, in words: the platform's own codes by name, a provider's quoted. */
function failureSentence(code: string, copy: RefundConsoleCopy): string {
  return copy.failure[code] ?? fillPlaceholders(copy.failureOther, { code });
}

/**
 * What a row says about why it exists. The member of staff's own note where they wrote one; the
 * row's fields, worded here, where the service wrote an English sentence for it.
 */
function rowDetail(refund: Refund, copy: RefundConsoleCopy): ReactNode {
  if (refund.routedFrom != null) {
    return fillNodes(copy.detailRoutedFrom, { refund: <Identifier id={refund.routedFrom} /> });
  }
  if (refund.reason === 'CHARGEBACK') {
    return refund.disputeId != null
      ? fillNodes(copy.detailChargeback, { dispute: <Identifier id={refund.disputeId} /> })
      : copy.reason.CHARGEBACK;
  }
  if (refund.requestedBy == null && PLATFORM_REASONS.has(refund.reason)) {
    return copy.detailPlatform[refund.reason] ?? copy.reason[refund.reason];
  }
  return refund.detail;
}

/** One refund. The reason is a tag because it is the thing this list is counted by. */
function RefundRow({
  names,
  refund,
  copy,
  canIssue,
  readerId,
  onSettled,
}: {
  readonly refund: Refund;
  readonly names: DirectoryNames;
  readonly copy: RefundConsoleCopy;
  /** Whether the reader holds `ISSUE_REFUND` — the reveal, the record and the fallback are its. */
  readonly canIssue: boolean;
  readonly readerId: string | null;
  readonly onSettled: (notice: RefundRowNotice) => void;
}) {
  const locale = useRouteLocale();
  const transfer = refund.bankTransfer ?? null;
  const routed = refund.routedTo ?? null;

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white">
          {refund.state === 'SUCCEEDED'
            ? fillPlaceholders(copy.amountSent, { amount: formatMoney(refund.amount) })
            : formatMoney(refund.amount)}
          {refund.withheldFee != null && (
            <span className="text-white/64">
              {' · '}
              {fillPlaceholders(copy.withheldNote, { fee: formatMoney(refund.withheldFee) })}
            </span>
          )}
        </p>
        <span className="flex flex-wrap gap-2">
          <Tag>{refund.fullRefund ? copy.fullRefund : copy.partialRefund}</Tag>
          <Tag>{copy.state[refund.state]}</Tag>
        </span>
      </div>

      <p className="mt-2 text-xs text-white/64">
        {fillNodes(copy.pledgeLine, {
          backer: nameOrDash(refund.backerId, 'account', names, copy),
          campaign: <EntityName id={refund.projectId} names={names} kind="project" copy={copy.identity} />,
          pledge: <Identifier id={refund.pledgeId} />,
        })}
      </p>

      <p className="mt-2 text-xs text-white/64">
        {fillNodes(copy.reasonAndDetail, {
          reason: copy.reason[refund.reason],
          detail: rowDetail(refund, copy),
        })}
      </p>

      <p className="mt-2 text-xs text-white/48">
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
          date: formatDate(refund.requestedAt, locale),
        })}
      </p>

      {refund.failureCode && (
        <p className="mt-2 text-xs text-white/64">
          {failureSentence(refund.failureCode, copy)}
          {refund.failureMessage && !(refund.failureCode in copy.failure)
            ? ` ${fillPlaceholders(copy.providerSaid, { message: refund.failureMessage })}`
            : ''}
        </p>
      )}

      {routed !== null && (
        <p className="mt-2 text-xs text-white/64">
          {fillPlaceholders(copy.bank.routedTo, { state: copy.state[routed.state] })}
        </p>
      )}

      <Suspense fallback={null}>
        {transfer !== null && <BankTransferFacts transfer={transfer} names={names} copy={copy} />}

        {refund.state === 'AWAITING_BANK_DETAILS' && (
          <>
            <p className="mt-2 max-w-[62ch] text-xs text-white/64">{copy.bank.awaitingBankDetails}</p>
            <BackerTicketForm
              pledgeId={refund.pledgeId}
              copy={copy.backerTicket}
              bankDetails={copy.bankDetails}
              subject={copy.subject}
              refusals={copy.refusals}
              recordAccount
              onRecorded={(saved) =>
                onSettled({
                  title: copy.bankDetails.savedTitle,
                  body: fillPlaceholders(copy.bankDetails.savedBody, { hint: saved.hint, amount: saved.amount }),
                })
              }
            />
          </>
        )}

        {refund.state === 'AWAITING_TRANSFER' && transfer !== null && canIssue && (
          <AwaitingTransfer
            refund={refund}
            transfer={transfer}
            readerId={readerId}
            copy={copy}
            onSettled={onSettled}
          />
        )}

        {/* Once routed, the fallback has been taken; the row says where the money went instead. */}
        {refund.state === 'FAILED' && routed === null && canIssue && (
          <RouteToBankTransfer refund={refund} copy={copy} onSettled={onSettled} />
        )}
      </Suspense>
    </li>
  );
}
