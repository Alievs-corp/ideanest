'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MoveRight, Plus } from 'lucide-react';
import { InlineAlert, Pill } from '@ideanest/ui';
import { newIdempotencyKey } from '@ideanest/checkout/idempotency';
import { PAYMENT_CHECKS, PAYMENT_CHECK_INTERVAL_MS } from '@ideanest/checkout/pledge';
import { planPaymentRefusalOf, planPaymentReturnOf } from '@ideanest/plans/payment';
import { ApiError } from '../../lib/api/problem';
import {
  cancelSubscription,
  formatPrice,
  payForPlan,
  planPaymentReturnFor,
  planPaymentReturnHint,
  readMySubscription,
  subscribeToPlan,
  type HeldSubscription,
  type Plan,
  type PlanPaymentReturn,
  type PlanPaymentReturnHint,
} from '../../lib/plans/api';
import { leaveForPaymentPage } from '../../lib/pledges/payment';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { PricingCopy } from '../../lib/i18n/plans-copy';
import { dateTimeFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { Link, useRouter } from '../../i18n/navigation';

/**
 * The plans, and where this visitor stands against them.
 *
 * <h2>The catalogue is a prop and the subscription is a fetch, and that split is the design</h2>
 *
 * A price list is the same document for every reader in a language, so the page renders it on
 * the server where a shared cache can hold it. What this visitor holds is nobody else's
 * business and must not be in that cache, so it is read here after hydration. The consequence
 * is visible and deliberate: the prices are in the HTML and the "you are on Growth" badge
 * arrives a moment later.
 *
 * <h2>A signed-out reader sees the prices</h2>
 *
 * `readMySubscription` refuses with a 401 for somebody with no session, and that is not an
 * error on this page — it is the ordinary state of a visitor deciding whether to bring their
 * campaign here. The refusal turns into "sign in to choose a plan" beside the same cards
 * everybody else sees.
 *
 * <h2>Buying does not always mean paid</h2>
 *
 * A priced plan comes back `PENDING_PAYMENT` with `entitled: false`. The panel says what happens
 * next rather than congratulating somebody on a purchase the platform has not seen the money for.
 * A free plan comes back active. Both are the same code path; the panel branches on what the
 * service answered.
 *
 * <h2>Paying and renewing by card (#451)</h2>
 *
 * The service says what can be paid for now in `paymentDue`, and the panel offers exactly that:
 * "Pay by card" for the first period of a pending plan, beside the bank transfer that stays the
 * alternative, and "Renew" inside the renewal window before a period ends. Nothing is charged on
 * a schedule (epic #448), so outside the window the panel only says when renewing opens. The
 * button opens the provider's page through `POST /v1/me/subscription/payment`, with a fresh
 * idempotency key per press, and the provider sends the creator back here with `?payment=`. That
 * word is a hint: the callback is what opens the period, and it can arrive after the browser, so
 * the subscription is re-read every few seconds for a minute (the pledge page's bound) and the
 * notice says paid, still waiting, or not paid from what the subscription now says.
 *
 * MOTION: none. `docs/motion-system.md` §5 gives money surfaces no entry animation, and this
 * is the page where somebody decides to spend some.
 */
export interface PlanChooserProps {
  readonly plans: readonly Plan[];
  readonly copy: PricingCopy;
  readonly locale: Locale;
  /**
   * The campaign a refused submission came from, if that is why the reader is here.
   *
   * <p>Turns the banner on and gives the "back to your campaign" link somewhere to go. Absent
   * for somebody who found this page from the navigation, who is not owed an explanation of
   * why they are looking at it.
   */
  readonly fromProjectId?: string;
}

type Status = 'loading' | 'ready' | 'signed-out';

export function PlanChooser({ plans, copy, locale, fromProjectId }: PlanChooserProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [held, setHeld] = useState<HeldSubscription | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState<PlanPaymentReturnHint | null>(null);
  const [checks, setChecks] = useState(0);

  const announcement = useRef<HTMLDivElement>(null);

  /*
   * Read from the address once, after hydration, as the pledge page does: the hint changes nothing
   * the server renders, and reading it here keeps the page free of a Suspense boundary for one
   * query parameter.
   */
  useEffect(() => {
    setReturned(planPaymentReturnHint(window.location.search));
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const mine = await readMySubscription(controller.signal);
        if (controller.signal.aborted) return;
        setHeld(mine.subscription);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted) return;
        // A 401 here is a visitor with no session reading a price list, which is what this
        // page is for. Anything else is a failure worth naming.
        if (cause instanceof ApiError && cause.status === 401) {
          setStatus('signed-out');
          return;
        }
        setStatus('ready');
        setError(messageFor(cause, copy));
      }
    })();

    return () => controller.abort();
  }, [copy]);

  /*
   * A CHOICE THAT ENTITLES SOMEBODY IS THE END OF THIS PAGE'S BUSINESS WITH THEM.
   *
   * A creator sent here by a refused submission came to do one thing, and a plan that
   * entitles them the moment it is chosen has finished it. Leaving them on a price list to
   * find their own way back is the failure `?from=submit&project=` exists to prevent, and the
   * banner alone was only half of the answer: it says why they are here, and said nothing
   * once the reason had gone.
   *
   * `entitled`, not `state`, because that is the field the service computes for exactly this
   * question — see `lib/plans/api.ts`. A priced plan comes back `PENDING_PAYMENT` and nobody
   * is sent anywhere: the campaign would refuse them again on arrival, which is worse than
   * staying on the page that explains what is still needed.
   */
  const choose = useCallback(
    async (planId: string): Promise<void> => {
      setBusyPlan(planId);
      setError(null);
      try {
        const mine = await subscribeToPlan(planId);
        setHeld(mine.subscription);
        if (fromProjectId !== undefined && mine.subscription?.entitled === true) {
          router.push(`/projects/${fromProjectId}/edit/review`);
        }
      } catch (cause) {
        setError(messageFor(cause, copy));
      } finally {
        setBusyPlan(null);
      }
    },
    [copy, fromProjectId, router],
  );

  /*
   * THE MOMENT A TRANSFER IS RECORDED HAPPENS SOMEWHERE ELSE.
   *
   * A plan paid by bank transfer is activated by a member of staff who has seen the money —
   * minutes or days after the creator chose it, and with no signal to this tab. (A card payment
   * returns to this page with `?payment=`, which is read below.) Without this the creator sits on a page that still says "we are
   * waiting for your transfer" long after it arrived, and their campaign stays unsubmitted
   * because they were never told they could go back.
   *
   * So the subscription is re-read when the window is next focused, which is what returning
   * from a banking app or another tab looks like from here. Only while a pending plan is held
   * and only for a creator with a campaign to get back to: it is a read for one specific
   * wait, not a poll on the price list.
   */
  useEffect(() => {
    if (fromProjectId === undefined) return;
    if (held === null || held.entitled) return;

    const controller = new AbortController();

    function recheck(): void {
      void (async () => {
        try {
          const mine = await readMySubscription(controller.signal);
          if (controller.signal.aborted) return;
          setHeld(mine.subscription);
        } catch {
          // Keep what is on screen. A failed background read is not news a reader can act on,
          // and replacing the panel with an error over one would be losing their place.
        }
      })();
    }

    window.addEventListener('focus', recheck);
    return () => {
      controller.abort();
      window.removeEventListener('focus', recheck);
    };
  }, [fromProjectId, held]);

  /*
   * BACK FROM THE PROVIDER, AND THE CALLBACK MAY NOT HAVE LANDED YET.
   *
   * The pledge page's bound: every three seconds for a minute, and only while the payment the
   * creator has just come back from is still due. Once it is not, or once the page has stopped
   * asking, the notice says so in words. "Still waiting" is never turned into "failed", because the
   * money may have left their account.
   */
  const stoppedAsking = checks >= PAYMENT_CHECKS;
  const outcome: PlanPaymentReturn | null =
    returned !== null && status === 'ready' ? planPaymentReturnOf(returned, held, stoppedAsking) : null;

  useEffect(() => {
    if (outcome !== 'waiting') return;
    const timer = setTimeout(() => {
      setChecks((count) => count + 1);
      void (async () => {
        try {
          const mine = await readMySubscription();
          setHeld(mine.subscription);
        } catch {
          // Keep what is on screen and ask again on the next tick; one failed read is not news.
        }
      })();
    }, PAYMENT_CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [outcome, checks]);

  /*
   * One key per press, minted here. A key belongs to an intent, and the intent is this press: a
   * retry of the request after a lost response answers with the page the first attempt opened. The
   * next press is a new intent, and the service sends a second key back to a page that is still
   * open rather than opening another, so a creator who closed the provider's tab is not stuck
   * behind a spent key.
   */
  const pay = useCallback(async (): Promise<void> => {
    if (paying) return;
    setPaying(true);
    setError(null);
    try {
      const page = await payForPlan(planPaymentReturnFor(fromProjectId), newIdempotencyKey());
      // Leaving, not done: `paying` stays set so the control cannot be pressed again while the
      // browser is on its way to the provider.
      leaveForPaymentPage(page.redirectUrl);
    } catch (cause) {
      setError(paymentMessageFor(cause, copy));
      setPaying(false);
      // "Nothing is due" means the panel is out of date (the window closed, the plan lapsed, or a
      // transfer was recorded meanwhile), so it is read again and stops offering the button.
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const mine = await readMySubscription();
          setHeld(mine.subscription);
        } catch {
          // The message above already says what to do; a failed re-read adds nothing to it.
        }
      }
    }
  }, [copy, fromProjectId, paying]);

  const stop = useCallback(async (): Promise<void> => {
    setCancelling(true);
    setError(null);
    try {
      const mine = await cancelSubscription();
      setHeld(mine.subscription);
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      setCancelling(false);
    }
  }, [copy]);

  return (
    <div className="flex flex-col gap-8">
      {fromProjectId !== undefined &&
        (held?.entitled === true ? (
          <InlineAlert variant="success" title={copy.fromSubmit.ready}>
            <p className="mt-2">
              <Link
                href={`/projects/${fromProjectId}/edit/review`}
                className="text-white underline underline-offset-4"
              >
                {copy.fromSubmit.resume}
              </Link>
            </p>
          </InlineAlert>
        ) : (
          <InlineAlert variant="info" title={copy.fromSubmit.title}>
            <p>{copy.fromSubmit.body}</p>
            <p className="mt-2">
              <Link
                href={`/projects/${fromProjectId}/edit/review`}
                className="text-white underline underline-offset-4"
              >
                {copy.fromSubmit.back}
              </Link>
            </p>
          </InlineAlert>
        ))}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.errors.generic}>
          {error}
        </InlineAlert>
      )}

      {/*
        The live region carries what changed after a choice, because the change itself is a
        badge moving between two cards further down the page. A sighted reader sees it; a
        screen-reader user would otherwise be told nothing at all.
      */}
      <div ref={announcement} aria-live="polite" className="sr-only">
        {held !== null ? describeHeld(held, copy, locale) : ''}
      </div>

      {/*
        Present before anything is put in it, so the notice changing under the polling above --
        waiting, then paid -- is announced. `role="status"`: politely, and without taking focus.
      */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {outcome !== null && held !== null && (
          <PaymentReturnNotice outcome={outcome} held={held} copy={copy} locale={locale} />
        )}
      </div>

      {status === 'loading' && <p className="text-sm text-white/64">{copy.loading}</p>}

      {status === 'signed-out' && (
        <InlineAlert variant="info" title={copy.signedOut}>
          <Link href="/sign-in" className="text-white underline underline-offset-4">
            {copy.signIn}
          </Link>
        </InlineAlert>
      )}

      {held !== null && (
        <HeldPanel
          held={held}
          copy={copy}
          locale={locale}
          cancelling={cancelling}
          onCancel={() => void stop()}
          paying={paying}
          // While the payment the creator has just made is being confirmed, a second button would
          // invite a second payment the notice above says they do not need to make.
          canPay={outcome !== 'waiting'}
          onPay={() => void pay()}
        />
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-white/64">{copy.empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              copy={copy}
              locale={locale}
              current={held?.plan.id === plan.id && held.state !== 'CANCELED'}
              // A visitor with no session is offered the control and sent to sign in by the
              // alert above; disabling it would leave them looking at a price with no way to
              // find out what to do about it.
              busy={busyPlan === plan.id}
              disabled={busyPlan !== null || (held !== null && held.state !== 'CANCELED')}
              onChoose={() => void choose(plan.id)}
              tone={planTone(index)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * What this visitor holds
 * ---------------------------------------------------------------------- */

interface HeldPanelProps {
  held: HeldSubscription;
  copy: PricingCopy;
  locale: Locale;
  cancelling: boolean;
  onCancel: () => void;
  paying: boolean;
  canPay: boolean;
  onPay: () => void;
}

function HeldPanel({ held, copy, locale, cancelling, onCancel, paying, canPay, onPay }: HeldPanelProps) {
  const pending = held.state === 'PENDING_PAYMENT';
  const due = held.paymentDue ?? null;
  const renewing = due === 'RENEWAL' && held.entitled;
  // The subscription's own snapshot price, not today's catalogue price (V62): a renewal is charged
  // at the price the creator bought at.
  const price = formatPrice(held.price, held.currency, locale);
  const opensAt = due === null && held.entitled ? formatDate(held.renewalOpensAt, locale) : '';

  return (
    <section
      aria-labelledby="pricing-held-heading"
      className="rounded-2xl border border-white/8 bg-surface-2 p-5"
    >
      <h2 id="pricing-held-heading" className="text-[13px] font-medium tracking-[0.06em] text-white/40 uppercase">
        {copy.held.heading}
      </h2>

      {/*
        `warning` rather than `success` for a plan that is chosen and not paid for. It is not
        a failure, and it is not finished either -- and a green tick beside a subscription
        that entitles nobody is the one thing this panel must not show.
      */}
      <InlineAlert
        variant={pending || renewing ? 'warning' : held.entitled ? 'success' : 'info'}
        title={describeHeld(held, copy, locale)}
        className="mt-3"
      >
        {pending && due === 'FIRST_PERIOD' && <p>{copy.payment.cardBody}</p>}
        {/* Bank transfer stays as the alternative (epic #448), so it is said beside the card. */}
        {pending && <p className={due === 'FIRST_PERIOD' ? 'mt-2' : undefined}>{copy.held.pendingBody}</p>}
        {renewing && <p>{copy.payment.renewalBody}</p>}
        {renewing && held.cancelAtPeriodEnd && <p className="mt-2">{copy.payment.renewalCancelled}</p>}
        {opensAt !== '' && <p>{fillPlaceholders(copy.payment.renewsFrom, { date: opensAt })}</p>}
      </InlineAlert>

      {/*
        White, the primary action, not lime: lime says "act now" (ui-kit 2.3) and the plan cards
        below already carry it. No entry motion either: this is the step that takes money
        (motion-system 5). `aria-disabled` rather than `disabled` while the request is in flight,
        as the plan cards do, so focus is not thrown off the control the reader just pressed.
      */}
      {due !== null && canPay && (pending || renewing) && (
        <Pill
          variant="primary"
          size="md"
          className={paying ? 'mt-4 opacity-40' : 'mt-4'}
          aria-disabled={paying}
          onClick={() => {
            if (paying) return;
            onPay();
          }}
        >
          {paying
            ? copy.payment.opening
            : fillPlaceholders(due === 'RENEWAL' ? copy.payment.renew : copy.payment.payByCard, { price })}
        </Pill>
      )}

      {held.entitled && !held.cancelAtPeriodEnd && (
        <Pill variant="ghost" size="sm" className="mt-4" aria-disabled={cancelling} onClick={onCancel}>
          {cancelling ? copy.held.cancelling : copy.held.cancel}
        </Pill>
      )}
    </section>
  );
}

/**
 * One sentence saying where this visitor stands.
 *
 * <p>Four states and four sentences, rather than one sentence with a status word appended.
 * "Growth, pending" tells a creator nothing about what to do; "we are waiting for your
 * transfer" does.
 */
function describeHeld(held: HeldSubscription, copy: PricingCopy, locale: Locale): string {
  const plan = held.plan.name;
  const date = formatDate(held.currentPeriodEnd, locale);

  if (held.state === 'PENDING_PAYMENT') return fillPlaceholders(copy.held.pendingTitle, { plan });
  if (!held.entitled) return fillPlaceholders(copy.held.lapsed, { plan, date });
  if (held.paymentDue === 'RENEWAL') return fillPlaceholders(copy.payment.renewalTitle, { plan, date });
  if (held.cancelAtPeriodEnd) return fillPlaceholders(copy.held.endingOn, { plan, date });
  return fillPlaceholders(copy.held.activeUntil, { plan, date });
}

/**
 * What the creator is told on the way back from the provider.
 *
 * <p>The subscription decides it (`planPaymentReturnOf`), not the word in the address. Words and an
 * icon-bearing alert rather than colour alone (ui-kit 9.2), and no motion: this is money.
 */
function PaymentReturnNotice({
  outcome,
  held,
  copy,
  locale,
}: {
  readonly outcome: PlanPaymentReturn;
  readonly held: HeldSubscription;
  readonly copy: PricingCopy;
  readonly locale: Locale;
}) {
  const returned = copy.payment.returned;
  switch (outcome) {
    case 'paid':
      return (
        <InlineAlert variant="success" title={returned.paidTitle}>
          <p>
            {fillPlaceholders(returned.paidBody, {
              plan: held.plan.name,
              date: formatDate(held.currentPeriodEnd, locale),
            })}
          </p>
        </InlineAlert>
      );
    case 'waiting':
      return (
        <InlineAlert variant="info" title={returned.waitingTitle}>
          <p>{returned.waitingBody}</p>
        </InlineAlert>
      );
    case 'unconfirmed':
      return (
        <InlineAlert variant="warning" title={returned.unconfirmedTitle}>
          <p>{returned.unconfirmedBody}</p>
        </InlineAlert>
      );
    case 'failed':
      return (
        <InlineAlert variant="warning" title={returned.failedTitle}>
          <p>{returned.failedBody}</p>
        </InlineAlert>
      );
  }
}

/* -------------------------------------------------------------------------
 * One plan
 * ---------------------------------------------------------------------- */

interface PlanCardProps {
  plan: Plan;
  copy: PricingCopy;
  locale: Locale;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
  tone: PlanTone;
}

function PlanCard({ plan, copy, locale, current, busy, disabled, onChoose, tone }: PlanCardProps) {
  const price =
    Number(plan.price) === 0 ? copy.free : formatPrice(plan.price, plan.currency, locale);
  const period = plan.billingPeriod === 'YEARLY' ? copy.perYear : copy.perMonth;
  const skin = PLAN_SKIN[tone];
  const points = [
    ...(plan.description == null ? [] : [plan.description]),
    plan.maxActiveCampaigns == null
      ? copy.limits.campaignsUnlimited
      : fillPlaceholders(copy.limits.campaigns, { count: String(plan.maxActiveCampaigns) }),
    plan.goalCeiling == null
      ? copy.limits.goalUnlimited
      : fillPlaceholders(copy.limits.goalCeiling, {
          amount: formatPrice(plan.goalCeiling, plan.currency, locale),
        }),
  ];

  return (
    <li
      {...skin.context}
      className={`group flex min-h-[420px] flex-col rounded-2xl p-6 transition-transform duration-300 ease-in-out motion-safe:hover:-translate-y-1 motion-safe:focus-within:-translate-y-1 ${skin.card}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{plan.name}</h3>
        {current && (
          <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${skin.tag}`}>
            {copy.held.currentTag}
          </span>
        )}
      </div>

      <ul className="mt-5 flex flex-col gap-2.5 text-[15px] leading-snug">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            <span>{point}</span>
          </li>
        ))}
      </ul>

      <p className="mt-auto pt-8 text-5xl font-semibold tracking-[-0.04em] tabular-nums">
        {price}
        {Number(plan.price) !== 0 && (
          <span className={`ml-2 text-sm font-normal tracking-normal ${skin.muted}`}>{period}</span>
        )}
      </p>

      <button
        type="button"
        aria-disabled={disabled || busy}
        onClick={() => {
          if (disabled || busy) return;
          onChoose();
        }}
        className={`mt-5 flex h-12 w-full items-center justify-between gap-4 rounded-full px-5 text-sm font-medium transition-opacity duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 ${skin.button} ${disabled || busy ? 'opacity-40' : 'hover:opacity-90'}`}
      >
        <span>
          {busy ? copy.choosing : copy.choose}
          <span className="sr-only">: {plan.name}</span>
        </span>
        <MoveRight aria-hidden="true" className="h-4 w-16 shrink-0 transition-transform duration-300 ease-in-out motion-safe:group-hover:translate-x-1.5" strokeWidth={1.5} />
      </button>
    </li>
  );
}

