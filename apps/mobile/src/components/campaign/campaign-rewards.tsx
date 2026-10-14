import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney, type Money } from '@ideanest/money';
import type { RewardShipping } from '@ideanest/campaign/reward-details';
import { Glyphs } from '../../icons';
import type { RewardTier } from '../../lib/campaign-page';
import { checkoutHref } from '../../lib/campaign-actions';
import { formatDeliveryMonth, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { toneColor } from '../text';
import {
  Icon,
  Pill,
  PressableScale,
  SurfaceProvider,
  TONES,
  Tag,
  haptics,
  useSurface,
  type IconComponent,
} from '../ui';
import { BLOCK, blockSurface } from '../ui/surface';

/**
 * Block 13 — the web's `CampaignRewards` (#155), below the tab content on every tab, as the web
 * lays it out on a phone.
 *
 * <p>One raised card per tier (`mobile-design` skill §2: `whiteMuted` inside the page's white
 * content sheet, `surface2` on the canvas): the price, the title, the description, and for a
 * limited tier how many places are left or that it is sold out — in words, because "6 left" in one
 * colour and "sold out" in another would be colour carrying the difference alone. A tier with no
 * limit says nothing about stock, as on the web.
 *
 * <p>When it arrives and where it can go (#255), as the web's card says them: the checkout's early
 * bird and featured tags, the estimated delivery month, and one shipping line — how many countries
 * the creator has priced and the cheapest rate, or that nothing is shipped — each beside a
 * decorative Iconsax glyph (Calendar, Truck), the words carrying the meaning. Read by
 * `@ideanest/campaign/reward-details`, as the web reads them. Items and add-ons stay in the
 * checkout.
 *
 * <p>"Select this reward" only where it can be acted on: the campaign takes pledges
 * (`acceptsPledges`, decided by the caller) and the tier is not sold out. Its accessible name
 * names the tier, because a list of buttons all called "Select this reward" is a list nobody can
 * tell apart. It opens the checkout on that tier (`checkoutHref`: the app's checkout route, which
 * hands over to the web's until #157).
 *
 * <p>A selectable card is a press-scale surface too, because a thumb aims at the card, not at the
 * pill in its corner. The card is not an accessible element of its own: the pill is the one
 * control a screen reader meets, and the card's words stay readable one by one rather than being
 * swallowed into a button's name.
 *
 * <p>Drawn only when there is at least one tier; no images, as on the web.
 */
export interface CampaignRewardsProps {
  readonly projectId: string;
  readonly tiers: readonly RewardTier[];
  readonly pledgeable: boolean;
}

export function CampaignRewards({ projectId, tiers, pledgeable }: CampaignRewardsProps) {
  const t = useT('campaign.rewards');
  // The checkout's own words for the tags and the month, so the two screens agree.
  const tCheckout = useT('checkout.reward');
  const locale = useLocale();
  const router = useRouter();
  const surface = useSurface();
  if (tiers.length === 0) return null;

  /** The shipping line, or `null` for a shipped tier with nowhere priced yet. */
  const shippingLine = (shipping: RewardShipping, price: Money): string | null => {
    switch (shipping.kind) {
      case 'none':
        return t('shipping.none');
      case 'digital':
        return t('shipping.digital');
      case 'pickup':
        return t('shipping.pickup');
      case 'ships':
        return shipping.lowestRate === null
          ? t('shipping.shipsTo', { count: shipping.countries })
          : t('shipping.shipsToFrom', {
              count: shipping.countries,
              // A rate table is in the campaign's currency, which is the tier's.
              amount: formatMoney({ amount: shipping.lowestRate, currency: price.currency }),
            });
      case 'unpriced':
        return null;
    }
  };

  return (
    <View style={styles.section} testID="campaign-rewards">
      <Text accessibilityRole="header" style={[styles.heading, { color: TONES[surface].primary }]}>
        {t('heading')}
      </Text>
      {tiers.map((tier) => {
        const soldOut = tier.remainingQuantity === 0;
        const { details } = tier;
        const month =
          details.estimatedDelivery === null ? null : formatDeliveryMonth(details.estimatedDelivery, locale);
        const shipping = shippingLine(details.shipping, tier.price);
        const select =
          pledgeable && !soldOut
            ? () => {
                haptics.selectReward();
                router.push(checkoutHref(projectId, tier.id));
              }
            : null;
        return (
          <RewardCard key={tier.id} onSelect={select} testID={`reward-${tier.id}`}>
            <TierText price={formatMoney(tier.price)} title={tier.title} />
            {details.earlyBird || details.featured ? (
              <View style={styles.tags}>
                {details.earlyBird ? <Tag label={tCheckout('earlyBird')} /> : null}
                {details.featured ? <Tag label={tCheckout('featured')} /> : null}
              </View>
            ) : null}
            {tier.description === null ? null : (
              <TierLine kind="reading">{tier.description}</TierLine>
            )}
            {month === null ? null : (
              <View style={styles.stock}>
                <DetailIcon icon={Glyphs.Calendar} />
                <TierLine kind="secondary">{tCheckout('estimatedDelivery', { month })}</TierLine>
              </View>
            )}
            {shipping === null ? null : (
              <View style={styles.stock}>
                <DetailIcon icon={Glyphs.Truck} />
                <TierLine kind="secondary">{shipping}</TierLine>
              </View>
            )}
            {tier.remainingQuantity === null ? null : (
              <View style={styles.stock}>
                <TierIcon soldOut={soldOut} />
                <TierLine kind="secondary">
                  {soldOut ? t('soldOut') : t('remaining', { count: tier.remainingQuantity })}
                </TierLine>
              </View>
            )}
            {select === null ? null : (
              <View style={styles.select}>
                <Pill
                  label={t('select')}
                  accessibilityLabel={t('selectNamed', { title: tier.title })}
                  variant="primary"
                  size="sm"
                  onPress={select}
                  testID={`reward-select-${tier.id}`}
                />
              </View>
            )}
          </RewardCard>
        );
      })}
    </View>
  );
}

/** The card: a raised block, and a press-scale surface when the tier can be chosen. */
function RewardCard({
  onSelect,
  children,
  testID,
}: {
  readonly onSelect: (() => void) | null;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  const block = blockSurface(useSurface());
  const content = <SurfaceProvider surface={block}>{children}</SurfaceProvider>;
  if (onSelect === null) {
    return (
      <View style={[styles.card, { backgroundColor: BLOCK[block].rest }]} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      // The pill inside is the control a screen reader meets; the card is a bigger target for a
      // thumb, not a second stop.
      accessible={false}
      focusable={false}
      onPress={onSelect}
      contentStyle={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? BLOCK[block].pressed : BLOCK[block].rest },
      ]}
      testID={testID}
    >
      {content}
    </PressableScale>
  );
}

function TierText({ price, title }: { readonly price: string; readonly title: string }) {
  const tone = TONES[useSurface()];
  return (
    <>
      <Text style={[styles.price, { color: tone.primary }]}>{price}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: tone.primary }]}>
        {title}
      </Text>
    </>
  );
}

function TierLine({
  kind,
  children,
}: {
  readonly kind: 'reading' | 'secondary';
  readonly children: ReactNode;
}) {
  return <Text style={[styles.line, { color: toneColor(kind, useSurface()) }]}>{children}</Text>;
}

/** Decorative: the words beside it say when and where. */
function DetailIcon({ icon }: { readonly icon: IconComponent }) {
  return <Icon icon={icon} size={16} color={TONES[useSurface()].secondary} />;
}

/** Decorative: the words beside it say the stock. */
function TierIcon({ soldOut }: { readonly soldOut: boolean }) {
  return (
    <Icon
      icon={soldOut ? Glyphs.Slash : Glyphs.Box}
      size={16}
      color={TONES[useSurface()].secondary}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
  },
  card: {
    gap: spacing[2],
    minHeight: size.touchTarget,
    padding: size.cardPaddingSmall,
    borderRadius: radius.xl,
  },
  price: {
    ...font.semibold,
    fontSize: fontSize.h2,
    lineHeight: lineHeight.h2,
    letterSpacing: tracking.h2,
    fontVariant: ['tabular-nums'],
  },
  title: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
  },
  line: {
    ...font.regular,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  stock: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  select: { marginTop: spacing[2], alignItems: 'flex-start' },
});
