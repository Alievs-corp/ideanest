'use client';

import { Suspense, lazy, useState } from 'react';
import {
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
} from '@ideanest/ui';
import {
  addPlan,
  changePlan,
  readPlanCatalogue,
  readSubscriptions,
  type BillingPeriod,
  type Plan,
  type PlanPriceRequest,
} from '../../lib/admin/plans';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import { shortId } from '../../lib/admin/refusals';
// The printing half only: the money module's root brings decimal.js, which nothing here needs.
import { formatMoney } from '@ideanest/money/format';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { Locale } from '../../lib/i18n/locale';
import type { PlanManagerCopy } from '../../lib/i18n/admin/money-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { Confirm } from './ConsoleConfirm';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';
import {
  PlanTextFields,
  emptyPlanTexts,
  namelessLanguage,
  planTextsOf,
  translationsFrom,
  type PlanTextDraft,
} from './PlanTextFields';

/** Shortest first, as the service lists them and the pricing page's switch draws them (#655). */
const PERIODS: readonly BillingPeriod[] = ['MONTHLY', 'SEMIANNUAL', 'YEARLY'];

/** What is typed in the three price fields. Empty means "not sold for this period". */
export type PriceDraft = Readonly<Record<BillingPeriod, string>>;

/** The add form's start: a month at the starter price, the longer periods left for the operator. */
const NEW_PLAN_PRICES: PriceDraft = { MONTHLY: '19.00', SEMIANNUAL: '', YEARLY: '' };

/** A plan's prices as the fields show them. */
export function priceDraftOf(plan: Plan): PriceDraft {
  const draft: Record<BillingPeriod, string> = { MONTHLY: '', SEMIANNUAL: '', YEARLY: '' };
  for (const entry of plan.prices) draft[entry.billingPeriod] = entry.price;
  return draft;
}

/**
 * The prices typed, shortest first, or `undefined` when one of them is not a price or none was
 * typed at all: a plan is sold for at least one period, and the service refuses an empty set.
 */
export function pricesFrom(draft: PriceDraft): readonly PlanPriceRequest[] | undefined {
  const prices: PlanPriceRequest[] = [];
  for (const period of PERIODS) {
    if (draft[period].trim() === '') continue;
    const price = priceFrom(draft[period]);
    if (price === undefined) return undefined;
    prices.push({ billingPeriod: period, price });
  }
  return prices.length === 0 ? undefined : prices;
}

/** Whether two sets of prices say the same thing, decimal places and all. */
function samePrices(left: readonly PlanPriceRequest[], right: readonly PlanPriceRequest[]): boolean {
  const key = (prices: readonly PlanPriceRequest[]) =>
    prices.map((entry) => `${entry.billingPeriod}:${entry.price}`).join('|');
  return key(left) === key(right);
}

/**
 * One subscription and its forms, fetched when the queue draws a row: the payment form and the
 * Baku-day formatting it needs put `/admin/plans` over its First Load JS budget when bundled here.
 */
