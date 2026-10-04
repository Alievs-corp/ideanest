import { StyleSheet, View } from 'react-native';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import { NO_REWARD } from '@ideanest/checkout/draft';
import { isSoldOut, type PublicReward } from '@ideanest/checkout/types';
import { Body, Card, CardTitle, Icon, Meta, TONES, useSurface } from '../../components/ui';
import { formatWindowDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { radius, spacing } from '../../theme';

export interface RewardChoiceProps {
  readonly rewards: readonly PublicReward[];
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

export function RewardChoice({ rewards, value, onChange, disabled = false }: RewardChoiceProps) {
  const t = useT('checkout.reward');
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('legend')} accessibilityHint={t('hint')} style={styles.group}>
      <CardTitle accessibilityRole="header">{t('legend')}</CardTitle>
      <Meta tone="secondary">{t('hint')}</Meta>
      <RewardCard
        value={NO_REWARD}
        selected={value === NO_REWARD}
        onSelect={onChange}
        title={t('none')}
        lines={[t('noneHint')]}
        locked={disabled}
      />
      {rewards.map((reward) => (
        <TierCard key={reward.id} reward={reward} selected={value === reward.id} onSelect={onChange} locked={disabled} />
      ))}
    </View>
  );
}

function TierCard({
  reward,
  selected,
  onSelect,
  locked,
}: {
  readonly reward: PublicReward;
  readonly selected: boolean;
  readonly onSelect: (value: string) => void;
  readonly locked: boolean;
}) {
  const t = useT('checkout.reward');
  const locale = useLocale();
  const soldOut = isSoldOut(reward);
  const tags = [reward.isEarlyBird ? t('earlyBird') : null, reward.isFeatured ? t('featured') : null].filter(
    (tag): tag is string => tag !== null,
  );
  const month = reward.estimatedDelivery == null ? null : formatWindowDate(reward.estimatedDelivery, locale);
  const delivery = {
    NONE: null,
    DIGITAL: t('digital'),
    LOCAL_PICKUP: t('inPerson'),
    DOMESTIC: t('postedDomestic'),
    INTERNATIONAL: t('postedWorldwide'),
  }[reward.shippingType];
  const stock =
    reward.limitQuantity == null || reward.remainingQuantity == null || soldOut
      ? null
      : t('left', { remaining: reward.remainingQuantity, limit: reward.limitQuantity });
  const lines = [
    reward.description ?? null,
    ...reward.items.map((item) => `${item.quantity} × ${item.name}${item.isDigital ? ` (${t('digitalItem')})` : ''}`),
    month === null ? null : t('estimatedDelivery', { month }),
    delivery,
    stock,
  ].filter((line): line is string => line !== null && line !== '');

  return (
    <RewardCard
      value={reward.id}
      selected={selected}
      onSelect={onSelect}
      title={reward.title}
      price={formatMoney(reward.price)}
      tags={tags}
      lines={lines}
      soldOut={soldOut ? t('soldOut') : null}
      locked={locked}
    />
  );
}

/**
 * One reward as a choice card (`mobile-design` skill §6.4): the kit's `Card`, so it takes the press
 * scale and the surface's block, with a radio mark that changes shape when chosen — a bold tick in
 * a ring outlined in the reading colour — so the choice is never carried by colour alone.
 */
function RewardCard({
  value,
  selected,
  onSelect,
  title,
  price,
  tags = [],
  lines,
  soldOut = null,
  locked = false,
}: {
  readonly value: string;
  readonly selected: boolean;
  readonly onSelect: (value: string) => void;
  readonly title: string;
  readonly price?: string;
  readonly tags?: readonly string[];
  readonly lines: readonly string[];
  readonly soldOut?: string | null;
  readonly locked?: boolean;
}) {
  const ink = TONES[useSurface() === 'white' ? 'white' : 'dark'];
  const disabled = soldOut !== null || locked;
  const spoken = [title, price, ...tags, soldOut].filter(Boolean).join(', ');
  return (
    <Card
      size="sm"
      accessibilityRole="radio"
      accessibilityLabel={spoken}
      accessibilityHint={lines.join('. ')}
      selected={selected}
      disabled={disabled}
      onPress={() => onSelect(value)}
      testID={`reward-option-${value}`}
      style={selected ? [styles.chosen, { outlineColor: ink.primary }] : undefined}
    >
      <View style={styles.row}>
        {selected ? (
          <Icon icon={Glyphs.TickCircle} variant="bold" size={CONTROL} color={ink.primary} />
        ) : (
          <View style={[styles.ring, { borderColor: ink.tertiary }]} />
        )}
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <CardTitle style={styles.title}>{title}</CardTitle>
            {price === undefined ? null : <CardTitle style={styles.price}>{price}</CardTitle>}
          </View>
          {tags.length === 0 ? null : <Meta tone="secondary">{tags.join(' · ')}</Meta>}
          {lines.map((line) => (
            <Body key={line}>{line}</Body>
          ))}
          {soldOut === null ? null : (
            <View style={styles.soldOut}>
              <Icon icon={Glyphs.Slash} size={16} color={ink.secondary} />
              <Body>{soldOut}</Body>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

const CONTROL = 20;

const styles = StyleSheet.create({
  group: { gap: spacing[3] },
  row: { flexDirection: 'row', gap: spacing[3] },
  chosen: { outlineWidth: 2, outlineStyle: 'solid' },
  ring: { width: CONTROL, height: CONTROL, marginTop: 2, borderRadius: radius.full, borderWidth: 1.5 },
  body: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], flexWrap: 'wrap' },
  title: { flexShrink: 1 },
  price: { fontVariant: ['tabular-nums'] },
  soldOut: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
