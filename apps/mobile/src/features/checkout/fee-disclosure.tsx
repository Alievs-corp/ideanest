import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import type { FeeDisclosure as Disclosure } from './api';
import { percentOf } from './format';

export function FeeDisclosure({
  disclosure,
  onPricing,
}: {
  readonly disclosure: Disclosure | null;
  readonly onPricing: () => void;
}) {
  const t = useT('fees.disclosure');
  const locale = useLocale();

  let body: ReactNode;
  let fixed: string | null = null;
  if (disclosure !== null && !disclosure.configured) {
    body = t('unconfigured');
  } else if (disclosure === null || disclosure.platformRate === null || disclosure.processingRate === null) {
    body = t.rich('unavailable', {
      pricing: (chunks) => (
        <Text accessibilityRole="link" onPress={onPricing} style={styles.link}>
          {chunks}
        </Text>
      ),
    });
  } else {
    body = t('backerBody', {
      platform: percentOf(disclosure.platformRate, locale),
      processing: percentOf(disclosure.processingRate, locale),
    });
    fixed =
      disclosure.processingFixed !== null &&
      disclosure.currency !== null &&
      !new Decimal(disclosure.processingFixed).isZero()
        ? t('fixedFee', { amount: formatMoney({ amount: disclosure.processingFixed, currency: disclosure.currency }) })
        : null;
  }

  return (
    <View style={styles.section} testID="fee-disclosure">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('backerHeading')}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {fixed === null ? null : <Text style={styles.body}>{fixed}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing[2],
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  heading: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textPrimary },
  body: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textReading },
  link: { color: colors.textPrimary, textDecorationLine: 'underline' },
});