const SubscriptionRow = lazy(() =>
  import('./PlanSubscriptionRow').then((module) => ({ default: module.SubscriptionRow })),
);

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
  const [texts, setTexts] = useState<PlanTextDraft>(emptyPlanTexts);
  const [language, setLanguage] = useState<Locale>('az');
  const [prices, setPrices] = useState<PriceDraft>(NEW_PLAN_PRICES);
  const [studentOnly, setStudentOnly] = useState(false);
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

  const newPrices = pricesFrom(prices);
  const newLimit = campaignLimitFrom(maxActive);
  const newCeiling = ceilingFrom(goalCeiling);
  const addReady =
    code.trim() !== '' &&
    texts.az.name.trim() !== '' &&
    namelessLanguage(texts) === undefined &&
    newPrices !== undefined &&
    newLimit !== undefined &&
    newCeiling !== undefined;

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!addReady || newPrices === undefined || newLimit === undefined || newCeiling === undefined) return;

    setAdding(true);
    setAdded(null);
    try {
      const plan = await addPlan({
        code: code.trim().toUpperCase(),
        name: texts.az.name.trim(),
        description: texts.az.description.trim() === '' ? null : texts.az.description.trim(),
        translations: translationsFrom(texts),
        currency: 'AZN',
        prices: newPrices,
        studentOnly,
        maxActiveCampaigns: newLimit,
        goalCeiling: newCeiling,
        sortOrder: (catalogue.data?.plans.length ?? 0) * 10 + 10,
      });

      setAdded({ variant: 'success', title: copy.doneTitle, body: fillPlaceholders(copy.addedNotice, { plan: plan.name }) });
      setCode('');
      setTexts(emptyPlanTexts());
      setLanguage('az');
      setPrices(NEW_PLAN_PRICES);
      setStudentOnly(false);
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
        <h2 id="plan-catalogue-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.catalogueHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.catalogueIntro}</p>

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
        <h2 id="plan-add-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.addHeading}
        </h2>

        <form onSubmit={(event) => void add(event)} className="mt-4 flex flex-col gap-3">
          <Field label={copy.codeLabel} hint={copy.codeHint} className="max-w-[280px]">
            <TextInput value={code} onChange={(event) => setCode(event.target.value)} maxLength={40} />
          </Field>

          <PlanTextFields draft={texts} onChange={setTexts} language={language} onLanguage={setLanguage} copy={copy} />

          <PriceFields draft={prices} onChange={setPrices} legend={copy.priceLabel} label={copy.priceFor} copy={copy} />

          <Checkbox
            label={copy.studentOnlyLabel}
            description={copy.studentOnlyHint}
            checked={studentOnly}
            onChange={(event) => setStudentOnly(event.target.checked)}
          />

          <div className="flex flex-wrap items-start gap-3">
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
        <h2 id="plan-queue-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.queueHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.queueIntro}</p>

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
            <Suspense
              fallback={
                <SkeletonGroup label={copy.loadingQueue}>
                  <Skeleton height="1rem" width="40%" />
                </SkeletonGroup>
              }
            >
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
            </Suspense>
          </ul>
        )}
      </section>
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
  const [next, setNext] = useState<PriceDraft>(() => priceDraftOf(plan));
  const [asking, setAsking] = useState<'none' | 'reprice' | 'retire' | 'texts'>('none');
  const [texts, setTexts] = useState<PlanTextDraft>(() => planTextsOf(plan));
  const [language, setLanguage] = useState<Locale>('az');
  const textsReady = texts.az.name.trim() !== '' && namelessLanguage(texts) === undefined;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const nextPrices = pricesFrom(next);
  const money = (amount: string) => formatMoney({ amount, currency: plan.currency });
  const priceList = (prices: readonly PlanPriceRequest[]) =>
    prices
      .map((entry) => fillPlaceholders(copy.pricePer, { price: money(entry.price), period: copy.period[entry.billingPeriod] }))
      .join(' · ');

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
    <li className="rounded-lg border border-fg/8 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm sm:text-[15px] text-fg">
            {plan.name}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-fg-64">{plan.code}</code>
          </p>
          <p className="mt-1 text-[13px] text-fg-64">
            {fillPlaceholders(copy.planSummary, {
              prices: priceList(plan.prices),
              campaigns: plan.maxActiveCampaigns == null ? copy.unlimited : String(plan.maxActiveCampaigns),
              ceiling: plan.goalCeiling == null ? copy.unlimited : money(plan.goalCeiling),
            })}
          </p>
        </div>

        {/* A tag as well as a word: colour alone would carry the meaning (ui-kit §9.2). */}
        <div className="flex flex-wrap gap-2">
          {plan.studentOnly && <Tag>{copy.studentTag}</Tag>}
          <Tag variant={plan.listed ? 'success' : 'default'}>{plan.listed ? copy.onSale : copy.retired}</Tag>
        </div>
      </div>

      {asking === 'reprice' && nextPrices !== undefined ? (
        <div className="mt-3">
          <Confirm
            label={copy.reprice}
            text={fillPlaceholders(copy.confirmReprice, {
              plan: plan.name,
              old: priceList(plan.prices),
              new: priceList(nextPrices),
            })}
            action={copy.confirmRepriceAction}
            working={copy.saving}
            back={copy.back}
            busy={busy}
            onConfirm={() =>
              void write(
                // The whole set, which replaces the old one: a period emptied here stops being sold.
                () => changePlan({ planId: plan.id, prices: nextPrices }),
                fillPlaceholders(copy.repricedNotice, { plan: plan.name }),
              )
            }
            onBack={() => setAsking('none')}
          />
        </div>
      ) : asking === 'texts' ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!textsReady) return;
            void write(
              () =>
                changePlan({
                  planId: plan.id,
                  name: texts.az.name.trim(),
                  description: texts.az.description.trim(),
                  translations: translationsFrom(texts),
                }),
              fillPlaceholders(copy.textsSavedNotice, { plan: texts.az.name.trim() }),
            );
          }}
        >
          <PlanTextFields draft={texts} onChange={setTexts} language={language} onLanguage={setLanguage} copy={copy} />
          <div className="flex flex-wrap gap-3">
            <Pill type="submit" variant="outline" size="sm" disabled={busy || !textsReady}>
              {busy ? copy.saving : copy.saveTexts}
            </Pill>
            <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setAsking('none')}>
              {copy.back}
            </Pill>
          </div>
        </form>
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
        <div className="mt-3 flex flex-col gap-3">
          <PriceFields draft={next} onChange={setNext} legend={copy.repriceLabel} label={copy.newPriceFor} copy={copy} />

          <div className="flex flex-wrap items-start gap-3">
            <Pill
              variant="ghost"
              size="sm"
              disabled={busy || nextPrices === undefined || samePrices(nextPrices, plan.prices)}
              onClick={() => setAsking('reprice')}
            >
              {copy.reprice}
              <span className="sr-only">: {plan.name}</span>
            </Pill>

            {/* Who may buy it, beside what it costs. Undone by the same button, so it does not ask. */}
            <Pill
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void write(() => changePlan({ planId: plan.id, studentOnly: !plan.studentOnly }), null)}
            >
              {plan.studentOnly ? copy.openToEveryone : copy.makeStudentOnly}
              <span className="sr-only">: {plan.name}</span>
            </Pill>

            <Pill
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setTexts(planTextsOf(plan));
                setLanguage('az');
                setAsking('texts');
              }}
            >
              {copy.editTexts}
              <span className="sr-only">: {plan.name}</span>
            </Pill>

            {plan.listed ? (
              <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setAsking('retire')}>
                {copy.retire}
                <span className="sr-only">: {plan.name}</span>
              </Pill>
            ) : (
              <Pill
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void write(() => changePlan({ planId: plan.id, listed: true }), null)}
              >
                {copy.putOnSale}
                <span className="sr-only">: {plan.name}</span>
              </Pill>
            )}
          </div>
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
 * A price per period — #655
 * ---------------------------------------------------------------------- */

