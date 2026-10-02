import Decimal from 'decimal.js';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAmount, type AmountParse } from '@ideanest/money';
import { attemptWithRetry } from '@ideanest/checkout/attempt';
import { NO_REWARD, draftBodyFor, paymentIntentFor } from '@ideanest/checkout/draft';
import { describeFailure, type CheckoutFailure, type PledgeFailureCopy } from '@ideanest/checkout/failure';
import { IdempotencyKeyring } from '@ideanest/checkout/idempotency';
import {
  quoteSelection,
  requiresDestination,
  type QuoteResult,
  type Selection,
} from '@ideanest/checkout/quote';
import {
  isSoldOut,
  type DraftPledgeRequest,
  type PledgeResponse,
  type PublicReward,
  type PublicRewardList,
} from '@ideanest/checkout/types';
import { queryKeys } from '../../api/queries';
import { createPledgeDraft, getCheckoutRewards, getPledge, payForPledge } from './api';
import { openPaymentPage, paymentReturnFor, type PaymentReturnHint } from './payment';

export { NO_REWARD };

export type CatalogueStatus = 'loading' | 'ready' | 'failed';
export type CheckoutPhase = 'selecting' | 'reserving' | 'reserved' | 'paying' | 'redirecting';

export interface CheckoutOptions {
  readonly projectId: string;
  readonly tokens: readonly string[];
  readonly initialRewardId: string | null;
  readonly agreementVersion: number | null;
  readonly failures: PledgeFailureCopy;
  readonly language: string;
  readonly online: boolean;
  readonly onPaid: (pledgeId: string, hint: PaymentReturnHint) => void;
  readonly onAgreementRequired: () => void;
  readonly mintKey?: () => string;
}

export interface CheckoutState {
  readonly catalogueStatus: CatalogueStatus;
  readonly catalogue: PublicRewardList | null;
  readonly catalogueFailure: CheckoutFailure | null;
  readonly reloadCatalogue: () => void;
  readonly phase: CheckoutPhase;
  readonly pledge: PledgeResponse | null;
  readonly heldUntil: string | null;
  readonly failure: CheckoutFailure | null;
  readonly agreementStale: boolean;
  readonly choice: string | null;
  readonly reward: PublicReward | null;
  readonly chooseReward: (value: string) => void;
  readonly contributionText: string;
  readonly setContributionText: (value: string) => void;
  readonly contribution: AmountParse;
  readonly contributionShown: boolean;
  readonly attempted: boolean;
  readonly addonQuantity: (rewardId: string) => number;
  readonly setAddonQuantity: (rewardId: string, quantity: number) => void;
  readonly needsDestination: boolean;
  readonly destination: string | null;
  readonly setDestination: (code: string | null) => void;
  readonly isAnonymous: boolean;
  readonly setAnonymous: (value: boolean) => void;
  readonly selection: Selection | null;
  readonly quote: QuoteResult | null;
  readonly reserve: (options?: { readonly fresh?: boolean }) => void;
  readonly pay: () => void;
  readonly retry: () => void;
  readonly startOver: () => void;
}

