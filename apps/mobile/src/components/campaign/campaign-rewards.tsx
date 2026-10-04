import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney } from '@ideanest/money';
import { Glyphs } from '../../icons';
import type { RewardTier } from '../../lib/campaign-page';
import { checkoutHref } from '../../lib/campaign-actions';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { toneColor } from '../text';
import { Icon, Pill, PressableScale, SurfaceProvider, TONES, haptics, useSurface } from '../ui';
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
  const router = useRouter();
  const surface = useSurface();
  if (tiers.length === 0) return null;

  return (
    <View style={styles.section} testID="campaign-rewards">
      <Text accessibilityRole="header" style={[styles.heading, { color: TONES[surface].primary }]}>
        {t('heading')}
      </Text>
      {tiers.map((tier) => {
        const soldOut = tier.remainingQuantity === 0;
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
            {tier.description === null ? null : (
              <TierLine kind="reading">{tier.description}</TierLine>
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
  select: { marginTop: spacing[2], alignItems: 'flex-start' },
});
