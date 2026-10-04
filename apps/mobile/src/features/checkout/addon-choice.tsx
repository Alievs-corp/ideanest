import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import { isSoldOut, type PublicReward } from '@ideanest/checkout/types';
import { IconButton } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';

export const ADDON_DISPLAY_CAP = 10;

export function addonMaximum(addon: PublicReward): number {
  return addon.remainingQuantity == null ? ADDON_DISPLAY_CAP : Math.min(addon.remainingQuantity, ADDON_DISPLAY_CAP);
}

export interface AddonChoiceProps {
  readonly addons: readonly PublicReward[];
  readonly quantity: (rewardId: string) => number;
  readonly onChange: (rewardId: string, quantity: number) => void;
  readonly disabled?: boolean;
}

export function AddonChoice({ addons, quantity, onChange, disabled = false }: AddonChoiceProps) {
  const t = useT('checkout.addons');
  if (addons.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('heading')}
      </Text>
      <Text style={styles.muted}>{t('intro')}</Text>
      {addons.map((addon) => (
        <AddonCard key={addon.id} addon={addon} value={quantity(addon.id)} onChange={onChange} disabled={disabled} />
      ))}
    </View>
  );
}

function AddonCard({
  addon,
  value,
  onChange,
  disabled,
}: {
  readonly addon: PublicReward;
  readonly value: number;
  readonly onChange: (rewardId: string, quantity: number) => void;
  readonly disabled: boolean;
}) {
  const t = useT();
  const soldOut = isSoldOut(addon);
  const max = addonMaximum(addon);
  const set = (next: number) => {
    if (!disabled) onChange(addon.id, Math.max(0, Math.min(max, next)));
  };
  return (
    <View style={[styles.card, soldOut && styles.disabled]} testID={`addon-${addon.id}`}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{addon.title}</Text>
        <Text style={styles.price}>{formatMoney(addon.price)}</Text>
      </View>
      {addon.description == null || addon.description === '' ? null : (
        <Text style={styles.muted}>{addon.description}</Text>
      )}
      {soldOut ? (
        <Text style={styles.muted}>{t('checkout.addons.soldOut')}</Text>
      ) : (
        <View style={styles.stepper}>
          <IconButton
            icon={Glyphs.Minus}
            size="lg"
            label={t('mobile.checkout.decrease', { title: addon.title })}
            disabled={disabled || value <= 0}
            onPress={() => set(value - 1)}
            testID={`addon-decrease-${addon.id}`}
          />
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${t('checkout.addons.quantity')}: ${addon.title}`}
            accessibilityValue={{ min: 0, max, now: value }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) =>
              set(event.nativeEvent.actionName === 'increment' ? value + 1 : value - 1)
            }
            style={styles.value}
            testID={`addon-quantity-${addon.id}`}
          >
            <Text style={styles.count}>{value}</Text>
          </View>
          <IconButton
            icon={Glyphs.Add}
            size="lg"
            label={t('mobile.checkout.increase', { title: addon.title })}
            disabled={disabled || value >= max}
            onPress={() => set(value + 1)}
            testID={`addon-increase-${addon.id}`}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[3] },
  heading: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textPrimary },
  muted: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textSecondary },
  card: {
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  disabled: { opacity: 0.56 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], flexWrap: 'wrap' },
  title: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textPrimary, flexShrink: 1 },
  price: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  value: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  count: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
