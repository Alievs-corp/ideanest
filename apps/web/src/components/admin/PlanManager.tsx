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
  TextInput,
} from '@ideanest/ui';
import {
  PLAN_PAYMENT_METHODS,
  activateSubscription,
  addPlan,
  cancelSubscriptionAsStaff,
  changePlan,
  readPlanCatalogue,
  readSubscriptions,
  receivedAtFor,
  type BillingPeriod,
  type ConsoleSubscription,
  type PaymentMethod,
  type Plan,
} from '../../lib/admin/plans';
import { bankDay } from '../../lib/admin/payouts';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import { bakuDate, calendarDate } from '../../lib/admin/console-dates';
import { shortId } from '../../lib/admin/refusals';
import { formatMoney } from '../../lib/money';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { Locale } from '../../lib/i18n/locale';
import type { PlanManagerCopy } from '../../lib/i18n/admin/money-copy';
import type { DirectoryNames } from '../../lib/admin/directory';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

const PERIODS: readonly BillingPeriod[] = ['MONTHLY', 'YEARLY'];

/**
 * AD-11's second screen: the plans a creator publishes under, and who is on them.
 *
 * <h2>Two things on one screen, and they are not two screens</h2>
 *
 * The catalogue and the payment queue are one job: the person who sets a price is the person who
 * confirms the money against it. A card payment on the provider's page records itself; a transfer,
 * cash or anything else is recorded here, with its reference, how it was paid and the day it
 * arrived — the revenue report reads all three.
 *
 * <h2>A plan is edited in place, and the screen says why that is safe</h2>
 *
 * A subscriber's price is copied onto their own subscription at purchase, so nothing here reaches
 * backwards into a bill. The limits are read live, which the notice says.
 *
 * <h2>Everything that cannot be taken back asks first</h2>
 *
 * Repricing, taking a plan off sale, recording a payment and ending a subscription each say what is
 * about to happen and do it on the second press. What happened, or why it did not, is said beside the
 * control that did it rather than at the foot of the page.
 *
 * MOTION: none, like every console screen. `docs/motion-system.md` §5.
 */
export interface PlanManagerProps {
  readonly copy: PlanManagerCopy;
}

interface Said {
  readonly variant: 'success' | 'danger';
  readonly title: string;
  readonly body: string;
}

/** A price as typed: at most two decimals, a comma read as the decimal mark. `undefined` when it is not one. */
export function priceFrom(input: string): string | undefined {
  const typed = input.trim().replace(',', '.');
  return /^\d{1,10}(\.\d{1,2})?$/.test(typed) ? typed : undefined;
}

/** A limit on campaigns: a whole number of one or more, or empty for none. `undefined` when it is neither. */
export function campaignLimitFrom(input: string): number | null | undefined {
  const typed = input.trim();
  if (typed === '') return null;
  if (!/^\d{1,6}$/.test(typed)) return undefined;
  const limit = Number(typed);
  return limit >= 1 ? limit : undefined;
}

/** A goal ceiling: a positive amount, or empty for none. `undefined` when it is neither. */
export function ceilingFrom(input: string): string | null | undefined {
  if (input.trim() === '') return null;
  const price = priceFrom(input);
  return price === undefined || /^0+(\.0+)?$/.test(price) ? undefined : price;
}

/** States a member of staff can still end. Anything else has ended already. */
function endable(subscription: ConsoleSubscription): boolean {
  return subscription.state === 'PENDING_PAYMENT' || subscription.state === 'ACTIVE';
}

