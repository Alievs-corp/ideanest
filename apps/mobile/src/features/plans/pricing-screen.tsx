import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { ApiError } from '@ideanest/api-client';
import {
  refusalOf,
  standingOf,
  type MySubscription,
  type SubscriptionRefusal,
} from '@ideanest/plans/catalogue';
import { inAppPlanChoice, siteUrl } from '../../api/config';
import { queryKeys } from '../../api/queries';
import { StaticPage } from '../../components/content/static-page';
import { FeeDisclosure } from '../../components/fees/fee-disclosure';
import { HeldPanel, PlanCards, describeHeld } from '../../components/plans/plan-chooser';
import { InlineAlert, Pill, Skeleton, SkeletonCard, SkeletonGroup, announce } from '../../components/ui';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { spacing } from '../../theme';
import {
  cancelSubscription,
  chooseSubscription,
  useMySubscription,
  usePlanCatalogue,
  usePlatformFeeDisclosure,
  type SubscriptionAnswer,
} from './api';

/**
 * Pricing — the web's `/pricing`, issue #164.
 *
 * <h2>Where a plan is chosen</h2>
 *
 * A plan unlocks publishing, and both stores generally require their own billing for that. Until the
 * owner decides between store billing and a written exemption, the app shows the plans, what the
 * reader holds and the fee terms, and sends the choice to the web page in the in-app browser
 * (`inAppPlanChoice()` off, the default). With the flag on, the cards choose and the held panel
 * cancels here, exactly as the web's `PlanChooser` does.
 *
 * <h2>`from=submit` — a refused submission sent the creator here</h2>
 *
 * The banner says why they are looking at prices and links back to the campaign. A choice that
 * entitles them replaces this screen with the campaign's review step; a pending one never does,
 * because the campaign would refuse them again. While a pending plan is held the subscription is
 * re-read each time the app comes back to the foreground — the creator returning from a banking app
 * — and when the in-app browser closes.
 *
 * <h2>Money</h2>
 *
 * Prices and rates stay decimal strings: free is `Decimal.isZero()`, amounts are formatted by
 * `@ideanest/money`, percentages by `decimal.js`. Nothing here is persisted: a stale price or
 * entitlement restored after a restart would mislead somebody about to pay.
 */
