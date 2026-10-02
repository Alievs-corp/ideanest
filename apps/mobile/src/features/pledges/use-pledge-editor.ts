import Decimal from 'decimal.js';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, parseAmount, toMoney, type AmountParse } from '@ideanest/money';
import { attemptWithRetry } from '@ideanest/checkout/attempt';
import { NO_REWARD } from '@ideanest/checkout/draft';
import {
  changesFrom,
  draftOf,
  isEmptyEdit,
  raiseDifference,
  seedOf,
  type PledgeDraft,
} from '@ideanest/checkout/edit';
import { describeFailure, type CheckoutFailure, type PledgeFailureCopy } from '@ideanest/checkout/failure';
import { IdempotencyKeyring } from '@ideanest/checkout/idempotency';
import { raiseInFlight, type PaymentReturnHint } from '@ideanest/checkout/pledge';
import {
  destinationOptions,
  quoteSelection,
  requiresDestination,
  type QuoteResult,
  type Selection,
} from '@ideanest/checkout/quote';
import type { PledgeEdit, PledgeResponse, PublicReward, PublicRewardList } from '@ideanest/checkout/types';
import { queryKeys } from '../../api/queries';
import { getCheckoutRewards } from '../checkout/api';
import { openPaymentPage, raiseReturnFor } from '../checkout/payment';
import { editPledge, raisePledge } from './api';

export type EditorMode = 'edit' | 'raise';

export interface PledgeEditorOptions {
  readonly pledge: PledgeResponse;
  readonly mode: EditorMode;
  readonly online: boolean;
  readonly language: string;
  readonly failures: PledgeFailureCopy;
  readonly onSaved: (next: PledgeResponse) => void;
  readonly onReload: () => void;
  readonly onRaiseReturned: (hint: PaymentReturnHint | null) => void;
  readonly mintKey?: () => string;
}

export interface PledgeEditorState {
  readonly catalogue: PublicRewardList | null;
  readonly catalogueFailure: CheckoutFailure | null;
  readonly reloadCatalogue: () => void;
  readonly draft: PledgeDraft;
  readonly choose: (value: string) => void;
  readonly setContributionText: (value: string) => void;
  readonly addonQuantity: (rewardId: string) => number;
  readonly setAddonQuantity: (rewardId: string, quantity: number) => void;
  readonly setDestination: (code: string | null) => void;
  readonly setAnonymous: (value: boolean) => void;
  readonly reward: PublicReward | null;
  readonly contribution: AmountParse;
  readonly selection: Selection | null;
  readonly quote: QuoteResult | null;
  readonly edit: PledgeEdit;
  readonly unchanged: boolean;
  readonly needsDestination: boolean;
  readonly destinations: readonly string[];
  readonly due: string | null;
  readonly notHigher: boolean;
  readonly inFlight: boolean;
  readonly resumeUrl: string | null;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly failure: CheckoutFailure | null;
  readonly save: () => void;
  readonly raise: () => void;
  readonly resume: () => void;
}

const LONGEST_TIMEOUT_MS = 2 ** 31 - 1;

