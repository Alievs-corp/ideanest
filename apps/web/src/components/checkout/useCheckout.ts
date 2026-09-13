'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAmount, toMoney, type AmountParse } from '../../lib/money';
import { describeFailure, type CheckoutFailure } from '../../lib/pledges/failure';
import { IdempotencyKeyring } from '../../lib/pledges/idempotency';
import {
  createPledgeDraft,
  payForPledge,
  getPublicRewards,
  isSoldOut,
  type DraftPledgeRequest,
  type PledgeResponse,
  type PublicReward,
  type PublicRewardList,
} from '../../lib/pledges/api';
import {
  quoteSelection,
  requiresDestination,
  type QuoteResult,
  type Selection,
} from '../../lib/pledges/quote';
import { leaveForPaymentPage, paymentReturnFor } from '../../lib/pledges/payment';

/**
 * The checkout, as one hook: what the backer chose, what it costs, and the two
 * requests that turn it into a pledge.
 *
 * <h2>The state lives here and not in the URL</h2>
 *
 * `DiscoveryView` puts every filter in the query string, because a filtered feed
 * is a thing to link to and to come back to. A checkout is the opposite on both
 * counts. A half-made pledge is not shareable — the link would carry another
 * person's selection to somebody who cannot pay for it — and the back button must
 * not be able to re-enter a reservation that has since expired or been confirmed.
 * So the selection is React state, and the steps are steps rather than routes.
 *
 * The route carries two query parameters and neither is a selection: PL-15's
 * `?token=`, and `?reward=`, which names a tier the campaign page already
 * printed. It seeds step one and reserves nothing — the effect beside
 * `chooseReward` sets out what happens when it names a tier that has gone.
 *
 * <h2>Two amounts, and only one of them is true</h2>
 *
 * `quote` is the client's preview, recomputed on every keystroke so the total
 * moves with the choice. `pledge.amounts` is the server's, and from the moment a
 * draft comes back it is the only thing shown. See `lib/pledges/quote.ts` for why
 * that is not politeness about layering: the client is pricing from a list it
 * fetched some seconds ago, and the server prices the row it is reserving inside
 * the transaction that reserves it.
 *
 * <h2>Idempotency</h2>
 *
 * One `IdempotencyKeyring` per checkout, held in a ref so it survives every
 * re-render and none of the remounts that mean somebody started over. Keys are
 * issued per request body, so pressing "Reserve" twice after a dropped connection
 * sends the same key and gets the same pledge back. `lib/pledges/idempotency.ts`
 * carries the full argument, including the one case where a key must be retired:
 * a reservation that expired is a new intent, not a retry, and replaying its key
 * would hand back the draft that just expired.
 *
 * <h2>The one refusal this hook answers by itself</h2>
 *
 * `IDEMPOTENT_REQUEST_IN_PROGRESS` is what a double-click produces: the first
 * request still holds the claim on the key, and the second is told to ask again
 * in a moment. It is not a state a backer can do anything about — their pledge
 * is being made, exactly once, by the attempt that got there first — so it is
 * waited out here rather than shown. `attemptWithRetry` below does the waiting,
 * with the SAME key — which is what the keyring makes possible: the key belongs
 * to the intent, the intent has not changed, and nothing is retired between
 * tries.
 */

/** The value the "no reward" radio carries. A tier id is a UUID and cannot collide. */
export const NO_REWARD = 'none';

/**
 * How long to wait when the service asked us to wait but did not say how long.
 *
 * One second, which is what the service's own `Retry-After` carries: the work
 * being waited on is a database transaction.
 */
const DEFAULT_RETRY_AFTER_MS = 1000;

/**
 * The longest single wait, however long the service asked for.
 *
 * A `Retry-After` of a minute would leave a backer looking at "Reserving…" with
 * nothing happening, and somebody looking at that reloads the page — which is
 * the one thing that loses the in-memory key and turns a safe replay into a
 * second request. Trying sooner than asked costs at worst one more refusal, and
 * the number of those is bounded on the line below.
 */
const MAX_RETRY_AFTER_MS = 5000;

/**
 * How many times a request is re-sent after `IDEMPOTENT_REQUEST_IN_PROGRESS`.
 *
 * BOUNDED, and this is the point of the constant. The refusal says "the first
 * attempt is still running", so a client that retried on a loop would keep
 * asking for as long as the first attempt is stuck — which is precisely when
 * asking is least useful. After this many the failure is shown, with the button
 * that sends it again if the backer wants to.
 */
