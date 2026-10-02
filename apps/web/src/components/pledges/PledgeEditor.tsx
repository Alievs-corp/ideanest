'use client';

import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Checkbox,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '@ideanest/ui';
import { AddonChoice } from '../checkout/AddonChoice';
import { DestinationField } from '../checkout/DestinationField';
import { PledgeSummary } from '../checkout/PledgeSummary';
import { RewardChoice } from '../checkout/RewardChoice';
import { NO_REWARD } from '../checkout/useCheckout';
import {
  editPledge,
  getPublicRewards,
  raisePledge,
  type PledgeResponse,
  type PublicReward,
  type PublicRewardList,
} from '../../lib/pledges/api';
import { describeFailure, type CheckoutFailure } from '../../lib/pledges/failure';
import { IdempotencyKeyring } from '../../lib/pledges/idempotency';
import { leaveForPaymentPage, raiseReturnFor } from '../../lib/pledges/payment';
import {
  destinationOptions,
  quoteSelection,
  requiresDestination,
  toAmounts,
  type Selection,
} from '../../lib/pledges/quote';
import { formatMoney, parseAmount, toMoney, type AmountParse } from '../../lib/money';
import { type CheckoutCopy, fillPlaceholders } from '../../lib/i18n/checkout-copy';
import type { PledgeEditorCopy } from '../../lib/i18n/pledges-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatExactTime } from '../../lib/time';
import { contributionMessage, refusalMessage } from '../checkout/refusals';
import {
  changesFrom,
  draftOf,
  isEmptyEdit as isEmpty,
  raiseDifference,
  seedOf,
  type PledgeDraft,
} from '@ideanest/checkout/edit';
import { raiseInFlight } from '@ideanest/checkout/pledge';

export { changesFrom };
export type Draft = PledgeDraft;

/**
 * §4.5's PL-09 — the backer changes their mind while the campaign runs. Issue #287.
 *
 * <h2>It is checkout's controls over a pledge that already exists</h2>
 *
 * `RewardChoice`, `AddonChoice`, `DestinationField` and `PledgeSummary` are imported from
 * `components/checkout` rather than rewritten. All four are controlled — value in, change out
 * — with no dependency on `useCheckout`, which is what makes the reuse possible and is why
 * they were built that way. The alternative is a second reward list with its own sold-out
 * rule, its own destination union, and its own opinion about which line refuses a country;
 * two of those would eventually disagree, and the one that is wrong would be the one nobody
 * looks at.
 *
 * The preview arithmetic is `lib/pledges/quote.ts`, for the same reason: it mirrors
 * `PledgeQuote` on the service line for line, and a second copy here would be a figure the
 * backer reads before pressing a button that then charges a different one.
 *
 * <h2>THE PATCH IS A DIFF, AND THAT IS NOT AN OPTIMISATION</h2>
 *
 * `PATCH /v1/pledges/{id}` takes JSON Merge-Patch semantics: **absent keeps, null clears**.
 * `"rewardTierId": null` gives up the reward and makes the pledge support-only; leaving the
 * key out keeps the tier. So sending every field on every save — the correct behaviour for the
 * shipping-address form, which replaces an address whole — would here strip the reward off a
 * pledge whose backer only raised their contribution.
 *
 * `changesFrom` below builds the body from what actually differs, field by field. It is also
 * what makes the idempotency key mean something: the key is derived from a canonical
 * serialisation of the body, so "the same intent" is an objective fact about the request
 * rather than a label somebody has to remember to change (`lib/pledges/idempotency.ts`).
 *
 * <h2>The server's answer replaces the form's, whole</h2>
 *
 * `PATCH` returns the entire `PledgeResponse` and the caller adopts it rather than merging
 * fields into a local copy. On this endpoint the total is what somebody will be charged, and
 * the client is working from a reward list it fetched some seconds ago — a price, a rate or a
 * tier's availability may have moved since. The server quotes against the row it is writing,
 * inside the transaction that writes it.
 *
 * <h2>Raising a paid pledge is the same form, and saving means paying the difference — #171</h2>
 *
 * A `COLLECTED` pledge was charged when it was made, so PL-09's `PATCH` does not reach it. In
 * `mode="raise"` the same controls build the same Merge-Patch diff, and the button sends it to
 * `POST /v1/pledges/{id}/raise` with the difference this form previews as `expectedAmount`, then
 * leaves for the provider's page to pay it. The service refuses to charge any other figure
 * (`RAISE_AMOUNT_CHANGED`), so what the backer reads beside the button is what the provider asks
 * for. Nothing on the pledge changes until the provider says the difference was paid; the manager
 * reads the outcome off `latestRaise` when the backer comes back.
 *
 * Only an increase is offered. A selection that costs no more than the pledge does now leaves the
 * button disabled with a sentence saying why, and the anonymity box is not drawn, because a raise
 * changes what is bought and not who is shown.
 *
 * <h2>Motion: none, and this is the screen the rule was written for</h2>
 *
 * docs/motion-system.md §5 gives pledge and checkout "near zero — every animation here reads
 * as hesitation". Nothing enters, nothing fades; the controls take the kit's 150ms colour
 * change and the button changes its label while the request is in flight.
 */

