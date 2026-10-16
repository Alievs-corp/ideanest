'use client';

import { useState } from 'react';
import { Field, InlineAlert, Pill, Select, Tag, TextInput } from '@ideanest/ui';
import {
  PLAN_PAYMENT_METHODS,
  activateSubscription,
  cancelSubscriptionAsStaff,
  receivedAtFor,
  type ConsoleSubscription,
  type PaymentMethod,
} from '../../lib/admin/plans';
import { bankDay } from '../../lib/admin/payouts';
import { bakuDate, calendarDate } from '../../lib/admin/console-dates';
// The printing half only: the money module's root brings decimal.js, which nothing here needs.
import { formatMoney } from '@ideanest/money/format';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { Locale } from '../../lib/i18n/locale';
import type { PlanManagerCopy } from '../../lib/i18n/admin/money-copy';
import type { DirectoryNames } from '../../lib/admin/directory';
import { Confirm } from './ConsoleConfirm';
import { EntityName } from './ConsoleIdentity';

/**
 * One subscription on the plan manager's payment queue: recording the payment that started it, and
 * ending it. Its own module, loaded when the queue draws a row, so the Baku-day formatting and the
 * payment form stay out of `/admin/plans`' First Load JS.
 */

/** States a member of staff can still end. Anything else has ended already. */
function endable(subscription: ConsoleSubscription): boolean {
  return subscription.state === 'PENDING_PAYMENT' || subscription.state === 'ACTIVE';
}

/* -------------------------------------------------------------------------
 * One subscription
 * ---------------------------------------------------------------------- */

export interface SubscriptionRowProps {
  readonly subscription: ConsoleSubscription;
  readonly names: DirectoryNames;
  readonly accountName: string;
  readonly copy: PlanManagerCopy;
  readonly locale: Locale;
  readonly refusalOf: (cause: unknown) => string;
  readonly onDone: (body: string) => void;
}

type SubscriptionAsking = 'none' | 'record' | 'end';

export function SubscriptionRow({ subscription, names, accountName, copy, locale, refusalOf, onDone }: SubscriptionRowProps) {
  // Separate pieces of state: a reason for ending one subscription must never become the payment
  // reference of another.
  const today = bankDay();
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [received, setReceived] = useState(today);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState<SubscriptionAsking>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = subscription.state === 'PENDING_PAYMENT';
  const plan = subscription.planName ?? subscription.planCode ?? copy.unknownPlan;
  const price = formatMoney({ amount: subscription.price, currency: subscription.currency });
  // `type="date"` gives `YYYY-MM-DD`; a later day than Baku's today is a payment that has not arrived.
  const receivedValid = /^\d{4}-\d{2}-\d{2}$/.test(received) && received <= today;

  async function write(work: () => Promise<unknown>, done: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setAsking('none');
      onDone(done);
    } catch (cause) {
      setAsking('none');
      setError(refusalOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] text-white">
            {plan} <EntityName id={subscription.accountId} names={names} kind="account" copy={copy.identity} />
          </p>
          <p className="mt-1 text-[13px] text-white/64">
            {fillPlaceholders(copy.subscriptionSummary, {
              price,
              until:
                subscription.currentPeriodEnd == null ? copy.notStarted : bakuDate(subscription.currentPeriodEnd, locale),
            })}
          </p>
        </div>

        <Tag variant={subscription.entitled ? 'success' : pending ? 'warning' : 'default'}>
          {copy.state[subscription.state]}
        </Tag>
      </div>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-3">
          {error}
        </InlineAlert>
      )}

      {pending && asking !== 'end' && (
        <form
          aria-label={copy.recordPayment}
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (receivedValid) setAsking('record');
          }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <Field label={copy.referenceLabel} hint={copy.referenceHint} className="min-w-[220px] flex-1">
              <TextInput
                value={reference}
                maxLength={200}
                autoComplete="off"
                disabled={asking === 'record'}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
            <Field label={copy.methodLabel} className="min-w-[180px]">
              <Select
                value={method}
                disabled={asking === 'record'}
                onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              >
                {PLAN_PAYMENT_METHODS.map((option) => (
                  <option key={option} value={option}>
                    {copy.method[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={copy.receivedLabel}
              hint={copy.receivedHint}
              error={receivedValid ? undefined : copy.receivedInvalid}
              className="min-w-[180px]"
            >
              <TextInput
                type="date"
                value={received}
                max={today}
                disabled={asking === 'record'}
                onChange={(event) => setReceived(event.target.value)}
              />
            </Field>
          </div>
          <Field label={copy.noteLabel} hint={copy.noteHint}>
            <TextInput
              value={note}
              maxLength={2000}
              disabled={asking === 'record'}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {asking === 'record' ? (
            <Confirm
              label={copy.recordPayment}
              text={fillPlaceholders(copy.confirmRecord, {
                price,
                plan,
                account: accountName,
                method: copy.method[method],
                date: calendarDate(received, locale),
              })}
              action={copy.confirmRecordAction}
              working={copy.saving}
              back={copy.back}
              busy={busy}
              onConfirm={() =>
                void write(
                  () =>
                    activateSubscription(subscription.id, {
                      method,
                      ...(receivedAtFor(received, today) === undefined ? {} : { receivedAt: receivedAtFor(received, today) }),
                      ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
                      ...(note.trim() === '' ? {} : { note: note.trim() }),
                    }),
                  fillPlaceholders(copy.activatedNotice, { account: accountName }),
                )
              }
              onBack={() => setAsking('none')}
            />
          ) : (
            <div>
              <Pill type="submit" variant="outline" size="sm" disabled={busy || !receivedValid}>
                {copy.recordPayment}
              </Pill>
            </div>
          )}
        </form>
      )}

      {endable(subscription) && asking !== 'record' && (
        <div className="mt-3 flex flex-col gap-3">
          {asking === 'end' ? (
            <Confirm
              label={copy.endSubscription}
              text={fillPlaceholders(copy.confirmEnd, { account: accountName, plan })}
              action={copy.confirmEndAction}
              working={copy.saving}
              back={copy.back}
              busy={busy}
              onConfirm={() =>
                void write(
                  () => cancelSubscriptionAsStaff(subscription.id, reason.trim()),
                  fillPlaceholders(copy.endedNotice, { account: accountName }),
                )
              }
              onBack={() => setAsking('none')}
            />
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <Field label={copy.endReasonLabel} hint={copy.endReasonHint} className="min-w-[260px] flex-1">
                <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
              </Field>
              <Pill
                variant="ghost"
                size="sm"
                className="mt-8"
                disabled={busy || reason.trim() === ''}
                onClick={() => setAsking('end')}
              >
                {copy.endSubscription}
              </Pill>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
