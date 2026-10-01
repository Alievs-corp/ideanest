import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney } from '@ideanest/money';
import type { RewardTier } from '../../lib/campaign-page';
import { checkoutHref } from '../../lib/campaign-actions';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing, tracking } from '../../theme';
import { Pill, haptics } from '../ui';

/**
 * Block 13 — the web's `CampaignRewards` (#155), below the tab content on every tab, as the web
 * lays it out on a phone.
 *
 * <p>One card per tier: the price, the title, the description, and for a limited tier how many
 * places are left or that it is sold out — in words, because "6 left" in one colour and "sold out"
 * in another would be colour carrying the difference alone. A tier with no limit says nothing
 * about stock, as on the web.
 *
 * <p>"Select this reward" only where it can be acted on: the campaign takes pledges
 * (`acceptsPledges`, decided by the caller) and the tier is not sold out. Its accessible name
 * names the tier, because a list of buttons all called "Select this reward" is a list nobody can
 * tell apart. It opens the checkout on that tier (`checkoutHref`: the app's checkout route, which
 * hands over to the web's until #157).
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
  const router = useRouter();
  if (tiers.length === 0) return null;

  return (
    <View style={styles.section} testID="campaign-rewards">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('heading')}
      </Text>
      {tiers.map((tier) => {
        const soldOut = tier.remainingQuantity === 0;
        return (
          <View key={tier.id} style={styles.card} testID={`reward-${tier.id}`}>
            <Text style={styles.price}>{formatMoney(tier.price)}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {tier.title}
            </Text>
            {tier.description === null ? null : (
              <Text style={styles.description}>{tier.description}</Text>
            )}
            {tier.remainingQuantity === null ? null : (
              <Text style={styles.stock}>
                {soldOut ? t('soldOut') : t('remaining', { count: tier.remainingQuantity })}
              </Text>
            )}
            {pledgeable && !soldOut ? (
              <View style={styles.select}>
                <Pill
                  label={t('select')}
                  accessibilityLabel={t('selectNamed', { title: tier.title })}
                  variant="outline"
                  onPress={() => {
                    haptics.selectReward();
                    router.push(checkoutHref(projectId, tier.id));
                  }}
                  testID={`reward-select-${tier.id}`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
    color: colors.textPrimary,
  },
  card: {
    gap: spacing[2],
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  price: {
    ...font.semibold,
    fontSize: fontSize.h2,
    lineHeight: lineHeight.h2,
    letterSpacing: tracking.h2,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  title: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
  description: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textReading,
  },
  stock: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  select: { marginTop: spacing[1] },
});