export interface PledgeEditorProps {
  /**
   * The checkout's words, threaded through from the page.
   *
   * This screen reuses `RewardChoice`, `AddonChoice`, `DestinationField` and `PledgeSummary`
   * — the same controls the checkout draws, so they take the same copy. Sharing the object as
   * well as the components is what keeps "Sold out" from being two different sentences on two
   * screens that are visibly the same form.
   */
  readonly copy: CheckoutCopy;
  /** The editor's own words — #81. Its field, its hints and its refusals are the checkout's. */
  readonly pledges: PledgeEditorCopy;
  readonly pledge: PledgeResponse;
  /** Called with the whole pledge the service answered with. Never a merge. */
  readonly onSaved: (next: PledgeResponse) => void;
  /**
   * `edit` for a draft or a legacy confirmed pledge — PL-09's `PATCH`, which charges nothing — and
   * `raise` for a paid one, where saving opens the provider's page for the difference (#171).
   */
  readonly mode?: 'edit' | 'raise';
}

/** `setTimeout`'s ceiling. A hold is minutes long; this only stops a far date firing at once. */
const LONGEST_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The kit's small primary `Pill` (`@ideanest/ui`, docs/ui-kit.md §7.2), drawn on a link: the kit's
 * `Pill` is a `<button>`, and leaving for another page is a link's job.
 */
const PILL_LINK =
  'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-3.5 ' +
  'text-[13px] font-medium tracking-[-0.01em] text-on-white transition-[background-color,transform] ' +
  'duration-150 ease-in-out hover:-translate-y-px hover:bg-[var(--white-muted)] active:translate-y-0 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]';