/**
 * The three periods' prices. An empty field is a period the plan is not sold for; at least one
 * must be filled, which the fields say rather than leaving the button greyed for no stated reason.
 *
 * @param label a template carrying `{period}`, so each field is named for its period and the add
 *     form's fields are not confused with a row's
 */
function PriceFields({
  draft,
  onChange,
  legend,
  label,
  copy,
}: {
  readonly draft: PriceDraft;
  readonly onChange: (next: PriceDraft) => void;
  readonly legend: string;
  readonly label: string;
  readonly copy: PlanManagerCopy;
}) {
  const none = PERIODS.every((period) => draft[period].trim() === '');

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-fg">{legend}</legend>
      <p className="text-[13px] text-fg-64">{copy.pricesHint}</p>
      <div className="flex flex-wrap items-start gap-3">
        {PERIODS.map((period) => {
          const typed = draft[period];
          const invalid = typed.trim() !== '' && priceFrom(typed) === undefined;
          return (
            <Field
              key={period}
              label={fillPlaceholders(label, { period: copy.period[period] })}
              error={invalid ? copy.priceInvalid : undefined}
              className="min-w-[150px]"
            >
              <TextInput
                inputMode="decimal"
                value={typed}
                onChange={(event) => onChange({ ...draft, [period]: event.target.value })}
              />
            </Field>
          );
        })}
      </div>
      {none && <p className="text-[13px] text-danger">{copy.pricesMissing}</p>}
    </fieldset>
  );
}