export function usePledgeEditor(options: PledgeEditorOptions): PledgeEditorState {
  const { pledge, mode, failures } = options;
  const raising = mode === 'raise';
  const latest = useRef(options);
  latest.current = options;

  const rewards = useQuery({
    queryKey: queryKeys.checkoutRewards(pledge.projectId, []),
    queryFn: ({ signal }) => getCheckoutRewards(pledge.projectId, [], signal),
  });
  const catalogue = rewards.data ?? null;
  const catalogueFailure = useMemo(
    () => (rewards.isError && catalogue === null ? describeFailure(rewards.error, failures) : null),
    [rewards.isError, rewards.error, catalogue, failures],
  );
  const { refetch } = rewards;
  const reloadCatalogue = useCallback(() => void refetch(), [refetch]);

  const [draft, setDraft] = useState<PledgeDraft>(() => draftOf(pledge));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);

  const keyring = useRef<IdempotencyKeyring | null>(null);
  keyring.current ??= new IdempotencyKeyring(options.mintKey ?? Crypto.randomUUID);
  const keys = keyring.current;
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const seeded = useRef(seedOf(pledge));
  useEffect(() => {
    const seed = seedOf(pledge);
    if (seed === seeded.current) return;
    seeded.current = seed;
    setDraft(draftOf(pledge));
  }, [pledge]);

  const touch = useCallback((next: (current: PledgeDraft) => PledgeDraft) => {
    setDraft(next);
    setFailure(null);
    setSaved(false);
  }, []);

  const choose = useCallback((value: string) => touch((current) => ({ ...current, choice: value })), [touch]);
  const setContributionText = useCallback(
    (value: string) => touch((current) => ({ ...current, contributionText: value.replace(',', '.') })),
    [touch],
  );
  const addonQuantity = useCallback(
    (rewardId: string) => draft.addons.find((addon) => addon.rewardTierId === rewardId)?.quantity ?? 0,
    [draft.addons],
  );
  const setAddonQuantity = useCallback(
    (rewardId: string, quantity: number) =>
      touch((current) => ({
        ...current,
        addons: [
          ...current.addons.filter((addon) => addon.rewardTierId !== rewardId),
          ...(quantity > 0 ? [{ rewardTierId: rewardId, quantity }] : []),
        ],
      })),
    [touch],
  );
  const setDestination = useCallback(
    (code: string | null) => touch((current) => ({ ...current, destination: code })),
    [touch],
  );
  const setAnonymous = useCallback(
    (value: boolean) => touch((current) => ({ ...current, isAnonymous: value })),
    [touch],
  );

  const contribution = useMemo(() => parseAmount(draft.contributionText), [draft.contributionText]);

  const reward = useMemo(() => {
    if (catalogue === null || draft.choice === NO_REWARD) return null;
    return catalogue.rewards.find((tier) => tier.id === draft.choice) ?? null;
  }, [catalogue, draft.choice]);

  const lines = useMemo(
    () =>
      catalogue === null
        ? []
        : draft.addons
            .map((addon) => ({
              reward: catalogue.addons.find((tier) => tier.id === addon.rewardTierId) ?? null,
              quantity: addon.quantity,
            }))
            .filter((line): line is { reward: PublicReward; quantity: number } => line.reward !== null),
    [catalogue, draft.addons],
  );

  const selection = useMemo<Selection | null>(() => {
    if (catalogue === null || !contribution.ok) return null;
    return {
      currency: catalogue.currency,
      reward,
      addons: lines,
      contribution: contribution.value,
      destination: draft.destination,
    };
  }, [catalogue, contribution, reward, lines, draft.destination]);

  const shape = useMemo<Selection | null>(
    () =>
      catalogue === null
        ? null
        : { currency: catalogue.currency, reward, addons: lines, contribution: new Decimal(0), destination: draft.destination },
    [catalogue, reward, lines, draft.destination],
  );
  const needsDestination = shape !== null && requiresDestination(shape);
  const destinations = useMemo(() => (shape === null ? [] : destinationOptions(shape)), [shape]);

  const quote = useMemo(() => (selection === null ? null : quoteSelection(selection)), [selection]);
  const edit = useMemo<PledgeEdit>(
    () => (contribution.ok ? changesFrom(pledge, draft, contribution.value) : {}),
    [contribution, draft, pledge],
  );
  const unchanged = isEmptyEdit(edit);

  const difference = useMemo(
    () => (!raising || quote === null || !quote.ok ? null : raiseDifference(quote.quote.total, pledge)),
    [raising, quote, pledge],
  );
  const currency = pledge.amounts.total.currency;
  const due = !unchanged && difference !== null && difference.gt(0) ? formatMoney(toMoney(difference, currency)) : null;
  const notHigher = raising && !unchanged && difference !== null && !difference.gt(0);

  const pendingHold = raising && pledge.latestRaise?.state === 'PENDING' ? pledge.latestRaise.holdExpiresAt : null;
  const [holdTick, setHoldTick] = useState(0);
  useEffect(() => {
    if (pendingHold === null) return;
    const remaining = Date.parse(pendingHold) - Date.now();
    if (!(remaining > 0)) return;
    const timer = setTimeout(() => setHoldTick((tick) => tick + 1), Math.min(remaining, LONGEST_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [pendingHold, holdTick]);
  const inFlight = raising && raiseInFlight(pledge, Date.now());
  const resumeUrl = inFlight ? (pledge.latestRaise?.resumeUrl ?? null) : null;

  const fail = useCallback(
    (described: CheckoutFailure, body: unknown) => {
      if (described.retireKey) keys.retire(body);
      setFailure(described);
      if (described.recovery === 'redraft') latest.current.onReload();
    },
    [keys],
  );

  const save = useCallback(() => {
    if (raising || busy.current || unchanged || !contribution.ok || !latest.current.online) return;
    const body = edit;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    void (async () => {
      const outcome = await attemptWithRetry(
        () => editPledge(pledge.id, body, keys.keyFor(body)),
        latest.current.failures,
      );
      busy.current = false;
      if (!mounted.current) return;
      setSaving(false);
      if (outcome.ok) {
        latest.current.onSaved(outcome.value);
        setSaved(true);
        return;
      }
      fail(outcome.failure, body);
    })();
  }, [raising, unchanged, contribution.ok, edit, pledge.id, keys, fail]);

  const raise = useCallback(() => {
    if (!raising || busy.current || unchanged || difference === null || !difference.gt(0) || inFlight) return;
    if (!latest.current.online) return;
    const intent = { ...edit, expectedAmount: toMoney(difference, currency) };
    busy.current = true;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    void (async () => {
      const outcome = await attemptWithRetry(
        () =>
          raisePledge(
            pledge.id,
            { ...intent, ...raiseReturnFor(pledge.id, latest.current.language) },
            keys.keyFor(intent),
          ),
        latest.current.failures,
      );
      if (!outcome.ok) {
        busy.current = false;
        if (!mounted.current) return;
        setSaving(false);
        fail(outcome.failure, intent);
        return;
      }
      let hint: PaymentReturnHint | null = null;
      try {
        const session = await openPaymentPage(outcome.value.redirectUrl, pledge.id, 'raise');
        hint = session.kind === 'returned' ? session.hint : null;
      } catch {
        hint = null;
      }
      busy.current = false;
      if (!mounted.current) return;
      setSaving(false);
      latest.current.onRaiseReturned(hint);
    })();
  }, [raising, unchanged, difference, inFlight, edit, currency, pledge.id, keys, fail]);

  const resume = useCallback(() => {
    if (resumeUrl === null || busy.current || !latest.current.online) return;
    busy.current = true;
    setSaving(true);
    void (async () => {
      let hint: PaymentReturnHint | null = null;
      try {
        const session = await openPaymentPage(resumeUrl, pledge.id, 'raise');
        hint = session.kind === 'returned' ? session.hint : null;
      } catch {
        hint = null;
      }
      busy.current = false;
      if (!mounted.current) return;
      setSaving(false);
      latest.current.onRaiseReturned(hint);
    })();
  }, [resumeUrl, pledge.id]);

  return {
    catalogue,
    catalogueFailure,
    reloadCatalogue,
    draft,
    choose,
    setContributionText,
    addonQuantity,
    setAddonQuantity,
    setDestination,
    setAnonymous,
    reward,
    contribution,
    selection,
    quote,
    edit,
    unchanged,
    needsDestination,
    destinations,
    due,
    notHigher,
    inFlight,
    resumeUrl,
    saving,
    saved,
    failure,
    save,
    raise,
    resume,
  };
}
