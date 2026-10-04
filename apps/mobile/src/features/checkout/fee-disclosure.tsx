import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { Body, CardTitle, TONES, useSurface } from '../../components/ui';
import { spacing } from '../../theme';
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
  const ink = TONES[useSurface() === 'white' ? 'white' : 'dark'];

  let body: ReactNode;
  let fixed: string | null = null;
  if (disclosure !== null && !disclosure.configured) {
    body = t('unconfigured');
  } else if (disclosure === null || disclosure.platformRate === null || disclosure.processingRate === null) {
    body = t.rich('unavailable', {
      pricing: (chunks) => (
        <Text accessibilityRole="link" onPress={onPricing} style={[styles.link, { color: ink.primary }]}>
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
      <CardTitle accessibilityRole="header">{t('backerHeading')}</CardTitle>
      <Body>{body}</Body>
      {fixed === null ? null : <Body>{fixed}</Body>}
    </View>
  );
}

/** A section of the checkout's white sheet: no block of its own, the sheet's ink. */
const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  link: { textDecorationLine: 'underline' },
});
