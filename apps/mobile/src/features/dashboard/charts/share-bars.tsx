import { StyleSheet, Text, View } from 'react-native';
import { shareWidths } from '@ideanest/dashboard/analytics';
import { formatMoney, type Money } from '@ideanest/money';
import { Body, TONES, useSurface } from '../../../components/ui';
import { BLOCK, blockSurface } from '../../../components/ui/surface';
import { pluralCategory, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { font, fontSize, lineHeight, radius, spacing } from '../../../theme';

/**
 * One bar per tier or destination — the web's `ShareBars`, widths from the shared
 * `shareWidths` (relative to the largest amount, two percent floor).
 *
 * <p>Plain Views with a percentage width, and still: the widths come from data already on screen,
 * and a bar that grew on mount would delay the reading. Each row's words are its accessible
 * statement; the bar repeats them and is hidden, so a row is not announced twice. On the white
 * sheet the track is the sheet's muted block and the fill its primary tone — white on white would
 * be no bar at all; neither is lime, because a tier selling well is not urgent.
 */

export interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly backerCount: number;
  readonly amount: Money;
}

export function ShareBars({ rows, label, testID }: { readonly rows: readonly ShareRow[]; readonly label: string; readonly testID?: string }) {
  const t = useT();
  const locale = useLocale();
  const surface = useSurface();
  const block = BLOCK[blockSurface(surface)];
  const widths = shareWidths(rows.map((row) => row.amount));

  return (
    <View accessibilityRole="list" accessibilityLabel={label} style={styles.list} testID={testID}>
      {rows.map((row, index) => {
        const count = t(`dashboard.charts.shareBackers.${pluralCategory(locale, row.backerCount)}`, {
          count: String(row.backerCount),
        });
        const amount = formatMoney(row.amount);
        return (
          <View key={row.key} accessible accessibilityLabel={`${row.label}, ${count} · ${amount}`} style={styles.row}>
            <View style={styles.words}>
              <Body tone="primary" style={styles.label}>
                {row.label}
              </Body>
              <Text style={[styles.figures, { color: TONES[surface].secondary }]}>
                {count} · <Text style={{ color: TONES[surface].primary }}>{amount}</Text>
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: block.track }]}>
              <View
                style={[styles.bar, { width: `${widths[index] ?? 0}%`, backgroundColor: TONES[surface].primary }]}
                testID={`${testID ?? 'share'}-bar-${row.key}`}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[3] },
  row: { gap: spacing[2] },
  words: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing[3],
  },
  label: { flexShrink: 1 },
  figures: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, fontVariant: ['tabular-nums'] },
  track: { height: spacing[2], borderRadius: radius.full, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: radius.full },
});
