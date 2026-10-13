import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Locale } from '@ideanest/messages/locale';
import {
  blocksChoice,
  isFreePrice,
  isHeldPlan,
  standingOf,
  type HeldSubscription,
  type Plan,
} from '@ideanest/plans/catalogue';
import { Glyphs } from '../../icons';
import { formatDay, useT, type Translate } from '../../lib/i18n';
import { colors, spacing } from '../../theme';
import {
  Body,
  Card,
  CardTitle,
  Eyebrow,
  Heading,
  Icon,
  InlineAlert,
  Pill,
  Tag,
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
 * <p>Plan choices are white `primary` pills, not lime: the kit allows at most one accent per screen,
 * and a choice between plans is not "act now". The held plan's pill is `ghost`.
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
  return (
    <Card testID="pricing-held">
      <View style={styles.stack}>
        <Eyebrow accessibilityRole="header">{t('pricing.held.heading')}</Eyebrow>
        <InlineAlert
          // A renewal that is due is something to do, like a pending plan: never a green tick.
          variant={isRenewing(held) ? 'warning' : STANDING_VARIANT[standing]}
          title={describeHeld(held, t, locale)}
          description={heldDetail(held, t, locale)}
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
        {onCancel !== undefined && standing === 'active' ? (
          <View style={styles.start}>
            <Pill
              label={cancelling ? t('pricing.held.cancelling') : t('pricing.held.cancel')}
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
  const blocked = blocksChoice(held);
  return (
    <View style={styles.cards} testID="pricing-plans">
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          current={isHeldPlan(held, plan.id)}
          onChoose={onChoose === undefined ? undefined : () => onChoose(plan)}
          busy={busyPlan === plan.id}
          disabled={chooseDisabled || busyPlan !== null || blocked}
        />
      ))}
    </View>
  );
}

function PlanCard({
  plan,
  current,
  onChoose,
  busy,
  disabled,
}: {
  readonly plan: Plan;
  readonly current: boolean;
  readonly onChoose?: () => void;
  readonly busy: boolean;
  readonly disabled: boolean;
}) {
  const t = useT();
  const free = isFreePrice(plan.price);
  return (
    <Card testID={`pricing-plan-${plan.code || plan.id}`}>
      <View style={styles.stack}>
        <View style={styles.nameRow}>
          <CardTitle style={styles.name}>{plan.name}</CardTitle>
          {current ? <Tag label={t('pricing.held.currentTag')} testID="pricing-current" /> : null}
        </View>
        <View style={styles.priceRow}>
          <Heading>{free ? t('pricing.free') : formatMoney({ amount: plan.price, currency: plan.currency })}</Heading>
          {free ? null : (
            <Body>{plan.billingPeriod === 'YEARLY' ? t('pricing.perYear') : t('pricing.perMonth')}</Body>
          )}
        </View>
        {plan.description == null ? null : <Body>{plan.description}</Body>}
        <View style={styles.limits}>
          <Limit
            text={
              plan.maxActiveCampaigns == null
                ? t('pricing.limits.campaignsUnlimited')
                : t('pricing.limits.campaigns', { count: String(plan.maxActiveCampaigns) })
            }
          />
          <Limit
            text={
              plan.goalCeiling == null
                ? t('pricing.limits.goalUnlimited')
                : t('pricing.limits.goalCeiling', {
                    amount: formatMoney({ amount: plan.goalCeiling, currency: plan.currency }),
                  })
            }
          />
        </View>
        {onChoose === undefined ? null : (
          <View style={styles.start}>
            <Pill
              label={busy ? t('pricing.choosing') : t('pricing.choose')}
              accessibilityLabel={t('mobile.pricing.chooseNamed', { plan: plan.name })}
              variant={current ? 'ghost' : 'primary'}
              busy={busy}
              disabled={disabled}
              onPress={onChoose}
              testID={`pricing-choose-${plan.code || plan.id}`}
            />
          </View>
        )}
      </View>
    </Card>
  );
}

/** A limit is a fact, so the tick beside it is decoration: the words carry it. */
function Limit({ text }: { readonly text: string }) {
  return (
    <View style={styles.limit}>
      <Icon icon={Glyphs.TickCircle} size={18} color={colors.success} />
      <Body style={styles.limitText}>{text}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing[4] },
  stack: { gap: spacing[3] },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[3] },
  name: { flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing[1] },
  limits: { gap: spacing[2] },
  limit: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  limitText: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
