import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Locale } from '@ideanest/messages/locale';
import {
  canChoose,
  isFreePrice,
  isHeldPlan,
  standingOf,
  type HeldSubscription,
  type Plan,
} from '@ideanest/plans/catalogue';
import { Glyphs } from '../../icons';
import { formatDay, useT, type Translate } from '../../lib/i18n';
import { activeTheme, colors, darkColors, font, fontSize, lineHeight, radius, size, spacing, tint, tracking } from '../../theme';
import {
  Body,
  Card,
  CardTitle,
  Eyebrow,
  Icon,
  InlineAlert,
  Pill,
  PressableScale,
  SurfaceProvider,
  Tag,
  TONES,
  type InlineAlertVariant,
} from '../ui';

/**
 * The plans, and where this reader stands against them — the web's `PlanChooser.tsx` (#164).
 *
 * <p>Presentational: the screen owns the reads, the writes and the decision whether a plan may be
 * chosen in the app at all (`onChoose` absent means the choice is made on the web, and no card
 * offers a button). Reused by the campaign editor's review step later, so nothing here reads a
 * route.
 *
 * <p>Plan choices are never lime buttons: the kit allows at most one accent per screen, and a choice
 * between plans is not "act now". Each card's button is near-black with a white label, inverted to
 * white on the black card (`PLAN_SKIN`). The held plan's cancel pill is `ghost`.
 *
 * <h2>Paying and renewing happen on the website (#452)</h2>
 *
 * <p>The app never takes money for a plan (Apple 3.1.1 and Play Billing, #164). When a payment is due
 * (`paymentDue`, #449) the held panel says so and offers the screen's "open the pricing page" action
 * — the same words and the same page as the web-only notice — never a pay or renew button and never
 * a price beside one.
 */

/** Whether the service would take a renewal for this plan now: inside its window, still running. */
export function isRenewing(held: HeldSubscription): boolean {
  return held.paymentDue === 'RENEWAL' && held.entitled;
}

/** Whether something is to be paid on the website now: the first period, or a renewal. */
export function isPaymentDue(held: HeldSubscription): boolean {
  return (held.state === 'PENDING_PAYMENT' && held.paymentDue === 'FIRST_PERIOD') || isRenewing(held);
}

/**
 * One sentence saying where a holder stands — four states, four sentences, and a fifth inside the
 * renewal window, which names the end date and the website as the place to renew.
 */
export function describeHeld(held: HeldSubscription, t: Translate, locale: Locale): string {
  const plan = held.plan.name;
  const date = formatDay(held.currentPeriodEnd, locale) ?? '';
  if (isRenewing(held)) return t('mobile.pricing.renewalTitle', { plan, date });
  switch (standingOf(held)) {
    case 'pending':
      return t('pricing.held.pendingTitle', { plan });
    case 'lapsed':
      return t('pricing.held.lapsed', { plan, date });
    case 'ending':
      return t('pricing.held.endingOn', { plan, date });
    case 'active':
      return t('pricing.held.activeUntil', { plan, date });
  }
}

const STANDING_VARIANT: Record<ReturnType<typeof standingOf>, InlineAlertVariant> = {
  // Chosen and not paid for: not a failure, not finished — never a green tick.
  pending: 'warning',
  active: 'success',
  ending: 'info',
  lapsed: 'info',
};

/**
 * What the holder is told under the sentence: how a pending plan is paid, what renewing does, or
 * when renewing opens. The bank transfer stays as the alternative to the card (epic #448), so a
 * pending plan the service cannot take a card for keeps the transfer sentence alone.
 */
function heldDetail(held: HeldSubscription, t: Translate, locale: Locale): string | undefined {
  if (held.state === 'PENDING_PAYMENT') {
    return held.paymentDue === 'FIRST_PERIOD' ? t('mobile.pricing.pendingOnWeb') : t('pricing.held.pendingBody');
  }
  if (isRenewing(held)) {
    const body = t('pricing.payment.renewalBody');
    return held.cancelAtPeriodEnd ? `${body} ${t('pricing.payment.renewalCancelled')}` : body;
  }
  const opensAt = held.entitled && (held.paymentDue ?? null) === null ? formatDay(held.renewalOpensAt, locale) : null;
  return opensAt === null ? undefined : t('mobile.pricing.renewsFromOnWeb', { date: opensAt });
}

