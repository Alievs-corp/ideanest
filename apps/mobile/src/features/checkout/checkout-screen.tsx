import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import { NO_REWARD } from '@ideanest/checkout/draft';
import { toAmounts } from '@ideanest/checkout/quote';
import { contributionMessage, refusalMessage } from '@ideanest/checkout/refusals';
import {
  AccentScopeProvider,
  AmountKeypad,
  Body,
  CardTitle,
  ContentSheet,
  Dialog,
  Eyebrow,
  Field,
  HeroFigure,
  IconButton,
  InlineAlert,
  Meta,
  Pill,
  Select,
  SkeletonCard,
  SkeletonGroup,
  SwipeToConfirm,
  type AmountKeypadHandle,
} from '../../components/ui';
import { focusOn } from '../../components/ui/overlay';
import { Checkbox } from '../../components/ui/checkbox';
import { queryKeys } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { catalogue, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { getBackerAgreementVersion, getFeeDisclosure } from './api';
import { AddonChoice } from './addon-choice';
import { FailureNotice } from './failure-notice';
import { FeeDisclosure } from './fee-disclosure';
import { countryName } from './format';
import { PledgeSummary } from './pledge-summary';
import { RewardChoice } from './reward-choice';
import { useCheckout } from './use-checkout';
import { useReservationClock } from './use-reservation-clock';

export interface CheckoutScreenProps {
  readonly projectId: string;
  readonly tokens: readonly string[];
  readonly initialRewardId: string | null;
}

const WIDE = 768;
const SUMMARY_WIDTH = 360;

export function checkoutPath(projectId: string, rewardId: string | null, tokens: readonly string[]): string {
  const query = new URLSearchParams();
  if (rewardId !== null) query.set('reward', rewardId);
  for (const token of tokens) query.append('token', token);
  const search = query.toString();
  return `/campaigns/${encodeURIComponent(projectId)}/back${search === '' ? '' : `?${search}`}`;
}

export function backActionFor(locked: boolean, heldMs: number): 'block' | 'ask' | 'leave' {
  if (locked) return 'block';
  return heldMs > 0 ? 'ask' : 'leave';
}

export function CheckoutScreen({ projectId, tokens, initialRewardId }: CheckoutScreenProps) {
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const copy = catalogue(locale).checkout;

  const agreement = useQuery({
    queryKey: queryKeys.legalDocument('BACKER_AGREEMENT'),
    queryFn: ({ signal }) => getBackerAgreementVersion(signal),
  });
  const fees = useQuery({
    queryKey: queryKeys.feeDisclosure(projectId),
    queryFn: ({ signal }) => getFeeDisclosure(projectId, signal),
  });
  const agreementVersion = agreement.data ?? null;

  const checkout = useCheckout({
    projectId,
    tokens,
    initialRewardId,
    agreementVersion,
    failures: copy.failures,
    language: locale,
    online,
    onPaid: (id, hint) => router.replace({ pathname: '/pledges/[id]', params: { id, payment: hint } }),
    onAgreementRequired: () => void agreement.refetch(),
  });
  const { phase, pledge, failure, quote, catalogue: list } = checkout;
  const clock = useReservationClock(pledge?.reservationExpiresAt);
  const held = useReservationClock(checkout.heldUntil);

  const step = phase === 'redirecting' ? 'confirmed' : pledge !== null ? 'review' : 'choose';
  const stepIndex = { choose: 1, review: 2, confirmed: 3 }[step];
  const heading = useRef<Text>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    focusOn(heading.current);
  }, [step]);

  const [leaving, setLeaving] = useState(false);

  // A keypad operation still on screen (`100 ÷ 4 = 25`) is settled before reserving: a valid result
  // becomes the contribution and the reservation follows on the render that has it; a refused or
  // unfinished one keeps its message and nothing is sent.
  const keypad = useRef<AmountKeypadHandle>(null);
  const [reserveNext, setReserveNext] = useState(false);
  const { reserve } = checkout;
  useEffect(() => {
    if (!reserveNext) return;
    setReserveNext(false);
    reserve();
  }, [reserveNext, reserve]);
  const reserveSettled = () => {
    const settled = keypad.current?.settle() ?? 'unchanged';
    if (settled === 'committed') setReserveNext(true);
    else if (settled === 'unchanged') reserve();
  };
  const busy = phase === 'reserving' || phase === 'paying';
  const locked = busy || phase === 'redirecting';
  const close = () => {
    if (held.remainingMs > 0) setLeaving(true);
    else router.back();
  };
  const backPress = useRef<() => boolean>(() => false);
  backPress.current = () => {
    const action = backActionFor(locked, held.remainingMs);
    if (action === 'ask') setLeaving(true);
    return action !== 'leave';
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => backPress.current());
    return () => subscription.remove();
  }, []);

  if (agreement.isError && agreement.data === undefined) {
    return (
      <View style={[styles.fill, { paddingTop: insets.top + spacing[4] }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Header onClose={() => router.back()} />
        <View style={styles.pad}>
          <InlineAlert
            variant="danger"
            title={t('checkout.agreementUnavailable.title')}
            description={t('checkout.agreementUnavailable.body')}
            action={
              <Pill
                size="sm"
                variant="ghost"
                label={t('checkout.agreementUnavailable.action')}
                onPress={() => void agreement.refetch()}
              />
            }
          />
        </View>
      </View>
    );
  }

  const currency = list?.currency ?? '';
  const minimum = checkout.reward === null ? null : formatMoney(checkout.reward.price);
  const refusal = quote !== null && !quote.ok ? quote.refusal : null;

  let contributionError: string | null = null;
  if (checkout.contributionShown && !checkout.contribution.ok) {
    contributionError = contributionMessage(checkout.contribution.reason, minimum, copy);
  } else if (refusal !== null && (refusal.reason === 'contribution-below-price' || refusal.reason === 'nothing-pledged')) {
    contributionError = refusalMessage(refusal, copy);
  } else if (failure?.field === 'contribution') {
    contributionError = failure.detail;
  }

  let destinationError: string | null = null;
  if (refusal?.reason === 'destination-unpriced' || (refusal?.reason === 'destination-missing' && checkout.attempted)) {
    destinationError = refusalMessage(refusal, copy);
  } else if (failure?.field === 'destination') {
    destinationError = failure.detail;
  }

  const destinationChoices = checkout.destinations
    .map((code) => ({ value: code, label: countryName(code, locale) }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
  const destinationLabel =
    checkout.needsDestination && checkout.destination !== null ? countryName(checkout.destination, locale) : null;

  const offlineNotice = online ? null : (
    <InlineAlert variant="warning" description={t('mobile.checkout.offline')} testID="checkout-offline" />
  );

  const failureNotice =
    failure === null ? null : (
      <FailureNotice
        failure={failure}
        rewards={list?.rewards ?? []}
        stale={checkout.agreementStale}
        existingPledgeId={failure.pledgeId ?? pledge?.id ?? null}
        onChoose={checkout.chooseReward}
        onRetry={checkout.retry}
        onReserveAgain={() => checkout.reserve({ fresh: true })}
        onSignIn={() =>
          router.push(signInHrefFor(checkoutPath(projectId, checkout.choice === NO_REWARD ? null : checkout.choice, tokens)))
        }
        onOpenPledge={(id) => router.replace({ pathname: '/pledges/[id]', params: { id } })}
      />
    );

  let form: ReactNode;
  let actions: ReactNode;
  if (step === 'choose') {
    form = (
      <>
        {checkout.catalogueStatus === 'loading' ? (
          <SkeletonGroup label={t('checkout.loading')}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </SkeletonGroup>
        ) : checkout.catalogueStatus === 'failed' ? (
          <InlineAlert
            variant="danger"
            title={checkout.catalogueFailure?.title}
            description={checkout.catalogueFailure?.detail}
            action={<Pill size="sm" variant="ghost" label={t('checkout.tryAgain')} onPress={checkout.reloadCatalogue} />}
          />
        ) : (
          <>
            <Body>{t('checkout.intro')}</Body>
            <RewardChoice rewards={list?.rewards ?? []} value={checkout.choice} onChange={checkout.chooseReward} />
            {checkout.attempted && checkout.choice === null ? (
              <InlineAlert variant="warning" description={t('checkout.reward.chooseOne')} testID="choose-one" />
            ) : null}
            {checkout.choice === null ? null : (
              <Field
                label={checkout.reward === null ? t('checkout.contribution.legendNoReward') : t('checkout.contribution.legend')}
                hint={
                  checkout.reward === null
                    ? t('checkout.contribution.hint')
                    : t('checkout.contribution.rewardHint', { amount: formatMoney(checkout.reward.price) })
                }
                error={contributionError}
                grouped
              >
                <AmountKeypad
                  value={checkout.contributionText}
                  onChange={checkout.setContributionText}
                  currency={currency}
                  overLimitMessage={copy.errors.amountTooLarge}
                  ref={keypad}
                  disabled={phase === 'reserving'}
                  testID="contribution"
                />
              </Field>
            )}
            <AddonChoice
              addons={list?.addons ?? []}
              quantity={checkout.addonQuantity}
              onChange={checkout.setAddonQuantity}
            />
            {checkout.needsDestination ? (
              <Field label={t('checkout.destination.label')} hint={t('checkout.destination.hint')} error={destinationError}>
                <Select
                  options={destinationChoices}
                  value={checkout.destination}
                  onChange={checkout.setDestination}
                  placeholder={t('checkout.destination.placeholder')}
                  testID="destination"
                />
              </Field>
            ) : null}
            {checkout.choice === null ? null : (
              <Checkbox
                label={t('checkout.anonymous.label')}
                description={t('checkout.anonymous.hint')}
                checked={checkout.isAnonymous}
                onChange={checkout.setAnonymous}
                testID="anonymous"
              />
            )}
          </>
        )}
      </>
    );
    actions = (
      <Pill
        variant="outline"
        fullWidth
        label={phase === 'reserving' ? t('checkout.review.reserving') : t('checkout.review.reserve')}
        busy={phase === 'reserving'}
        disabled={phase === 'reserving' || !online || checkout.catalogueStatus !== 'ready'}
        onPress={reserveSettled}
        testID="reserve"
      />
    );
  } else if (step === 'review' && pledge !== null) {
    const reviewed = list?.rewards.find((reward) => reward.id === pledge.rewardTierId) ?? null;
    const rows: (readonly [string, string])[] = [
      reviewed === null
        ? [t('checkout.review.reward'), t('checkout.review.noReward')]
        : [t('checkout.review.reward'), reviewed.title],
      ...pledge.addons.map((line) => {
        const addon = list?.addons.find((candidate) => candidate.id === line.rewardTierId);
        return [t('checkout.review.addon'), `${line.quantity} × ${addon?.title ?? line.rewardTierId}`] as const;
      }),
      ...(pledge.shippingCountry == null
        ? []
        : [[t('checkout.review.deliveredTo'), countryName(pledge.shippingCountry, locale)] as const]),
      [
        t('checkout.review.listedAs'),
        pledge.isAnonymous ? t('checkout.anonymous.shown') : t('checkout.anonymous.yourName'),
      ],
    ];
    form = (
      <>
        {clock.expired ? (
          <InlineAlert
            variant="warning"
            title={t('checkout.done.expired')}
            description={t('checkout.expired')}
            testID="reservation-expired"
            action={
              <Pill size="sm" variant="ghost" label={t('checkout.reserveAgain')} onPress={() => {
                  checkout.startOver();
                  checkout.reserve({ fresh: true });
                }}
                testID="reserve-again"
              />
            }
          />
        ) : (
          <Body style={styles.tabular} testID="reservation-clock">
            {t('checkout.heldFor', { time: clock.label })}
          </Body>
        )}
        <View style={styles.section}>
          <CardTitle accessibilityRole="header">{t('checkout.review.heading')}</CardTitle>
          {rows.map(([term, detail], index) => (
            <View key={`${term}-${index}`} style={styles.row} accessible>
              <Meta tone="secondary">{term}</Meta>
              <Meta tone="primary" style={styles.detail}>
                {detail}
              </Meta>
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <CardTitle accessibilityRole="header">{t('checkout.payment.heading')}</CardTitle>
          <InlineAlert
            variant="info"
            title={t('checkout.payment.none')}
            description={`${t('checkout.payment.body')} ${t('checkout.payment.later')}`}
            politeness="off"
          />
        </View>
      </>
    );
    actions = (
      <>
        {agreementVersion === null ? null : (
          <View style={styles.risk}>
            <Text style={styles.onWhiteHeading}>{t('checkout.risk.heading')}</Text>
            <Text style={styles.onWhite}>{t('checkout.risk.body')}</Text>
          </View>
        )}
        <Text style={styles.onWhite}>{t('checkout.review.rule')}</Text>
        <SwipeToConfirm
          label={phase === 'paying' ? t('checkout.review.confirming') : t('mobile.checkout.swipeToPay')}
          actionLabel={
            phase === 'paying'
              ? t('checkout.review.confirming')
              : agreementVersion === null
                ? t('checkout.review.confirm')
                : t('checkout.risk.confirm')
          }
          amount={formatMoney(pledge.amounts.total)}
          busy={phase === 'paying'}
          disabled={clock.expired || !online}
          onConfirm={checkout.pay}
          testID="confirm"
        />
        <Text style={styles.onWhite}>{t('checkout.review.charged')}</Text>
        <Pill
          variant="ghost"
          fullWidth
          label={t('checkout.review.change')}
          disabled={phase === 'paying'}
          onPress={checkout.startOver}
          testID="change"
        />
      </>
    );
  } else {
    form = <Body>{t('checkout.review.confirming')}</Body>;
    actions = undefined;
  }

  const amounts = pledge !== null ? pledge.amounts : quote !== null && quote.ok ? toAmounts(quote.quote) : null;
  const summary =
    step === 'confirmed' ? null : (
      <PledgeSummary
        amounts={amounts}
        source={pledge !== null ? 'quoted' : 'preview'}
        rewardTitle={
          pledge !== null
            ? (list?.rewards.find((reward) => reward.id === pledge.rewardTierId)?.title ?? null)
            : checkout.reward?.title ?? null
        }
        destination={pledge !== null ? (pledge.shippingCountry == null ? null : countryName(pledge.shippingCountry, locale)) : destinationLabel}
        waiting={checkout.choice === null ? 'empty' : 'pending'}
      >
        {actions}
      </PledgeSummary>
    );

  const wide = width >= WIDE;
  const steps = (['choose', 'review', 'confirmed'] as const).map((name, index) => ({
    name,
    index: index + 1,
    label: t(`checkout.steps.${name}`),
  }));

  return (
    <AccentScopeProvider>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !locked && held.remainingMs === 0 }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          testID="checkout"
        >
          <Header onClose={close} disabled={locked} />
          <Text ref={heading} accessibilityRole="header" style={styles.h1} testID="checkout-step">
            {t(`checkout.steps.${step}`)}
          </Text>
          <View accessibilityLabel={t('checkout.progress')} style={styles.steps}>
            {steps.map((entry) => (
              <Text
                key={entry.name}
                accessibilityLabel={t('mobile.checkout.step', { index: entry.index, count: 3, name: entry.label })}
                accessibilityState={{ selected: entry.index === stepIndex }}
                style={entry.index === stepIndex ? styles.stepOn : styles.stepOff}
              >
                {`${entry.index}. ${entry.label}`}
              </Text>
            ))}
          </View>
          {amounts === null || step === 'confirmed' ? null : (
            <View style={styles.hero}>
              <Meta tone="secondary" accessibilityElementsHidden importantForAccessibility="no">
                {t('checkout.summary.total')}
              </Meta>
              <HeroFigure money={amounts.total} label={t('checkout.summary.total')} testID="checkout-hero" />
            </View>
          )}
          <ContentSheet>
            <View style={wide ? styles.wide : styles.narrow}>
              <View style={[styles.form, wide && styles.formWide]}>
                {offlineNotice}
                {failureNotice}
                {form}
              </View>
              {summary === null ? null : <View style={wide ? styles.summaryWide : undefined}>{summary}</View>}
            </View>
            {fees.isPending ? null : (
              <FeeDisclosure disclosure={fees.data ?? null} onPricing={() => router.push('/pricing')} />
            )}
          </ContentSheet>
        </ScrollView>
      </KeyboardAvoidingView>
      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t('mobile.checkout.leaveTitle')}
        description={t('mobile.checkout.leaveBody', { time: held.label })}
        footer={
          <View style={styles.dialogActions}>
            <Pill variant="ghost" label={t('mobile.checkout.stay')} onPress={() => setLeaving(false)} />
            <Pill
              variant="primary"
              label={t('mobile.checkout.leave')}
              onPress={() => {
                setLeaving(false);
                router.back();
              }}
              testID="leave"
            />
          </View>
        }
      />
    </AccentScopeProvider>
  );
}

function Header({ onClose, disabled = false }: { readonly onClose: () => void; readonly disabled?: boolean }) {
  const t = useT();
  return (
    <View style={styles.header}>
      <IconButton icon={Glyphs.Close} size="lg" variant="ghost" label={t('mobile.checkout.close')} onPress={onClose} disabled={disabled} testID="checkout-close" />
      <Eyebrow>{t('checkout.title')}</Eyebrow>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  pad: { padding: spacing[5] },
  // `flexGrow` so the white sheet, last in the column, runs to the bottom edge.
  content: { flexGrow: 1, paddingHorizontal: spacing[5], gap: spacing[5] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  h1: { ...font.semibold, fontSize: fontSize.h2, lineHeight: lineHeight.h2, color: colors.textPrimary },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  stepOn: { ...font.medium, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textPrimary },
  stepOff: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textTertiary },
  hero: { gap: spacing[1] },
  narrow: { gap: spacing[6] },
  wide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[6] },
  form: { gap: spacing[5] },
  formWide: { flex: 1 },
  summaryWide: { width: SUMMARY_WIDTH },
  tabular: { fontVariant: ['tabular-nums'] },
  section: { gap: spacing[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[4], flexWrap: 'wrap' },
  detail: { flexShrink: 1 },
  risk: { gap: spacing[1] },
  onWhiteHeading: { ...font.medium, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textOnWhite },
  onWhite: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small, color: colors.textOnWhite },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3] },
});
