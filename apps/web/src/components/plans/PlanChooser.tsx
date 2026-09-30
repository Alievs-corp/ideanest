'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { InlineAlert, Pill } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  cancelSubscription,
  formatPrice,
  readMySubscription,
  subscribeToPlan,
  type HeldSubscription,
  type Plan,
} from '../../lib/plans/api';
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
 * A priced plan comes back `PENDING_PAYMENT` with `entitled: false`, because nothing on this
 * platform can charge a card yet. The panel says what happens next rather than congratulating
 * somebody on a purchase the platform has not seen the money for. A free plan comes back
 * active. Both are the same code path; the panel branches on what the service answered.
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
  const [error, setError] = useState<string | null>(null);

  const announcement = useRef<HTMLDivElement>(null);

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
   * Nothing on this platform can charge a card yet, so a priced plan is activated by a member
   * of staff who has seen the money — minutes or days after the creator chose it, and with no
   * signal to this tab. Without this the creator sits on a page that still says "we are
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
        />
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-white/64">{copy.empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
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
}

function HeldPanel({ held, copy, locale, cancelling, onCancel }: HeldPanelProps) {
  const pending = held.state === 'PENDING_PAYMENT';

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
        variant={pending ? 'warning' : held.entitled ? 'success' : 'info'}
        title={describeHeld(held, copy, locale)}
        className="mt-3"
      >
        {pending && <p>{copy.held.pendingBody}</p>}
      </InlineAlert>

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
  if (held.cancelAtPeriodEnd) return fillPlaceholders(copy.held.endingOn, { plan, date });
  return fillPlaceholders(copy.held.activeUntil, { plan, date });
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
}

function PlanCard({ plan, copy, locale, current, busy, disabled, onChoose }: PlanCardProps) {
  const price =
    Number(plan.price) === 0 ? copy.free : formatPrice(plan.price, plan.currency, locale);
  const period = plan.billingPeriod === 'YEARLY' ? copy.perYear : copy.perMonth;

  return (
    <li className="flex flex-col rounded-2xl border border-white/8 bg-surface-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-medium text-white">{plan.name}</h3>
        {current && (
          <span className="rounded-full bg-surface-4 px-2 py-0.5 text-[12px] text-white">
            {copy.held.currentTag}
          </span>
        )}
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white">
        {price}
        {Number(plan.price) !== 0 && (
          <span className="ml-1 text-[13px] font-normal text-white/64">{period}</span>
        )}
      </p>

      {plan.description != null && <p className="mt-2 text-sm text-white/64">{plan.description}</p>}

      {/*
        The limits are the product. A card that showed only a price would leave a creator
        choosing between three numbers with nothing to weigh them against -- and the whole
        reason a plan costs what it costs is on these two lines.
      */}
      <ul className="mt-4 flex flex-col gap-2 text-sm text-white/80">
        <Limit
          text={
            plan.maxActiveCampaigns == null
              ? copy.limits.campaignsUnlimited
              : fillPlaceholders(copy.limits.campaigns, { count: String(plan.maxActiveCampaigns) })
          }
        />
        <Limit
          text={
            plan.goalCeiling == null
              ? copy.limits.goalUnlimited
              : fillPlaceholders(copy.limits.goalCeiling, {
                  amount: formatPrice(plan.goalCeiling, plan.currency, locale),
                })
          }
        />
      </ul>

      <div className="mt-5">
        <Pill
          variant={current ? 'ghost' : 'accent'}
          size="md"
          aria-disabled={disabled || busy}
          className={disabled || busy ? 'opacity-40' : undefined}
          onClick={() => {
            if (disabled || busy) return;
            onChoose();
          }}
        >
          {busy ? copy.choosing : copy.choose}
          {/* Named, because three identical "Choose" buttons are three indistinguishable
              links in a screen reader's list. */}
          <span className="sr-only">: {plan.name}</span>
        </Pill>
      </div>
    </li>
  );
}

function Limit({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
      <span>{text}</span>
    </li>
  );
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