export function PricingScreen({ fromProjectId }: { readonly fromProjectId?: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline();
  const client = useQueryClient();
  const { signedIn } = useSession();
  const inApp = inAppPlanChoice();

  const plans = usePlanCatalogue();
  const mine = useMySubscription(signedIn);
  const fees = usePlatformFeeDisclosure();

  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState<SubscriptionRefusal | null>(null);
  const [pulling, setPulling] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const held = mine.data?.state === 'read' ? mine.data.subscription : null;
  const review: Href | null = fromProjectId === undefined ? null : `/campaigns/${fromProjectId}/edit/review`;
  const pricingPath = fromProjectId === undefined ? '/pricing' : `/pricing?from=submit&project=${fromProjectId}`;

  const settle = (next: MySubscription) => {
    const answer: SubscriptionAnswer = { state: 'read', subscription: next.subscription };
    client.setQueryData([...queryKeys.mySubscription(), signedIn], answer);
  };

  // What changed is said politely, whatever changed it: a choice, a cancel, the web or a re-read.
  const sentence = mine.data === undefined ? undefined : held === null ? null : describeHeld(held, t, locale);
  const spoken = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (sentence === undefined) return;
    if (spoken.current !== undefined && sentence !== null && sentence !== spoken.current) announce(sentence);
    spoken.current = sentence;
  }, [sentence]);

  const choose = async (planId: string) => {
    if (!online) return;
    setBusyPlan(planId);
    setRefusal(null);
    try {
      const next = await chooseSubscription(planId);
      settle(next);
      if (review !== null && next.subscription?.entitled === true) router.replace(review);
    } catch (cause) {
      setRefusal(refusalFrom(cause));
      // `ALREADY_SUBSCRIBED` means the page is behind the service: catch up rather than keep offering.
      void mine.refetch();
    } finally {
      setBusyPlan(null);
    }
  };

  const cancel = async () => {
    if (!online) return;
    setCancelling(true);
    setRefusal(null);
    try {
      settle(await cancelSubscription());
    } catch (cause) {
      setRefusal(refusalFrom(cause));
      void mine.refetch();
    } finally {
      setCancelling(false);
    }
  };

  const { refetch: recheck } = mine;
  const returnFromWeb = async () => {
    const after = await recheck();
    if (review !== null && after.data?.state === 'read' && after.data.subscription?.entitled === true) {
      router.replace(review);
    }
  };

  /*
   * iOS resolves `openBrowserAsync` when the browser is dismissed. Android resolves it at once with
   * `opened`, so there the return is the app's next `active`, and the read waits for it.
   */
  const openOnWeb = async () => {
    let result: WebBrowser.WebBrowserResult;
    try {
      result = await WebBrowser.openBrowserAsync(`${siteUrl()}/${locale}${pricingPath}`);
    } catch {
      return;
    }
    if (result.type === 'opened') setAwaitingReturn(true);
    else await returnFromWeb();
  };

  const returned = useRef(returnFromWeb);
  returned.current = returnFromWeb;
  useEffect(() => {
    if (!awaitingReturn) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setAwaitingReturn(false);
      void returned.current();
    });
    return () => subscription.remove();
  }, [awaitingReturn]);

  // The transfer is recorded somewhere else, minutes or days later: re-read on coming back.
  const waiting = review !== null && held !== null && standingOf(held) === 'pending';
  useEffect(() => {
    if (!waiting) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recheck();
    });
    return () => subscription.remove();
  }, [waiting, recheck]);

  const refresh = () => {
    setPulling(true);
    void Promise.all([plans.refetch(), mine.refetch(), fees.refetch()]).finally(() => setPulling(false));
  };

  return (
    <StaticPage
      title={t('pricing.title')}
      summary={t('pricing.intro')}
      headerTitle={t('shell.nav.pricing')}
      sharePath="/pricing"
      offlineNotice={online || plans.data === undefined ? null : t('mobile.offline.banner')}
      onRefresh={refresh}
      refreshing={pulling}
      testID="pricing"
    >
      {review === null ? null : held?.entitled === true ? (
        <InlineAlert
          variant="success"
          title={t('pricing.fromSubmit.ready')}
          action={<Pill label={t('pricing.fromSubmit.resume')} size="sm" onPress={() => router.push(review)} />}
          testID="pricing-from-submit"
        />
      ) : (
        <InlineAlert
          variant="info"
          title={t('pricing.fromSubmit.title')}
          description={t('pricing.fromSubmit.body')}
          action={
            <Pill label={t('pricing.fromSubmit.back')} variant="ghost" size="sm" onPress={() => router.push(review)} />
          }
          testID="pricing-from-submit"
        />
      )}

      {refusal === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('pricing.errors.generic')}
          description={t(`pricing.errors.${refusal}`)}
          testID="pricing-refusal"
        />
      )}

      {online ? null : (
        <InlineAlert variant="info" description={t('mobile.pricing.offline')} politeness="off" testID="pricing-offline" />
      )}

      <Standing
        answer={mine.data}
        failed={mine.isError}
        onRetry={() => void mine.refetch()}
        retrying={mine.isFetching}
        onSignIn={() => router.push(signInHrefFor(pricingPath))}
      />

      {held === null ? null : (
        <HeldPanel
          held={held}
          locale={locale}
          onCancel={inApp ? () => void cancel() : undefined}
          cancelling={cancelling}
          cancelDisabled={!online}
        />
      )}

      {inApp ? null : (
        <InlineAlert
          variant="info"
          title={t('mobile.pricing.webOnly.title')}
          description={t('mobile.pricing.webOnly.body')}
          action={
            <Pill
              label={t('mobile.pricing.webOnly.open')}
              size="sm"
              disabled={!online}
              onPress={() => void openOnWeb()}
              testID="pricing-open-web"
            />
          }
          testID="pricing-web-only"
        />
      )}

      {plans.data !== undefined ? (
        <PlanCards
          plans={plans.data}
          held={held}
          onChoose={inApp ? (plan) => void choose(plan.id) : undefined}
          busyPlan={busyPlan}
          chooseDisabled={!online}
        />
      ) : plans.isError ? (
        <InlineAlert
          variant="danger"
          title={t('pricing.unavailable')}
          action={
            <Pill
              label={t('common.tryAgain')}
              variant="ghost"
              size="sm"
              busy={plans.isFetching}
              onPress={() => void plans.refetch()}
            />
          }
          testID="pricing-plans-failed"
        />
      ) : (
        <SkeletonGroup label={t('mobile.pricing.loadingPlans')}>
          <View style={styles.skeletons}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </SkeletonGroup>
      )}

      {fees.isPending ? null : (
        <View style={styles.fees}>
          <FeeDisclosure
            disclosure={fees.data ?? null}
            audience="creator"
            onPricing={() => void fees.refetch()}
            onRetry={() => void fees.refetch()}
            retrying={fees.isFetching}
            framed
          />
        </View>
      )}
    </StaticPage>
  );
}

/** The subscription read: loading, signed out, or failed. A holding is the panel's business. */
function Standing({
  answer,
  failed,
  onRetry,
  retrying,
  onSignIn,
}: {
  readonly answer: SubscriptionAnswer | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly retrying: boolean;
  readonly onSignIn: () => void;
}) {
  const t = useT();
  if (answer?.state === 'signed-out') {
    return (
      <InlineAlert
        variant="info"
        title={t('pricing.signedOut')}
        action={<Pill label={t('pricing.signIn')} size="sm" onPress={onSignIn} testID="pricing-sign-in" />}
        testID="pricing-signed-out"
      />
    );
  }
  if (answer !== undefined) return null;
  if (failed) {
    return (
      <InlineAlert
        variant="danger"
        title={t('pricing.errors.generic')}
        description={t('mobile.pricing.subscriptionUnavailable')}
        action={<Pill label={t('common.tryAgain')} variant="ghost" size="sm" busy={retrying} onPress={onRetry} />}
        testID="pricing-subscription-failed"
      />
    );
  }
  return (
    <SkeletonGroup label={t('pricing.loading')}>
      <Skeleton width="60%" />
    </SkeletonGroup>
  );
}

function refusalFrom(cause: unknown): SubscriptionRefusal {
  return cause instanceof ApiError ? refusalOf(cause.status, cause.problem?.code) : refusalOf(null, null);
}

const styles = StyleSheet.create({
  skeletons: { gap: spacing[4] },
  fees: { marginTop: spacing[1] },
});