/** The reference's three surfaces, in order: light, black, lime. Lime is the one lime element. */
export type PlanTone = 'light' | 'dark' | 'lime';
const PLAN_TONES: readonly PlanTone[] = ['light', 'dark', 'lime'];

const PLAN_SKIN: Record<
  PlanTone,
  { card: string; muted: string; tag: string; button: string; context: Record<string, string> }
> = {
  light: {
    card: 'bg-[var(--white-muted)] text-on-white',
    muted: 'text-on-white/48',
    tag: 'bg-on-white text-white',
    button: 'bg-on-white text-white focus-visible:outline-on-white',
    context: { 'data-on-white': '' },
  },
  dark: {
    card: 'border border-white/8 bg-black text-white',
    muted: 'text-white/40',
    tag: 'bg-white text-on-white',
    button: 'bg-white text-on-white focus-visible:outline-[var(--lime-500)]',
    context: {},
  },
  lime: {
    card: 'bg-lime-500 text-on-lime',
    muted: 'text-on-lime/56',
    tag: 'bg-on-lime text-lime-500',
    button: 'bg-on-lime text-lime-500 focus-visible:outline-on-lime',
    context: { 'data-on-lime': '' },
  },
};

export function planTone(index: number): PlanTone {
  return PLAN_TONES[index % PLAN_TONES.length] as PlanTone;
}

