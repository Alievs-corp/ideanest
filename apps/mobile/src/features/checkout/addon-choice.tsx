import { StyleSheet, View } from 'react-native';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import { isSoldOut, type PublicReward } from '@ideanest/checkout/types';
import { Body, Card, CardTitle, IconButton } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { size, spacing } from '../../theme';

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
      <CardTitle accessibilityRole="header">{t('heading')}</CardTitle>
      <Body>{t('intro')}</Body>
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
    <Card size="sm" style={[styles.card, soldOut && styles.disabled]} testID={`addon-${addon.id}`}>
      <View style={styles.titleRow}>
        <CardTitle style={styles.title}>{addon.title}</CardTitle>
        <CardTitle style={styles.price}>{formatMoney(addon.price)}</CardTitle>
      </View>
      {addon.description == null || addon.description === '' ? null : <Body>{addon.description}</Body>}
      {soldOut ? (
        <Body>{t('checkout.addons.soldOut')}</Body>
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
            <CardTitle style={styles.price}>{value}</CardTitle>
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
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[3] },
  card: { gap: spacing[2] },
  disabled: { opacity: 0.56 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], flexWrap: 'wrap' },
  title: { flexShrink: 1 },
  price: { fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  value: { minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: 'center', justifyContent: 'center' },
});
