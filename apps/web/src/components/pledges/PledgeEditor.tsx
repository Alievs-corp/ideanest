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
  type PledgeAddon,
  type PledgeEdit,
  type PledgeResponse,
  type PublicReward,
  type PublicRewardList,
} from '../../lib/pledges/api';
import { describeFailure, type CheckoutFailure } from '../../lib/pledges/failure';
import { IdempotencyKeyring } from '../../lib/pledges/idempotency';
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
import { contributionMessage, refusalMessage } from '../checkout/refusals';

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
 * <h2>Motion: none, and this is the screen the rule was written for</h2>
 *
 * docs/motion-system.md §5 gives pledge and checkout "near zero — every animation here reads
 * as hesitation". Nothing enters, nothing fades; the controls take the kit's 150ms colour
 * change and the button changes its label while the request is in flight.
 */

/** The contribution the pledge currently records: its base plus PL-03's bonus. */
function contributionOf(pledge: PledgeResponse): Decimal {
  return new Decimal(pledge.amounts.base.amount).plus(pledge.amounts.bonus.amount);
}

/** Add-ons in a stable order, so two equal selections compare equal. */
function normaliseAddons(addons: readonly PledgeAddon[]): readonly PledgeAddon[] {
  return [...addons]
    .filter((addon) => addon.quantity > 0)
    .sort((left, right) => (left.rewardTierId < right.rewardTierId ? -1 : 1));
}

function sameAddons(left: readonly PledgeAddon[], right: readonly PledgeAddon[]): boolean {
  const a = normaliseAddons(left);
  const b = normaliseAddons(right);
  if (a.length !== b.length) return false;

  return a.every((addon, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      other.rewardTierId === addon.rewardTierId &&
      other.quantity === addon.quantity
    );
  });
}

export interface Draft {
  readonly choice: string;
  readonly contributionText: string;
  readonly addons: readonly PledgeAddon[];
  readonly destination: string | null;
  readonly isAnonymous: boolean;
}

function draftOf(pledge: PledgeResponse): Draft {
  return {
    choice: pledge.rewardTierId ?? NO_REWARD,
    // The wire value verbatim: it is already a decimal string of the right scale, and putting
    // it through a formatter on the way into a text field is how a group separator ends up in
    // the next request body (`lib/money.ts`).
    contributionText: contributionOf(pledge).toFixed(2),
    addons: pledge.addons,
    destination: pledge.shippingCountry ?? null,
    isAnonymous: pledge.isAnonymous,
  };
}

/**
 * The Merge-Patch body: only what differs from the pledge as the server last described it.
 *
 * An empty object is "nothing to save", and the button is disabled for it rather than sending
 * a patch that changes nothing — which would spend an idempotency key and re-quote a pledge
 * for no reason.
 */
export function changesFrom(pledge: PledgeResponse, draft: Draft, contribution: Decimal): PledgeEdit {
  const edit: PledgeEdit = {};
  const original = draftOf(pledge);

  if (draft.choice !== original.choice) {
    // `null` is the explicit clear that makes the pledge support-only (PL-02). It is a value
    // the body must carry, not a key it may omit.
    edit.rewardTierId = draft.choice === NO_REWARD ? null : draft.choice;
  }

  if (!sameAddons(draft.addons, original.addons)) {
    edit.addons = normaliseAddons(draft.addons);
  }

  if (!contribution.equals(contributionOf(pledge))) {
    edit.contribution = toMoney(contribution, pledge.amounts.total.currency);
  }

  if (draft.destination !== original.destination) {
    // An empty destination is sent as null, which clears it. The service reads a blank string
    // the same way, and sending null rather than '' means one spelling of "nowhere".
    edit.shippingCountry = draft.destination;
  }

  if (draft.isAnonymous !== original.isAnonymous) {
    edit.isAnonymous = draft.isAnonymous;
  }

  return edit;
}

/** Whether the body would change anything. */
function isEmpty(edit: PledgeEdit): boolean {
  return Object.keys(edit).length === 0;
}

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
}

export function PledgeEditor({ pledge, onSaved, copy, pledges }: PledgeEditorProps) {
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
        setCatalogueFailure(describeFailure(cause));
      }
    })();

    return () => controller.abort();
  }, [pledge.projectId]);

  /* The form is re-seeded whenever the server hands back a new pledge, so what is on screen
     after a save is what the service stored rather than what was typed. */
  useEffect(() => {
    setDraft(draftOf(pledge));
  }, [pledge]);

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
      const described = describeFailure(cause);
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
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{pledges.heading}</h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">
        {pledges.intro}
      </p>

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
            onChange={(event) =>
              setDraft((current) => ({ ...current, contributionText: event.currentTarget.value }))
            }
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

        <Checkbox
          checked={draft.isAnonymous}
          disabled={saving}
          onChange={(event) =>
            setDraft((current) => ({ ...current, isAnonymous: event.currentTarget.checked }))
          }
          label={copy.anonymous.label}
          /* PL-12 says what it does and does not overstate it: anonymous means hidden from the
             campaign's public backer list and from §4.2's public backed archive. The creator
             still sees who backed them — they have to, in order to post what was promised. */
          description={pledges.anonymousHint}
        />

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
