import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Locale } from '@ideanest/messages/locale';
import {
  canChoose,
  isFreePrice,
  isHeldPlan,
  priceFor,
  standingOf,
  type BillingPeriod,
  type HeldSubscription,
  type Plan,
} from '@ideanest/plans/catalogue';
import { Glyphs, type IconGlyph } from '../../icons';
import { formatDay, useT, type MessageKey, type Translate } from '../../lib/i18n';
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
 *
 * <h2>Periods and the student plan (#655)</h2>
 *
 * <p>Every plan may be sold for one month, six months or a year, each at its own price. The screen
 * owns the period switch; each card prints `priceFor(plan, period)` with that period's words, and a
 * plan not sold for the period says so and offers no button. A `studentOnly` card carries the
 * "Student" tag and one line saying a student card check is needed, and its button follows the
 * reader's check ({@link StudentStanding}): confirmed is the ordinary choice, not yet confirmed
 * opens the student status screen, waiting is a disabled "Being checked".
 */

/** Where the reader's student card check stands, as the student plan's card acts on it. */
export type StudentStanding =
  /** Confirmed and unexpired: the student plan is chosen like any other. */
  | 'qualified'
  /** Never sent, refused, expired, or signed out: the card offers the check. */
  | 'unverified'
  /** Sent and waiting for staff. */
  | 'pending'
  /** Not known yet (the read is in flight): no student action, and no choice either. */
  | 'unknown';

/** "a month", "for 6 months", "a year": what a card prints after the price. */
export const PER_PERIOD: Readonly<Record<BillingPeriod, MessageKey>> = {
  MONTHLY: 'pricing.perMonth',
  SEMIANNUAL: 'mobile.pricing.perSemiannual',
  YEARLY: 'pricing.perYear',
};

/** "1 month", "6 months", "1 year": the period switch's words. */
export const PERIOD_NAME: Readonly<Record<BillingPeriod, MessageKey>> = {
  MONTHLY: 'mobile.pricing.periods.MONTHLY',
  SEMIANNUAL: 'mobile.pricing.periods.SEMIANNUAL',
  YEARLY: 'mobile.pricing.periods.YEARLY',
};

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
  period,
  student = 'unknown',
  onVerifyStudent,
  onChoose,
  busyPlan = null,
  chooseDisabled = false,
}: {
  readonly plans: readonly Plan[];
  readonly held: HeldSubscription | null;
  /** The period the switch shows; every card is priced for it. */
  readonly period: BillingPeriod;
  /** The reader's student card check, for a `studentOnly` card. */
  readonly student?: StudentStanding;
  /** Opens the student status screen, from a `studentOnly` card the reader may not buy yet. */
  readonly onVerifyStudent?: () => void;
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
          period={period}
          current={isHeldPlan(held, plan.id)}
          student={plan.studentOnly ? student : null}
          onVerifyStudent={onVerifyStudent}
          onChoose={onChoose === undefined ? undefined : () => onChoose(plan)}
          busy={busyPlan === plan.id}
          disabled={chooseDisabled || busyPlan !== null || !canChoose(held, plan.id, period)}
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
  period,
  current,
  student,
  onVerifyStudent,
  onChoose,
  busy,
  disabled,
  tone,
}: {
  readonly plan: Plan;
  readonly period: BillingPeriod;
  readonly current: boolean;
  /** `null` for a plan anybody may buy. */
  readonly student: StudentStanding | null;
  readonly onVerifyStudent?: () => void;
  readonly onChoose?: () => void;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly tone: PlanTone;
}) {
  const t = useT();
  const price = priceFor(plan, period);
  const free = price !== null && isFreePrice(price.price);
  const skin = PLAN_SKIN[tone];
  const ink = TONES[tone];
  const action = cardAction({ sold: price !== null, student, onChoose, onVerifyStudent });
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
          <View style={styles.tags}>
            {student === null ? null : (
              <Tag label={t('mobile.pricing.student.tag')} testID={`pricing-student-${plan.code || plan.id}`} />
            )}
            {current ? <Tag label={t('pricing.held.currentTag')} testID="pricing-current" /> : null}
          </View>
        </View>
        {student === null ? null : (
          <Body tone="secondary" testID={`pricing-student-note-${plan.code || plan.id}`}>
            {t('mobile.pricing.student.needsCheck')}
          </Body>
        )}
        <View style={styles.limits}>
          {points.map((point) => (
            <View key={point} style={styles.limit}>
              <Icon icon={Glyphs.Add} size={18} color={ink.primary} />
              <Body style={styles.limitText}>{point}</Body>
            </View>
          ))}
        </View>
        {price === null ? (
          <Body tone="tertiary" testID={`pricing-not-offered-${plan.code || plan.id}`}>
            {t('mobile.pricing.notOffered', { period: t(PERIOD_NAME[period]) })}
          </Body>
        ) : (
          <View style={styles.priceRow}>
            <Text
              style={[styles.price, { color: ink.primary }]}
              // The hero figure stays on one line at a large font: "120.00 AZN" at 1.4x is wider
              // than a 360dp phone's card.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {free ? t('pricing.free') : formatMoney({ amount: price.price, currency: price.currency })}
            </Text>
            {free ? null : <Body tone="tertiary">{t(PER_PERIOD[period])}</Body>}
          </View>
        )}
        {action === 'choose' && onChoose !== undefined ? (
          <CardButton
            label={busy ? t('pricing.choosing') : t('pricing.choose')}
            accessibilityLabel={t('mobile.pricing.chooseNamed', { plan: plan.name })}
            skin={skin}
            busy={busy}
            disabled={disabled}
            onPress={onChoose}
            testID={`pricing-choose-${plan.code || plan.id}`}
          />
        ) : action === 'verify' && onVerifyStudent !== undefined ? (
          <CardButton
            label={t('mobile.pricing.student.verify')}
            skin={skin}
            busy={false}
            disabled={false}
            onPress={onVerifyStudent}
            testID={`pricing-verify-${plan.code || plan.id}`}
          />
        ) : action === 'pending' ? (
          <CardButton
            label={t('mobile.pricing.student.pending')}
            skin={skin}
            busy={false}
            disabled
            icon={Glyphs.Clock}
            onPress={() => undefined}
            testID={`pricing-pending-${plan.code || plan.id}`}
          />
        ) : null}
      </View>
    </SurfaceProvider>
  );
}