/* -------------------------------------------------------------------------
 * Failures
 * ---------------------------------------------------------------------- */

/**
 * A refusal as something to read.
 *
 * <p>Branches on `code` and never on prose, per §10.4 — the detail the service sends is in
 * one language and this page is drawn in four.
 */
function messageFor(cause: unknown, copy: PricingCopy): string {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    if (code === 'ALREADY_SUBSCRIBED') return copy.errors.alreadySubscribed;
    if (code === 'PLAN_NOT_ON_SALE') return copy.errors.notOnSale;
    if (cause.status === 401) return copy.errors.signedOut;
  }
  return copy.errors.generic;
}

/**
 * A refused plan payment as something to read (#451): by `code` and `reason`, never by prose.
 */
function paymentMessageFor(cause: unknown, copy: PricingCopy): string {
  if (!(cause instanceof ApiError)) return copy.errors.generic;
  const problem: Record<string, unknown> = { ...cause.problem };
  return copy.errors[planPaymentRefusalOf(cause.status, cause.problem?.code, problem.reason)];
}

/**
 * The renewal date, in the reader's language.
 *
 * <p>Through `dateTimeFormat` rather than `toLocaleDateString` since #401: Chromium claims
 * `az` and formats it from root-locale data, so this rendered `2026 M08 14` in the one
 * language the platform ships as its primary. `packages/messages/src/azerbaijani.ts` has the
 * argument.
 */
function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (iso == null) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  return dateTimeFormat(
    locale,
    { day: 'numeric', month: 'long', year: 'numeric' },
    'plan-renewal',
  ).format(when);
}