export function HeldPanel({
  held,
  locale,
  onCancel,
  cancelling = false,
  cancelDisabled = false,
  onOpenWeb,
  openDisabled = false,
}: {
  readonly held: HeldSubscription;
  readonly locale: Locale;
  /** Absent where cancelling is done on the web. */
  readonly onCancel?: () => void;
  readonly cancelling?: boolean;
  readonly cancelDisabled?: boolean;
  /** Opens the pricing page on the website, offered while a payment is due there. */
  readonly onOpenWeb?: () => void;
  /** Offline: the website cannot be opened. */
  readonly openDisabled?: boolean;
}) {
  const t = useT();
  const standing = standingOf(held);
  const changeable = onCancel !== undefined && standing === 'pending';
  const detail = heldDetail(held, t, locale);
  return (
    <Card testID="pricing-held">
      <View style={styles.stack}>
        <Eyebrow accessibilityRole="header">{t('pricing.held.heading')}</Eyebrow>
        <InlineAlert
          // A renewal that is due is something to do, like a pending plan: never a green tick.
          variant={isRenewing(held) ? 'warning' : STANDING_VARIANT[standing]}
          title={describeHeld(held, t, locale)}
          description={changeable ? [detail, t('pricing.held.pendingChange')].filter(Boolean).join(' ') : detail}
          action={
            onOpenWeb !== undefined && isPaymentDue(held) ? (
              <Pill
                label={t('mobile.pricing.webOnly.open')}
                size="sm"
                disabled={openDisabled}
                onPress={onOpenWeb}
                testID="pricing-held-open-web"
              />
            ) : undefined
          }
          // The screen announces a change itself, politely, as the web's live region does.
          politeness="off"
          testID="pricing-held-standing"
        />
        {onCancel !== undefined && (standing === 'active' || changeable) ? (
          <View style={styles.start}>
            <Pill
              label={
                cancelling
                  ? t('pricing.held.cancelling')
                  : changeable
                    ? t('pricing.held.withdraw')
                    : t('pricing.held.cancel')
              }
              variant="ghost"
              size="sm"
              busy={cancelling}
              disabled={cancelDisabled}
              onPress={onCancel}
              testID="pricing-cancel"
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export function PlanCards({
  plans,
  held,
  onChoose,
  busyPlan = null,
  chooseDisabled = false,
}: {
  readonly plans: readonly Plan[];
  readonly held: HeldSubscription | null;
  /** Absent where plans are chosen on the web: the cards then offer no button. */
  readonly onChoose?: (plan: Plan) => void;
  readonly busyPlan?: string | null;
  /** Offline, or a choice already in flight: every pill is disabled. */
  readonly chooseDisabled?: boolean;
}) {
  const t = useT();
  if (plans.length === 0) return <Body testID="pricing-empty">{t('pricing.empty')}</Body>;
  return (
    <View style={styles.cards} testID="pricing-plans">
      {plans.map((plan, index) => (
        <PlanCard
          key={plan.id}
          tone={PLAN_TONES[index % PLAN_TONES.length] ?? 'white'}
          plan={plan}
          current={isHeldPlan(held, plan.id)}
          onChoose={onChoose === undefined ? undefined : () => onChoose(plan)}
          busy={busyPlan === plan.id}
          disabled={chooseDisabled || busyPlan !== null || !canChoose(held, plan.id)}
        />
      ))}
    </View>
  );
}

/**
 * The web's plan surfaces, in order: light, black, lime (one lime element on the screen).
 *
 * <p>The choose button is near-black with a white label on every card except the black one, where
 * it inverts to white with a near-black label — the lime card included, so the three read as one
 * control rather than one of them carrying lime text.
 */
const PLAN_TONES = ['white', 'night', 'lime'] as const;
type PlanTone = (typeof PLAN_TONES)[number];

const PLAN_SKIN: Record<PlanTone, { card: string; button: string; label: string; border?: string }> = {
  // On the light canvas `whiteMuted` is the page's own colour, so the card turns white with an edge.
  white:
    activeTheme === 'light'
      ? { card: colors.whiteSurface, button: colors.textOnWhite, label: colors.whiteSurface, border: tint(colors.black, 0.08) }
      : { card: colors.whiteMuted, button: colors.textOnWhite, label: colors.whiteSurface },
  night: { card: colors.black, button: colors.whiteSurface, label: colors.textOnWhite, border: tint(darkColors.textPrimary, 0.08) },
  lime: { card: colors.lime500, button: colors.textOnLime, label: colors.whiteSurface },
};

function PlanCard({
  plan,
  current,
  onChoose,
  busy,
  disabled,
  tone,
}: {
  readonly plan: Plan;
  readonly current: boolean;
  readonly onChoose?: () => void;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly tone: PlanTone;
}) {
  const t = useT();
  const free = isFreePrice(plan.price);
  const skin = PLAN_SKIN[tone];
  const ink = TONES[tone];
  const period = plan.billingPeriod === 'YEARLY' ? t('pricing.perYear') : t('pricing.perMonth');
  const points = [
    ...(plan.description == null ? [] : [plan.description]),
    plan.maxActiveCampaigns == null
      ? t('pricing.limits.campaignsUnlimited')
      : t('pricing.limits.campaigns', { count: String(plan.maxActiveCampaigns) }),
    plan.goalCeiling == null
      ? t('pricing.limits.goalUnlimited')
      : t('pricing.limits.goalCeiling', {
          amount: formatMoney({ amount: plan.goalCeiling, currency: plan.currency }),
        }),
  ];

  return (
    <SurfaceProvider surface={tone}>
      <View
        style={[
          styles.plan,
          { backgroundColor: skin.card },
          skin.border === undefined ? null : { borderWidth: 1, borderColor: skin.border },
        ]}
        testID={`pricing-plan-${plan.code || plan.id}`}
      >
        <View style={styles.nameRow}>
          <CardTitle style={[styles.name, font.semibold]}>{plan.name}</CardTitle>
          {current ? <Tag label={t('pricing.held.currentTag')} testID="pricing-current" /> : null}
        </View>
        <View style={styles.limits}>
          {points.map((point) => (
            <View key={point} style={styles.limit}>
              <Icon icon={Glyphs.Add} size={18} color={ink.primary} />
              <Body style={styles.limitText}>{point}</Body>
            </View>
          ))}
        </View>
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: ink.primary }]}>
            {free ? t('pricing.free') : formatMoney({ amount: plan.price, currency: plan.currency })}
          </Text>
          {free ? null : <Body tone="tertiary">{period}</Body>}
        </View>
        {onChoose === undefined ? null : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('mobile.pricing.chooseNamed', { plan: plan.name })}
            accessibilityState={{ disabled: disabled || busy, busy }}
            disabled={disabled || busy}
            onPress={onChoose}
            contentStyle={[styles.choose, { backgroundColor: skin.button, opacity: disabled || busy ? 0.4 : 1 }]}
            testID={`pricing-choose-${plan.code || plan.id}`}
          >
            <Text style={[styles.chooseLabel, { color: skin.label }]} numberOfLines={1}>
              {busy ? t('pricing.choosing') : t('pricing.choose')}
            </Text>
            <Icon icon={Glyphs.ArrowRight} size={20} color={skin.label} />
          </PressableScale>
        )}
      </View>
    </SurfaceProvider>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing[4] },
  plan: { gap: spacing[4], padding: spacing[6], borderRadius: radius.xl },
  price: { ...font.semibold, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: tracking.display, fontVariant: ['tabular-nums'] },
  choose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    minHeight: size.touchTarget,
    paddingHorizontal: spacing[5],
    borderRadius: radius.full,
  },
  chooseLabel: { ...font.medium, fontSize: fontSize.sm, flexShrink: 1 },
  stack: { gap: spacing[3] },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[3] },
  name: { flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing[1] },
  limits: { gap: spacing[2] },
  limit: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  limitText: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