const IN_PROGRESS_RETRY_LIMIT = 3;

/** Either what the request returned, or what refused it. */
type Attempted<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CheckoutFailure };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a request, waiting out the refusal that means it is already running.
 *
 * `run` is called again rather than its promise retained, and it reads the key
 * from the keyring each time — which returns the same key, because the intent is
 * the same and nothing retires it here. That is the whole guarantee: a retry
 * under a fresh key would be a second pledge.
 */
async function attemptWithRetry<T>(run: () => Promise<T>): Promise<Attempted<T>> {
  for (let retries = 0; ; retries += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (cause) {
      const failure = describeFailure(cause);
      if (failure.recovery !== 'wait-and-retry' || retries >= IN_PROGRESS_RETRY_LIMIT) {
        return { ok: false, failure };
      }

      await wait(Math.min(failure.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS));
    }
  }
}

export type CatalogueStatus = 'loading' | 'ready' | 'failed';

/**
 * Where the backer is.
 *
 * `selecting` covers "choosing" and "a reservation was refused", because they are
 * the same screen with a message on it. `reserved` is the only state in which
 * stock is held and the clock is running.
 */
/**
 * Where the checkout has got to.
 *
 * IDN-EXT-01 (#44) replaced `confirming` and `confirmed`: the review step now asks the service
 * for the payment provider's page (`paying`) and sends the browser there (`redirecting`). There
 * is no "confirmed" on this screen any more, because nothing is settled here — the provider's
 * webhook settles the pledge, and the pledge page the provider returns to reads the outcome.
 */
export type CheckoutPhase = 'selecting' | 'reserving' | 'reserved' | 'paying' | 'redirecting';

export interface CheckoutState {
  readonly catalogueStatus: CatalogueStatus;
  readonly catalogue: PublicRewardList | null;
  readonly catalogueFailure: CheckoutFailure | null;
  readonly reloadCatalogue: () => void;

  readonly phase: CheckoutPhase;
  readonly pledge: PledgeResponse | null;
  readonly failure: CheckoutFailure | null;

  /** The chosen tier id, `NO_REWARD`, or null when nothing is chosen yet. */
  readonly choice: string | null;
  readonly reward: PublicReward | null;
  readonly chooseReward: (value: string) => void;

  readonly contributionText: string;
  readonly setContributionText: (value: string) => void;
  /** How `parseAmount` read the field. The wording is the field's own business. */
  readonly contribution: AmountParse;
  /** True once the field is worth complaining about — touched, or reserve pressed. */
  readonly contributionShown: boolean;
  /**
   * True once "reserve" has been pressed at least once.
   *
   * What turns "you have not chosen yet" from silence into a sentence. A form
   * that complains about an empty field before it has been asked to do anything
   * is a form that is arguing with somebody who has only just arrived.
   */
  readonly attempted: boolean;

  readonly addonQuantity: (rewardId: string) => number;
  readonly setAddonQuantity: (rewardId: string, quantity: number) => void;

  readonly needsDestination: boolean;
  readonly destination: string | null;
  readonly setDestination: (code: string | null) => void;

  readonly isAnonymous: boolean;
  readonly setAnonymous: (value: boolean) => void;

  readonly selection: Selection | null;
  /** The client's preview, or null before anything has been chosen. */
  readonly quote: QuoteResult | null;

  /** Reserve stock and quote. `fresh` retires the key first — see the file comment. */
  readonly reserve: (options?: { readonly fresh?: boolean }) => void;
  /** Opens the payment provider's page for the reserved pledge and leaves for it. */
  readonly pay: () => void;
  /**
   * Send the request that failed again, whichever it was.
   *
   * The interface offers one "try again" and the two mutations are two
   * different requests: a confirmation that was refused is not retried by
   * reserving. Both are safe to repeat — that is what the key is for — but
   * repeating the wrong one leaves the backer on a screen that has not moved.
   */
  readonly retry: () => void;
  /** Back to the form with the reservation abandoned, so it can be made again. */
  readonly startOver: () => void;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export function useCheckout(
  projectId: string,
  secretTokens: readonly string[] = [],
  initialRewardId: string | null = null,
  /**
   * The version of the backer agreement the page resolved on the server, or null when none
   * is published — #427.
   *
   * <p>A parameter rather than a fetch of this hook's own. The version is the same for every
   * reader, it is behind an hour of shared cache on the server, and §22.3 wants the
   * statement rendered with the page rather than arriving after it: a risk sentence that
   * appeared a moment after the confirm button did would be one somebody had already
   * scrolled past.
   */
  backerAgreementVersion: number | null = null,
): CheckoutState {
  const [catalogue, setCatalogue] = useState<PublicRewardList | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueStatus>('loading');
  const [catalogueFailure, setCatalogueFailure] = useState<CheckoutFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [phase, setPhase] = useState<CheckoutPhase>('selecting');
  const [pledge, setPledge] = useState<PledgeResponse | null>(null);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);