type CardAction = 'choose' | 'verify' | 'pending' | null;

/**
 * What a card's button does. A plan not sold for the period offers nothing; a student plan
 * follows the reader's check before it is ever a choice; anything else is the ordinary choice,
 * where the screen offers one.
 */
function cardAction({
  sold,
  student,
  onChoose,
  onVerifyStudent,
}: {
  readonly sold: boolean;
  readonly student: StudentStanding | null;
  readonly onChoose?: () => void;
  readonly onVerifyStudent?: () => void;
}): CardAction {
  if (!sold) return null;
  if (student === 'pending') return 'pending';
  if (student === 'unverified') return onVerifyStudent === undefined ? null : 'verify';
  if (student === 'unknown') return null;
  return onChoose === undefined ? null : 'choose';
}

function CardButton({
  label,
  accessibilityLabel,
  skin,
  busy,
  disabled,
  icon = Glyphs.ArrowRight,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly skin: (typeof PLAN_SKIN)[PlanTone];
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly icon?: IconGlyph;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      contentStyle={[styles.choose, { backgroundColor: skin.button, opacity: disabled || busy ? 0.4 : 1 }]}
      testID={testID}
    >
      {/* Two lines rather than an ellipsis for a long label at 1.4x on a 360dp phone. */}
      <Text style={[styles.chooseLabel, { color: skin.label }]} numberOfLines={2}>
        {label}
      </Text>
      <Icon icon={icon} size={20} color={skin.label} />
    </PressableScale>
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing[2], maxWidth: '50%' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing[1] },
  limits: { gap: spacing[2] },
  limit: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  limitText: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