export function useCheckout(options: CheckoutOptions): CheckoutState {
  const { projectId, tokens, initialRewardId, agreementVersion, failures } = options;
  const latest = useRef(options);
  latest.current = options;

  const rewards = useQuery({
    queryKey: queryKeys.checkoutRewards(projectId, tokens),
    queryFn: ({ signal }) => getCheckoutRewards(projectId, tokens, signal),
  });
  const catalogue = rewards.data ?? null;
  const catalogueStatus: CatalogueStatus =
    catalogue !== null ? 'ready' : rewards.isError ? 'failed' : 'loading';
  const catalogueFailure = useMemo(
    () => (rewards.isError && catalogue === null ? describeFailure(rewards.error, failures) : null),
    [rewards.isError, rewards.error, catalogue, failures],
  );
  const { refetch } = rewards;
  const reloadCatalogue = useCallback(() => void refetch(), [refetch]);

  const [phase, setPhase] = useState<CheckoutPhase>('selecting');
  const [pledge, setPledge] = useState<PledgeResponse | null>(null);
  const [heldUntil, setHeldUntil] = useState<string | null>(null);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const [agreementStale, setAgreementStale] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [contributionText, setContributionTextState] = useState('');
  const [contributionTouched, setContributionTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>({});
  const [destination, setDestinationState] = useState<string | null>(null);
  const [isAnonymous, setAnonymous] = useState(false);

  const keyring = useRef<IdempotencyKeyring | null>(null);
  keyring.current ??= new IdempotencyKeyring(options.mintKey ?? Crypto.randomUUID);
  const keys = keyring.current;
  const lastMutation = useRef<'reserve' | 'pay'>('reserve');
  const inFlight = useRef(false);
  const reservedBody = useRef<DraftPledgeRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const currency = catalogue?.currency ?? '';
  const tiers = useMemo(() => catalogue?.rewards ?? [], [catalogue]);
  const addons = useMemo(() => catalogue?.addons ?? [], [catalogue]);

  const reward = useMemo(
    () => (choice === null || choice === NO_REWARD ? null : (tiers.find((r) => r.id === choice) ?? null)),
    [choice, tiers],
  );

  const chooseReward = useCallback(
    (value: string) => {
      setChoice(value);
      setFailure(null);
      const picked = value === NO_REWARD ? null : tiers.find((r) => r.id === value);
      setContributionTextState(picked?.price.amount ?? '');
      setContributionTouched(false);
    },
    [tiers],
  );

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || initialRewardId === null || catalogue === null) return;
    seeded.current = true;
    const picked = catalogue.rewards.find((tier) => tier.id === initialRewardId);
    if (picked === undefined || isSoldOut(picked)) return;
    chooseReward(picked.id);
  }, [catalogue, initialRewardId, chooseReward]);

  const setContributionText = useCallback((value: string) => {
    setContributionTextState(value);
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

  const chosenAddons = useMemo(
    () =>
      addons
        .map((addon) => ({ reward: addon, quantity: quantities[addon.id] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
    [addons, quantities],
  );

  const selection = useMemo<Selection | null>(() => {
    if (catalogue === null || choice === null || !contribution.ok) return null;
    return { currency, reward, addons: chosenAddons, contribution: contribution.value, destination };
  }, [catalogue, choice, contribution, currency, reward, chosenAddons, destination]);

  const quote = useMemo(() => (selection === null ? null : quoteSelection(selection)), [selection]);

  const needsDestination = useMemo(() => {
    if (catalogue === null || choice === null) return false;
    return requiresDestination({
      currency,
      reward,
      addons: chosenAddons,
      contribution: new Decimal(0),
      destination,
    });
  }, [catalogue, choice, currency, reward, chosenAddons, destination]);

  const draftBody = useMemo<DraftPledgeRequest | null>(() => {
    if (selection === null || quote === null || !quote.ok) return null;
    return draftBodyFor(projectId, selection, needsDestination, isAnonymous);
  }, [selection, quote, projectId, needsDestination, isAnonymous]);

  const reserve = useCallback(
    (reserveOptions?: { readonly fresh?: boolean }) => {
      setAttempted(true);
      const body = draftBody;
      if (body === null || !latest.current.online || inFlight.current) return;
      inFlight.current = true;
      lastMutation.current = 'reserve';
      if (reserveOptions?.fresh === true) keys.retire(body);
      setPhase('reserving');
      setFailure(null);
      void (async () => {
        const outcome = await attemptWithRetry(
          () => createPledgeDraft(body, keys.keyFor(body)),
          latest.current.failures,
        );
        inFlight.current = false;
        if (!mounted.current) return;
        if (outcome.ok) {
          reservedBody.current = body;
          setPledge(outcome.value);
          setHeldUntil(outcome.value.reservationExpiresAt ?? null);
          setPhase('reserved');
          return;
        }
        if (outcome.failure.retireKey) keys.retire(body);
        if (outcome.failure.recovery === 'redraft') setHeldUntil(null);
        setFailure(outcome.failure);
        setPhase('selecting');
      })();
    },
    [draftBody, keys],
  );

  const pay = useCallback(() => {
    const current = pledge;
    if (current === null || !latest.current.online || inFlight.current) return;
    inFlight.current = true;
    lastMutation.current = 'pay';
    const acknowledgedAgreementVersion = latest.current.agreementVersion;
    const intent = paymentIntentFor(current.id, acknowledgedAgreementVersion);
    setPhase('paying');
    setFailure(null);
    setAgreementStale(false);
    void (async () => {
      const outcome = await attemptWithRetry(
        () =>
          payForPledge(
            current.id,
            { acknowledgedAgreementVersion, ...paymentReturnFor(current.id, latest.current.language) },
            keys.keyFor(intent),
          ),
        latest.current.failures,
      );
      if (!mounted.current) {
        inFlight.current = false;
        return;
      }
      if (outcome.ok) {
        setPhase('redirecting');
        try {
          const session = await openPaymentPage(outcome.value.redirectUrl, current.id);
          if (!mounted.current) return;
          if (session.kind === 'returned') {
            latest.current.onPaid(current.id, session.hint);
            return;
          }
          const fresh = await getPledge(current.id);
          if (!mounted.current) return;
          if (fresh.state !== 'DRAFT') {
            latest.current.onPaid(current.id, 'returned');
            return;
          }
        } catch {
          // A browser that would not open, or a pledge read that failed: the hold is unchanged.
        } finally {
          inFlight.current = false;
        }
        if (mounted.current) setPhase('reserved');
        return;
      }
      inFlight.current = false;
      const described = outcome.failure;
      if (described.retireKey) keys.retire(intent);
      if (described.recovery === 'redraft') {
        if (reservedBody.current !== null) keys.retire(reservedBody.current);
        reservedBody.current = null;
        setPledge(null);
        setHeldUntil(null);
        setPhase('selecting');
      } else {
        setPhase('reserved');
      }
      if (described.code === 'AGREEMENT_REQUIRED') {
        setAgreementStale(true);
        latest.current.onAgreementRequired();
      }
      setFailure(described);
    })();
  }, [pledge, keys]);

  const retry = useCallback(() => {
    if (lastMutation.current === 'pay') pay();
    else reserve();
  }, [pay, reserve]);

  const startOver = useCallback(() => {
    setPledge(null);
    setFailure(null);
    setPhase('selecting');
  }, []);

  return {
    catalogueStatus,
    catalogue,
    catalogueFailure,
    reloadCatalogue,
    phase,
    pledge,
    heldUntil,
    failure,
    agreementStale: agreementStale && agreementVersion !== null,
    choice,
    reward,
    chooseReward,
    contributionText,
    setContributionText,
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

export type { PaymentReturnHint } from './payment';
