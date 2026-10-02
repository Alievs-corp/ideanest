import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ban } from 'lucide-react-native';
import { formatMoney } from '@ideanest/money';
import { NO_REWARD } from '@ideanest/checkout/draft';
import { isSoldOut, type PublicReward } from '@ideanest/checkout/types';
import { Icon, useFocusRing } from '../../components/ui';
import { formatWindowDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';

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
      <Text accessibilityRole="header" style={styles.legend}>
        {t('legend')}
      </Text>
      <Text style={styles.hint}>{t('hint')}</Text>
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
  const { ring, onFocus, onBlur } = useFocusRing();
  const disabled = soldOut !== null || locked;
  const spoken = [title, price, ...tags, soldOut].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={spoken}
      accessibilityHint={lines.join('. ')}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => onSelect(value)}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={`reward-option-${value}`}
      style={[styles.card, selected && styles.selected, disabled && styles.disabled, ring]}
    >
      <View style={[styles.circle, selected ? styles.circleOn : styles.circleOff]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {price === undefined ? null : <Text style={styles.price}>{price}</Text>}
        </View>
        {tags.length === 0 ? null : <Text style={styles.tags}>{tags.join(' · ')}</Text>}
        {lines.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}
        {soldOut === null ? null : (
          <View style={styles.soldOut}>
            <Icon icon={Ban} size={16} color={colors.textSecondary} />
            <Text style={styles.line}>{soldOut}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const CONTROL = 20;

const styles = StyleSheet.create({
  group: { gap: spacing[3] },
  legend: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textPrimary },
  hint: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textSecondary },
  card: {
    flexDirection: 'row',
    gap: spacing[3],
    minHeight: 44,
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  selected: { backgroundColor: colors.surface4, borderColor: colors.borderStrong },
  disabled: { opacity: 0.56 },
  circle: {
    width: CONTROL,
    height: CONTROL,
    marginTop: 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOff: { backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.borderStrong },
  circleOn: { backgroundColor: colors.lime500 },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.textOnLime },
  body: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], flexWrap: 'wrap' },
  title: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textPrimary, flexShrink: 1 },
  price: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  tags: { ...font.medium, fontSize: fontSize.xs, lineHeight: lineHeight.small, color: colors.textSecondary },
  line: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textSecondary },
  soldOut: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
