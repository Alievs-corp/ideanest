import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney, type Money } from '@ideanest/money';
import type { PledgeAmounts } from '@ideanest/checkout/types';
import { FloatingPanel } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing, tint } from '../../theme';

export interface PledgeSummaryProps {
  readonly amounts: PledgeAmounts | null;
  readonly source: 'preview' | 'quoted';
  readonly rewardTitle: string | null;
  readonly destination: string | null;
  readonly waiting: 'empty' | 'pending';
  readonly children?: ReactNode;
}

function Line({ label, money }: { readonly label: string; readonly money: Money }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount}>{formatMoney(money)}</Text>
    </View>
  );
}

const shown = (money: Money) => !new Decimal(money.amount).isZero();

export function PledgeSummary({
  amounts,
  source,
  rewardTitle,
  destination,
  waiting,
  children,
}: PledgeSummaryProps) {
  const t = useT('checkout.summary');
  return (
    <FloatingPanel title={t('pledge')} testID="pledge-summary">
      <Text style={styles.muted}>
        {rewardTitle ?? t('noReward')}
        {destination === null ? '' : ` · ${t('to', { country: destination })}`}
      </Text>
      {amounts === null ? (
        <Text style={[styles.muted, styles.top]}>{t(waiting)}</Text>
      ) : (
        <View style={[styles.lines, styles.top]} testID={`summary-${source}`}>
          <Line label={rewardTitle === null ? t('yourSupport') : t('rewardLine')} money={amounts.base} />
          {shown(amounts.addons) ? <Line label={t('addons')} money={amounts.addons} /> : null}
          {shown(amounts.bonus) ? <Line label={t('bonus')} money={amounts.bonus} /> : null}
          {shown(amounts.shipping) ? <Line label={t('delivery')} money={amounts.shipping} /> : null}
          {shown(amounts.tax) ? <Line label={t('tax')} money={amounts.tax} /> : null}
          <View style={styles.rule} />
          <View style={styles.row}>
            <Text style={styles.totalLabel}>{t('total')}</Text>
            <Text style={styles.total} testID="summary-total">
              {formatMoney(amounts.total)}
            </Text>
          </View>
          <Text style={styles.source}>{source === 'preview' ? t('sourcePreview') : t('sourceQuoted')}</Text>
        </View>
      )}
      {children === undefined ? null : <View style={styles.actions}>{children}</View>}
    </FloatingPanel>
  );
}

const muted = tint(colors.textOnWhite, 0.64);

const styles = StyleSheet.create({
  top: { marginTop: spacing[4] },
  lines: { gap: spacing[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing[4], flexWrap: 'wrap' },
  label: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textOnWhite, flexShrink: 1 },
  amount: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textOnWhite,
    fontVariant: ['tabular-nums'],
  },
  muted: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: muted },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: tint(colors.black, 0.1), marginTop: spacing[1] },
  totalLabel: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body, color: colors.textOnWhite },
  total: {
    ...font.medium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    color: colors.textOnWhite,
    fontVariant: ['tabular-nums'],
  },
  source: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small, color: muted },
  actions: { marginTop: spacing[5], gap: spacing[3] },
});