export function PledgeEditor({ pledge, onSaved, copy, pledges, mode = 'edit' }: PledgeEditorProps) {
  const raising = mode === 'raise';
  const locale = useRouteLocale();
  const [catalogue, setCatalogue] = useState<PublicRewardList | null>(null);
  const [catalogueFailure, setCatalogueFailure] = useState<CheckoutFailure | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(pledge));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * One keyring for the life of this form. A key belongs to an intent rather than to an
   * attempt, so a save that is retried after a dropped connection carries the key that
   * produced the first attempt and is answered from the service's record of it — which is the
   * difference between one edit and two. It survives every re-render and none of the remounts
   * that mean somebody started over.
   */
  const keyring = useRef(new IdempotencyKeyring());

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const list = await getPublicRewards(pledge.projectId, {}, controller.signal);
        if (controller.signal.aborted) return;
        setCatalogue(list);
        setCatalogueFailure(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setCatalogueFailure(describeFailure(cause, copy.failures));
      }
    })();

    return () => controller.abort();
  }, [pledge.projectId]);

  /* The form is re-seeded whenever the server hands back a pledge that differs from the one it was
     seeded from, so what is on screen after a save is what the service stored rather than what was
     typed — and a read that only confirms what the form already shows leaves the backer's choices
     alone (`seedOf`). */
  const seeded = useRef(seedOf(pledge));
  useEffect(() => {
    const seed = seedOf(pledge);
    if (seed === seeded.current) return;
    seeded.current = seed;
    setDraft(draftOf(pledge));
  }, [pledge]);

  /*
   * #171: a raise leaves for the provider's page with `saving` still on, because the browser is
   * leaving. A backer who comes back with the browser's Back button may be shown this page from the
   * back-forward cache, frozen as it was — every control disabled and the button still saying it is
   * opening the page. `pageshow` with `persisted` is that restore, and the form is handed back.
   */
  useEffect(() => {
    function restored(event: PageTransitionEvent): void {
      if (event.persisted) setSaving(false);
    }
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  /*
   * A pending raise holds the button until its hold runs out, and nothing else would draw the page
   * again at that moment: one timer, set for the end of the hold, is what gives the button back.
   */
  const pendingHold =
    raising && pledge.latestRaise?.state === 'PENDING' ? pledge.latestRaise.holdExpiresAt : null;
  const [holdTick, setHoldTick] = useState(0);
  useEffect(() => {
    if (pendingHold === null) return;
    const remaining = Date.parse(pendingHold) - Date.now();
    if (!(remaining > 0)) return;
    /* Scheduled again from the tick, so a timer that fires a moment early is simply set again. */
    const timer = setTimeout(() => setHoldTick((tick) => tick + 1), Math.min(remaining, LONGEST_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [pendingHold, holdTick]);

  const parsed: AmountParse = useMemo(() => parseAmount(draft.contributionText), [draft.contributionText]);

  const reward: PublicReward | null = useMemo(() => {
    if (catalogue === null || draft.choice === NO_REWARD) return null;
    return catalogue.rewards.find((tier) => tier.id === draft.choice) ?? null;
  }, [catalogue, draft.choice]);

  const selection: Selection | null = useMemo(() => {
    if (catalogue === null || !parsed.ok) return null;

    return {
      currency: catalogue.currency,
      reward,
      addons: draft.addons
        .map((addon) => ({
          reward: catalogue.addons.find((tier) => tier.id === addon.rewardTierId) ?? null,
          quantity: addon.quantity,
        }))
        /* An add-on the campaign has since withdrawn is dropped from the preview rather than
           crashing it. The service is the authority on whether it may still be bought, and it
           answers `REWARD_NOT_FOUND` if it may not. */
        .filter((line): line is { reward: PublicReward; quantity: number } => line.reward !== null),
      contribution: parsed.value,
      destination: draft.destination,
    };
  }, [catalogue, draft.addons, draft.destination, parsed, reward]);

  const quote = useMemo(() => (selection === null ? null : quoteSelection(selection)), [selection]);

  const edit = useMemo(
    () => (parsed.ok ? changesFrom(pledge, draft, parsed.value) : {}),
    [draft, parsed, pledge],
  );

  /*
   * #171: what raising to this selection costs — the preview's total less what the pledge already
   * comes to. `decimal.js`, never a float: it is sent back as the figure the backer agreed to.
   */
  const difference: Decimal | null = useMemo(() => {
    if (!raising || quote === null || !quote.ok) return null;
    return raiseDifference(quote.quote.total, pledge);
  }, [raising, quote, pledge]);

  /* Nothing is due for a form that changes nothing, even where the preview's arithmetic and the
     pledge's stored figures have drifted apart: there is no raise to pay for. */
  const due = !isEmpty(edit) && difference !== null && difference.gt(0)
    ? formatMoney(toMoney(difference, pledge.amounts.total.currency))
    : null;
  const inFlight = raising && raiseInFlight(pledge, Date.now());
  /* Only while the raise holds: the service sends it for no other raise, and a page past its hold
     would take a payment the service no longer waits for. */
  const resumeUrl = inFlight ? pledge.latestRaise?.resumeUrl ?? null : null;

  /**
   * #171: asks for the provider's page for the difference, and goes there.
   *
   * The key is derived from the change and the figure together, so a retry of the same raise after
   * a dropped connection answers the page the first attempt opened, and a different figure is a
   * different intent. `saving` is left on after a successful answer: the browser is leaving.
   */
  async function raise(): Promise<void> {
    if (saving || isEmpty(edit) || difference === null || !difference.gt(0)) return;

    const intent = { ...edit, expectedAmount: toMoney(difference, pledge.amounts.total.currency) };
    setSaving(true);
    setFailure(null);
    setSaved(false);

    try {
      const opened = await raisePledge(
        pledge.id,
        { ...intent, ...raiseReturnFor(pledge.id) },
        keyring.current.keyFor(intent),
      );
      leaveForPaymentPage(opened.redirectUrl);
    } catch (cause) {
      const described = describeFailure(cause, copy.failures);
      if (described.retireKey) keyring.current.retire(intent);
      setFailure(described);
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (saving || isEmpty(edit)) return;

    setSaving(true);
    setFailure(null);
    setSaved(false);

    try {
      const next = await editPledge(pledge.id, edit, keyring.current.keyFor(edit));
      onSaved(next);
      setSaved(true);
    } catch (cause) {
      const described = describeFailure(cause, copy.failures);
      /* Only ever for the two cases `lib/pledges/idempotency.ts` names — a spent key, or a
         reservation that has gone. Retiring anywhere else turns a safe retry into a second
         write. */
      if (described.retireKey) keyring.current.retire(edit);
      setFailure(described);
    } finally {
      setSaving(false);
    }
  }

  if (catalogueFailure !== null) {
    return (
      <InlineAlert variant="danger" title={catalogueFailure.title}>
        <p>{catalogueFailure.detail}</p>
      </InlineAlert>
    );
  }

  if (catalogue === null) {
    return (
      <SkeletonGroup label={pledges.loadingRewards} className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="5rem" />
        ))}
      </SkeletonGroup>
    );
  }

  const needsDestination = selection !== null && requiresDestination(selection);
  const options = selection === null ? [] : destinationOptions(selection);

  /*
   * The checkout's own two functions, over the checkout's own vocabulary — #81.
   *
   * Both used to be English literals here, beside four controls imported from
   * `components/checkout` precisely so there would be one sold-out rule and one destination
   * union. `components/checkout/refusals.ts` is now the one home for the sentences those
   * controls refuse with; a second wording would be the one nobody looks at, on the screen a
   * backer reaches weeks after the checkout.
   */
  const contributionError =
    parsed.ok || draft.contributionText === ''
      ? null
      : contributionMessage(parsed.reason, null, copy);

  const quoteRefusal =
    quote !== null && !quote.ok ? refusalMessage(quote.refusal, copy) : null;

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">
        {raising ? pledges.raiseHeading : pledges.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">
        {raising ? pledges.raiseIntro : pledges.intro}
      </p>

      {inFlight && pledge.latestRaise != null && (
        <div className="mt-4">
          <InlineAlert variant="info" title={pledges.raiseHeading}>
            {/* The sentence promises a way back only when there is one: the service's page for this
                raise. Without it, the page the backer left may still be open, and that is all. */}
            <p>
              {fillPlaceholders(resumeUrl === null ? pledges.raisePending : pledges.raisePendingResumable, {
                time: formatExactTime(pledge.latestRaise.holdExpiresAt, locale),
              })}
            </p>
            {resumeUrl !== null && (
              <p className="mt-3">
                {/* A link, because it goes somewhere: the provider's page for the payment already
                    started. The service refuses a second raise while this one holds. */}
                <a href={resumeUrl} className={PILL_LINK}>
                  {pledges.raiseResume}
                </a>
              </p>
            )}
          </InlineAlert>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6">
        <RewardChoice
          copy={copy.reward}
          rewards={catalogue.rewards}
          value={draft.choice}
          onChange={(value) => setDraft((current) => ({ ...current, choice: value }))}
          disabled={saving}
        />

        <Field
          /* The checkout's field, because it is the checkout's field: same legend, same two
             hints, already written in four languages. */
          label={draft.choice === NO_REWARD ? copy.contribution.legendNoReward : copy.contribution.legend}
          required
          hint={
            reward === null
              ? copy.contribution.hint
              : fillPlaceholders(copy.contribution.rewardHint, {
                  amount: formatMoney(reward.price),
                })
          }
          error={contributionError}
        >
          <TextInput
            /* `inputMode` rather than `type="number"`, for the reason checkout gives: a number
               input accepts `1e5`, strips what it dislikes on paste, and hands back a value
               that has to be re-parsed anyway. `parseAmount` is the one reader of an amount. */
            inputMode="decimal"
            autoComplete="off"
            value={draft.contributionText}
            disabled={saving}
            onChange={(event) => {
              /* Read before the updater: React may run it after the event has been released,
                 when `currentTarget` is null — found by #131's first render test of this form. */
              const contributionText = event.currentTarget.value;
              setDraft((current) => ({ ...current, contributionText }));
            }}
            trailing={<span className="text-[13px]">{catalogue.currency}</span>}
          />
        </Field>

        <AddonChoice
          copy={copy.addons}
          addons={catalogue.addons}
          quantityOf={(rewardId) =>
            draft.addons.find((addon) => addon.rewardTierId === rewardId)?.quantity ?? 0
          }
          onChange={(rewardId, quantity) =>
            setDraft((current) => ({
              ...current,
              addons: [
                ...current.addons.filter((addon) => addon.rewardTierId !== rewardId),
                ...(quantity > 0 ? [{ rewardTierId: rewardId, quantity }] : []),
              ],
            }))
          }
          disabled={saving}
        />

        {needsDestination && (
          <DestinationField
            copy={copy.destination}
            options={options}
            value={draft.destination}
            onChange={(code) => setDraft((current) => ({ ...current, destination: code }))}
            disabled={saving}
          />
        )}

        {!raising && (
          <Checkbox
            checked={draft.isAnonymous}
            disabled={saving}
            onChange={(event) => {
              /* Read before the updater, for the contribution field's reason above. */
              const isAnonymous = event.currentTarget.checked;
              setDraft((current) => ({ ...current, isAnonymous }));
            }}
            label={copy.anonymous.label}
            /* PL-12 says what it does and does not overstate it: anonymous means hidden from the
               campaign's public backer list and from §4.2's public backed archive. The creator
               still sees who backed them — they have to, in order to post what was promised. */
            description={pledges.anonymousHint}
          />
        )}

        <PledgeSummary
          copy={copy.summary}
          amounts={quote !== null && quote.ok ? toAmounts(quote.quote) : pledge.amounts}
          /* `preview` while the form differs from the pledge, `quoted` when it does not: the
             panel says which it is showing, and a client's arithmetic must never be presented
             as the service's answer. */
          source={isEmpty(edit) ? 'quoted' : 'preview'}
          rewardTitle={reward?.title ?? null}
          destination={draft.destination}
          unavailable={quoteRefusal === null ? undefined : <p>{quoteRefusal}</p>}
        >
          {raising ? (
            <div className="flex flex-col gap-3">
              {due !== null && (
                <p className="text-[15px] font-medium tabular-nums text-on-white">
                  {fillPlaceholders(pledges.raiseDue, { amount: due })}
                </p>
              )}
              <Pill
                type="button"
                variant="accent"
                disabled={saving || inFlight || isEmpty(edit) || due === null || !parsed.ok}
                onClick={() => void raise()}
              >
                {saving
                  ? pledges.raiseOpening
                  : due === null
                    ? pledges.raiseHeading
                    : fillPlaceholders(pledges.raisePay, { amount: due })}
              </Pill>

              {isEmpty(edit) ? (
                <p className="text-sm text-on-white/64">{pledges.noChanges}</p>
              ) : (
                difference !== null &&
                !difference.gt(0) && (
                  <p className="text-sm text-on-white/64">{pledges.raiseNotHigher}</p>
                )
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Pill
                type="button"
                variant="accent"
                disabled={saving || isEmpty(edit) || !parsed.ok}
                onClick={() => void save()}
              >
                {saving ? pledges.saving : pledges.save}
              </Pill>

              {isEmpty(edit) && !saved && (
                <p className="text-sm text-on-white/64">{pledges.noChanges}</p>
              )}
            </div>
          )}
        </PledgeSummary>

        {saved && failure === null && (
          <InlineAlert variant="success" title={pledges.savedTitle}>
            <p>{pledges.savedBody}</p>
          </InlineAlert>
        )}

        {failure !== null && (
          <InlineAlert variant="danger" title={failure.title}>
            <p>{failure.detail}</p>
          </InlineAlert>
        )}
      </div>
    </section>
  );
}