export function PlanManager({ copy }: PlanManagerProps) {
  const locale = useRouteLocale();
  const catalogue = useConsoleResource(
    (signal) => readPlanCatalogue(signal),
    copy.subject,
    copy.refusals,
    [],
  );

  const [queueOnly, setQueueOnly] = useState(true);
  const queue = useConsoleResource(
    (signal) => readSubscriptions(queueOnly, signal),
    copy.subject,
    copy.refusals,
    [queueOnly],
  );

  /* Whose subscription each row is — #402. */
  const names = useDirectoryNames(
    (queue.data?.subscriptions ?? []).map((subscription) => subscription.accountId),
    [],
  );

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('19.00');
  const [period, setPeriod] = useState<BillingPeriod>('MONTHLY');
  const [maxActive, setMaxActive] = useState('1');
  const [goalCeiling, setGoalCeiling] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Said | null>(null);
  const [queueSaid, setQueueSaid] = useState<Said | null>(null);

  if (catalogue.status === 'signed-out' || catalogue.status === 'forbidden') {
    return <ConsoleRefusal status={catalogue.status} capability={catalogue.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const refusalOf = (cause: unknown) =>
    codedRefusalFor(cause, copy.errors, copy.errors['INVALID_REQUEST'] ?? copy.refusals.refused, copy.subject, copy.refusals);

  const accountName = (id: string) => names.accounts.get(id)?.name ?? shortId(id);

  const newPrice = priceFrom(price);
  const newLimit = campaignLimitFrom(maxActive);
  const newCeiling = ceilingFrom(goalCeiling);
  const addReady =
    code.trim() !== '' && name.trim() !== '' && newPrice !== undefined && newLimit !== undefined && newCeiling !== undefined;

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!addReady || newPrice === undefined || newLimit === undefined || newCeiling === undefined) return;

    setAdding(true);
    setAdded(null);
    try {
      const plan = await addPlan({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        price: newPrice,
        currency: 'AZN',
        billingPeriod: period,
        maxActiveCampaigns: newLimit,
        goalCeiling: newCeiling,
        sortOrder: (catalogue.data?.plans.length ?? 0) * 10 + 10,
      });

      setAdded({ variant: 'success', title: copy.doneTitle, body: fillPlaceholders(copy.addedNotice, { plan: plan.name }) });
      setCode('');
      setName('');
      setDescription('');
      catalogue.reload();
    } catch (cause) {
      setAdded({ variant: 'danger', title: copy.failedTitle, body: refusalOf(cause) });
    } finally {
      setAdding(false);
    }
  }

  /** A subscription write the service refused because the row moved: the list is read again. */
  function queueRefused(cause: unknown): string {
    const code = refusalCode(cause);
    if (code === 'SUBSCRIPTION_NOT_PENDING' || code === 'SUBSCRIPTION_NOT_OPEN' || code === 'SUBSCRIPTION_NOT_FOUND') {
      queue.reload();
    }
    return refusalOf(cause);
  }

  const plans = catalogue.data?.plans ?? [];
  const subscriptions = queue.data?.subscriptions ?? [];

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      {/* ---- the catalogue ------------------------------------------------ */}

      <section aria-labelledby="plan-catalogue-heading">
        <h2 id="plan-catalogue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.catalogueHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.catalogueIntro}</p>

        {catalogue.status === 'loading' && (
          <SkeletonGroup label={copy.loadingCatalogue} className="mt-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="60%" className="mt-3" />
          </SkeletonGroup>
        )}

        {catalogue.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {catalogue.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={catalogue.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {catalogue.status === 'ready' && plans.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyCatalogueTitle}
            description={copy.emptyCatalogueBody}
          />
        )}

        {catalogue.status === 'ready' && plans.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {plans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                copy={copy}
                refusalOf={refusalOf}
                onChanged={catalogue.reload}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- adding one --------------------------------------------------- */}

      <section aria-labelledby="plan-add-heading">
        <h2 id="plan-add-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.addHeading}
        </h2>

        <form onSubmit={(event) => void add(event)} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field label={copy.codeLabel} hint={copy.codeHint} className="min-w-[180px]">
              <TextInput value={code} onChange={(event) => setCode(event.target.value)} maxLength={40} />
            </Field>
            <Field label={copy.nameLabel} className="min-w-[220px] flex-1">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </Field>
          </div>

          <Field label={copy.descriptionLabel} hint={copy.descriptionHint}>
            <TextInput
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
          </Field>

          <div className="flex flex-wrap items-start gap-3">
            <Field
              label={copy.priceLabel}
              hint={copy.priceHint}
              error={newPrice === undefined ? copy.priceInvalid : undefined}
              className="min-w-[160px]"
            >
              <TextInput inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            </Field>

            <Field label={copy.periodLabel} className="min-w-[160px]">
              <Select value={period} onChange={(event) => setPeriod(event.target.value as BillingPeriod)}>
                {PERIODS.map((option) => (
                  <option key={option} value={option}>
                    {copy.period[option]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={copy.maxActiveLabel}
              hint={copy.unlimitedHint}
              error={newLimit === undefined ? copy.maxActiveInvalid : undefined}
              className="min-w-[180px]"
            >
              <TextInput inputMode="numeric" value={maxActive} onChange={(event) => setMaxActive(event.target.value)} />
            </Field>

            <Field
              label={copy.goalCeilingLabel}
              hint={copy.unlimitedHint}
              error={newCeiling === undefined ? copy.goalCeilingInvalid : undefined}
              className="min-w-[180px]"
            >
              <TextInput inputMode="decimal" value={goalCeiling} onChange={(event) => setGoalCeiling(event.target.value)} />
            </Field>
          </div>

          <div>
            <Pill type="submit" variant="outline" size="sm" disabled={adding || !addReady}>
              {adding ? copy.saving : copy.addPlan}
            </Pill>
          </div>
        </form>

        {added !== null && (
          <InlineAlert variant={added.variant} title={added.title} className="mt-4">
            {added.body}
          </InlineAlert>
        )}
      </section>

      {/* ---- the payment queue -------------------------------------------- */}

      <section aria-labelledby="plan-queue-heading">
        <h2 id="plan-queue-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.queueHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.queueIntro}</p>

        <Pill
          variant="ghost"
          size="sm"
          className="mt-4"
          onClick={() => setQueueOnly((only) => !only)}
          aria-pressed={!queueOnly}
        >
          {queueOnly ? copy.showAll : copy.showQueue}
        </Pill>

        {queueSaid !== null && (
          <InlineAlert variant={queueSaid.variant} title={queueSaid.title} className="mt-4">
            {queueSaid.body}
          </InlineAlert>
        )}

        {queue.status === 'loading' && (
          <SkeletonGroup label={copy.loadingQueue} className="mt-4">
            <Skeleton height="1rem" width="40%" />
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

        {queue.status === 'ready' && subscriptions.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyQueueTitle}
            description={copy.emptyQueueBody}
          />
        )}

        {queue.status === 'ready' && subscriptions.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {subscriptions.map((subscription) => (
              <SubscriptionRow
                key={subscription.id}
                subscription={subscription}
                names={names}
                accountName={accountName(subscription.accountId)}
                copy={copy}
                locale={locale}
                refusalOf={queueRefused}
                onDone={(body) => {
                  setQueueSaid({ variant: 'success', title: copy.doneTitle, body });
                  queue.reload();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Asking first
 * ---------------------------------------------------------------------- */

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
 * One plan
 * ---------------------------------------------------------------------- */

interface PlanRowProps {
  readonly plan: Plan;
  readonly copy: PlanManagerCopy;
  readonly refusalOf: (cause: unknown) => string;
  readonly onChanged: () => void;
}

function PlanRow({ plan, copy, refusalOf, onChanged }: PlanRowProps) {
  const [next, setNext] = useState(plan.price);
  const [asking, setAsking] = useState<'none' | 'reprice' | 'retire'>('none');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const nextPrice = priceFrom(next);
  const money = (amount: string) => formatMoney({ amount, currency: plan.currency });

  async function write(work: () => Promise<unknown>, done: string | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      await work();
      setAsking('none');
      if (done !== null) setSaid({ variant: 'success', title: copy.doneTitle, body: done });
      onChanged();
    } catch (cause) {
      setAsking('none');
      setSaid({ variant: 'danger', title: copy.failedTitle, body: refusalOf(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-white">
            {plan.name}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-white/64">{plan.code}</code>
          </p>
          <p className="mt-1 text-[13px] text-white/64">
            {fillPlaceholders(copy.planSummary, {
              price: money(plan.price),
              period: copy.period[plan.billingPeriod],
              campaigns: plan.maxActiveCampaigns == null ? copy.unlimited : String(plan.maxActiveCampaigns),
              ceiling: plan.goalCeiling == null ? copy.unlimited : money(plan.goalCeiling),
            })}
          </p>
        </div>

        {/* A tag as well as a word: colour alone would carry the meaning (ui-kit §9.2). */}
        <Tag variant={plan.listed ? 'success' : 'default'}>{plan.listed ? copy.onSale : copy.retired}</Tag>
      </div>

      {asking === 'reprice' && nextPrice !== undefined ? (
        <div className="mt-3">
          <Confirm
            label={copy.reprice}
            text={fillPlaceholders(copy.confirmReprice, { plan: plan.name, old: money(plan.price), new: money(nextPrice) })}
            action={copy.confirmRepriceAction}
            working={copy.saving}
            back={copy.back}
            busy={busy}
            onConfirm={() =>
              void write(
                () => changePlan({ planId: plan.id, price: nextPrice }),
                fillPlaceholders(copy.repricedNotice, { plan: plan.name }),
              )
            }
            onBack={() => setAsking('none')}
          />
        </div>
      ) : asking === 'retire' ? (
        <div className="mt-3">
          <Confirm
            label={copy.retire}
            text={fillPlaceholders(copy.confirmRetire, { plan: plan.name })}
            action={copy.confirmRetireAction}
            working={copy.saving}
            back={copy.back}
            busy={busy}
            onConfirm={() => void write(() => changePlan({ planId: plan.id, listed: false }), null)}
            onBack={() => setAsking('none')}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <Field
            label={copy.repriceLabel}
            error={nextPrice === undefined ? copy.priceInvalid : undefined}
            className="min-w-[160px]"
          >
            <TextInput inputMode="decimal" value={next} onChange={(event) => setNext(event.target.value)} />
          </Field>

          <Pill
            variant="ghost"
            size="sm"
            className="mt-8"
            disabled={busy || nextPrice === undefined || nextPrice === plan.price}
            onClick={() => setAsking('reprice')}
          >
            {copy.reprice}
            <span className="sr-only">: {plan.name}</span>
          </Pill>

          {plan.listed ? (
            <Pill variant="ghost" size="sm" className="mt-8" disabled={busy} onClick={() => setAsking('retire')}>
              {copy.retire}
              <span className="sr-only">: {plan.name}</span>
            </Pill>
          ) : (
            <Pill
              variant="ghost"
              size="sm"
              className="mt-8"
              disabled={busy}
              onClick={() => void write(() => changePlan({ planId: plan.id, listed: true }), null)}
            >
              {copy.putOnSale}
              <span className="sr-only">: {plan.name}</span>
            </Pill>
          )}
        </div>
      )}

      {said !== null && (
        <InlineAlert variant={said.variant} title={said.title} className="mt-3">
          {said.body}
        </InlineAlert>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * One subscription
 * ---------------------------------------------------------------------- */

interface SubscriptionRowProps {
  readonly subscription: ConsoleSubscription;
  readonly names: DirectoryNames;
  readonly accountName: string;
  readonly copy: PlanManagerCopy;
  readonly locale: Locale;
  readonly refusalOf: (cause: unknown) => string;
  readonly onDone: (body: string) => void;
}

type SubscriptionAsking = 'none' | 'record' | 'end';

function SubscriptionRow({ subscription, names, accountName, copy, locale, refusalOf, onDone }: SubscriptionRowProps) {
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