  const [choice, setChoice] = useState<string | null>(null);
  const [contributionText, setContributionText] = useState('');
  const [contributionTouched, setContributionTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>({});
  const [destination, setDestinationState] = useState<string | null>(null);
  const [isAnonymous, setAnonymous] = useState(false);

  /*
   * One keyring for the life of this checkout. A `useRef` rather than state
   * because reading it must never re-render, and because its contents are not
   * something the interface displays — they are the client's memory of what it
   * has already asked for.
   */
  const keyring = useRef(new IdempotencyKeyring());

  /*
   * Which mutation was last sent, so that "try again" sends that one. A ref
   * rather than state: nothing on the screen depends on it, and re-rendering
   * when a request starts would be a render nobody asked for.
   */
  const lastMutation = useRef<'reserve' | 'pay'>('reserve');

  /*
   * The secret tokens, serialised, so the effect below depends on their VALUE
   * rather than on the identity of the array. A route that rebuilds the array on
   * every render — which is what reading a query string does — would otherwise
   * refetch the reward list on every keystroke anywhere on the page. The same
   * reasoning `useDiscoveryFeed` gives for keying on `filterKey`.
   */
  const tokenKey = JSON.stringify(secretTokens);
  const latestTokens = useRef(secretTokens);
  latestTokens.current = secretTokens;

  useEffect(() => {
    const controller = new AbortController();

    setCatalogueStatus('loading');
    setCatalogueFailure(null);

    void (async () => {
      try {
        const list = await getPublicRewards(
          projectId,
          { tokens: latestTokens.current },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        setCatalogue(list);
        setCatalogueStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        setCatalogueFailure(describeFailure(cause));
        setCatalogueStatus('failed');
      }
    })();

    return () => controller.abort();
  }, [projectId, tokenKey, attempt]);

  const currency = catalogue?.currency ?? '';
  const rewards = catalogue?.rewards ?? [];
  const addons = catalogue?.addons ?? [];

  const reward = useMemo(
    () => (choice === null || choice === NO_REWARD ? null : (rewards.find((r) => r.id === choice) ?? null)),
    [choice, rewards],
  );

  const chooseReward = useCallback(
    (value: string) => {
      setChoice(value);
      setFailure(null);

      /*
       * The contribution field starts at the tier's price (PL-03: a bonus is an
       * amount ABOVE it) and is reset whenever the tier changes. Carrying the
       * old figure across would either be below the new tier's price — which the
       * service refuses — or would silently turn a deliberate 45.00 into a
       * bonus on a 20.00 tier that the backer never agreed to.
       */
      const picked = value === NO_REWARD ? null : rewards.find((r) => r.id === value);
      setContributionText(picked?.price.amount ?? '');
      setContributionTouched(false);
    },
    [rewards],
  );

  /*
   * `?reward=` — THE TIER THE CAMPAIGN PAGE'S CONTROL NAMED, APPLIED ONCE.
   *
   * A reader who pressed "Select this reward" beside a tier has already made the choice this
   * screen opens by asking for. Landing them on an empty radio group asks it again, and the
   * one they answered is the one they then have to find in a list of eight.
   *
   * <p>It goes through `chooseReward` rather than `setChoice`, so the contribution field
   * starts at the tier's price exactly as it does for a click. Setting the choice alone would
   * seed a selection the service refuses with `CONTRIBUTION_BELOW_REWARD_PRICE`.
   *
   * <p><strong>Once, whatever happens.</strong> The ref is set before the tier is looked up,
   * so an identifier that names nothing — a tier withdrawn since the link was shared, or one
   * that sold out between the campaign page and this one — costs the preselection and nothing
   * else: the reader gets the ordinary empty form rather than a refusal about a tier they
   * never saw. It also means `startOver` clears the seeded choice like any other, instead of
   * having it reappear underneath the reader.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || initialRewardId === null || catalogue === null) return;
    seeded.current = true;

    const picked = catalogue.rewards.find((tier) => tier.id === initialRewardId);
    if (picked === undefined || isSoldOut(picked)) return;

    chooseReward(picked.id);
  }, [catalogue, initialRewardId, chooseReward]);

  const setContribution = useCallback((value: string) => {
    setContributionText(value);
    setContributionTouched(true);
    setFailure(null);
  }, []);

  const addonQuantity = useCallback((rewardId: string) => quantities[rewardId] ?? 0, [quantities]);

  const setAddonQuantity = useCallback((rewardId: string, quantity: number) => {
    setQuantities((previous) => ({ ...previous, [rewardId]: Math.max(0, Math.trunc(quantity)) }));
    setFailure(null);
  }, []);

  const setDestination = useCallback((code: string | null) => {
    setDestinationState(code);
    setFailure(null);
  }, []);

  const contribution = useMemo(() => parseAmount(contributionText), [contributionText]);

  const selection = useMemo<Selection | null>(() => {
    if (catalogue === null || choice === null) return null;
    if (!contribution.ok) return null;

    return {
      currency,
      reward,
      addons: addons
        .map((addon) => ({ reward: addon, quantity: quantities[addon.id] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
      contribution: contribution.value,
      destination,
    };
  }, [catalogue, choice, contribution, currency, reward, addons, quantities, destination]);

  const quote = useMemo(() => (selection === null ? null : quoteSelection(selection)), [selection]);

  /*
   * Whether to ask where it is going, computed from the selection as it stands
   * rather than from the reward alone — an add-on that is posted makes the
   * question necessary even when the tier is a download (PL-05).
   */
  const needsDestination = useMemo(() => {
    if (catalogue === null || choice === null) return false;
    return requiresDestination({
      currency,
      reward,
      addons: addons
        .map((addon) => ({ reward: addon, quantity: quantities[addon.id] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
      // Only the shipping types are read by `requiresDestination`; the amount
      // and the destination do not enter into it, so a zero here is not a claim
      // about what the backer is giving.
      contribution: new Decimal(0),
      destination,
    });
  }, [catalogue, choice, currency, reward, addons, quantities, destination]);

  /**
   * The body of `POST /v1/pledges/draft`, or null when the selection cannot make
   * one.
   *
   * The add-ons are SORTED BY ID. The body is what the idempotency key is derived
   * from, and two requests that would create the same pledge have to produce the
   * same key — a list whose order followed the order the backer happened to tick
   * boxes in would mint a second key for the same intent, which is the duplicate
   * this whole mechanism exists to prevent.
   */
  const draftBody = useMemo<DraftPledgeRequest | null>(() => {
    if (selection === null || quote === null || !quote.ok) return null;

    return {
      projectId,
      rewardTierId: reward?.id ?? null,
      addons: selection.addons
        .map((addon) => ({ rewardTierId: addon.reward.id, quantity: addon.quantity }))
        .sort((left, right) => (left.rewardTierId < right.rewardTierId ? -1 : 1)),
      contribution: toMoney(selection.contribution, currency),
      // Null rather than a country nobody asked for: sending a destination for a
      // pledge that posts nothing would record an address the campaign has no
      // reason to hold (§17.4).
      shippingCountry: needsDestination ? destination : null,
      isAnonymous,
      // #62's attribution. Nothing on this route carries one yet, and null is
      // the honest value rather than an empty string the service would store.
      referrerCode: null,
    };
  }, [selection, quote, projectId, reward, currency, needsDestination, destination, isAnonymous]);

  const reserve = useCallback(
    (options?: { readonly fresh?: boolean }) => {
      setAttempted(true);
      const body = draftBody;
      if (body === null) return;

      lastMutation.current = 'reserve';

      if (options?.fresh === true) {
        // A new reservation after an expiry is a NEW intent that happens to look
        // exactly like the old one. Without this, the replayed key would answer
        // with the very draft that expired and the screen would loop.
        keyring.current.retire(body);
      }

      setPhase('reserving');
      setFailure(null);

      void (async () => {
        const outcome = await attemptWithRetry(() =>
          createPledgeDraft(body, keyring.current.keyFor(body)),
        );

        if (outcome.ok) {
          setPledge(outcome.value);
          setPhase('reserved');
          return;
        }

        if (outcome.failure.retireKey) keyring.current.retire(body);

        setFailure(outcome.failure);
        setPhase('selecting');
      })();
    },
    [draftBody],
  );

  const pay = useCallback(() => {
    const current = pledge;
    const body = draftBody;
    if (current === null) return;

    lastMutation.current = 'pay';

    /*
     * §22.3's acknowledgement — #427. The payment endpoint makes confirmation's refusals and
     * records the agreement in its place (#39), so the version this page showed travels with
     * the request exactly as it did with confirmation, and a stale page is still refused with
     * AGREEMENT_REQUIRED.
     */
    const acknowledgedAgreementVersion = backerAgreementVersion;

    /*
     * The intent is the pledge AND the acknowledgement, as confirmation's was. A retry of the
     * same intent reuses its key, so a double click or a lost response opens one payment page
     * and records one PENDING charge rather than two.
     */
    const intent = { pledgeId: current.id, pay: true, acknowledgedAgreementVersion };

    setPhase('paying');
    setFailure(null);

    void (async () => {
      const outcome = await attemptWithRetry(() =>
        payForPledge(
          current.id,
          { acknowledgedAgreementVersion, ...paymentReturnFor(current.id) },
          keyring.current.keyFor(intent),
        ),
      );

      if (outcome.ok) {
        /*
         * Leaving, not done. The pledge is still DRAFT and stays so until the provider's
         * webhook settles it; the page the provider returns to reads that. The phase exists so
         * the control cannot be pressed again while the browser is on its way.
         */
        setPhase('redirecting');
        leaveForPaymentPage(outcome.value.redirectUrl);
        return;
      }

      const described = outcome.failure;
      if (described.retireKey) keyring.current.retire(intent);

      if (described.recovery === 'redraft') {
        // The reservation is gone, so the draft it belonged to is gone with
        // it. Both keys are retired: the payment's above, and the draft's here,
        // so that reserving again asks for a new pledge rather than replaying
        // the expired one. `PLEDGE_MODIFIED` arrives here too: whatever wrote to
        // the pledge, this client's copy of it is stale and the honest move is
        // to start the reservation again rather than to pay from memory.
        if (body !== null) keyring.current.retire(body);
        setPledge(null);
        setPhase('selecting');
      } else {
        setPhase('reserved');
      }

      setFailure(described);
    })();
  }, [pledge, draftBody, backerAgreementVersion]);

  /**
   * The failed request again — the one that failed, and not the other one.
   *
   * "Try again" is one button and there are two mutations behind it. Both are
   * safe to repeat, because both carry their key, but reserving in answer to a
   * refused confirmation leaves the backer looking at a screen that has not
   * moved and a pledge that is still unconfirmed.
   */
  const retry = useCallback(() => {
    if (lastMutation.current === 'pay') pay();
    else reserve();
  }, [pay, reserve]);

  /**
   * Back to the form, with the reservation left where it is.
   *
   * THE KEY IS NOT RETIRED HERE, and that is the difference between this and the
   * expiry path. The reservation is still running: a backer who goes back, looks
   * at the tiers, changes nothing and presses reserve again should get the SAME
   * pledge with the SAME clock, which is exactly what replaying the key does. Had
   * the key been retired they would get a second draft holding a second lot of
   * stock, on a campaign whose unique index allows them one.
   *
   * A backer who does change something produces a different body and therefore a
   * different key, which is the correct answer to a different question. The draft
   * they abandoned holds its stock until its five minutes run out; releasing it
   * sooner is `DELETE /v1/pledges/{id}`, which belongs to #56.
   */
  const startOver = useCallback(() => {
    setPledge(null);
    setFailure(null);
    setPhase('selecting');
  }, []);

  return {
    catalogueStatus,
    catalogue,
    catalogueFailure,
    reloadCatalogue: useCallback(() => setAttempt((n) => n + 1), []),

    phase,
    pledge,
    failure,

    choice,
    reward,
    chooseReward,

    contributionText,
    setContributionText: setContribution,
    contribution,
    contributionShown: contributionTouched || attempted || contributionText !== '',
    attempted,

    addonQuantity,
    setAddonQuantity,

    needsDestination,
    destination,
    setDestination,

    isAnonymous,
    setAnonymous,

    selection,
    quote,

    reserve,
    pay,
    retry,
    startOver,
  };
}
