import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { TREND_CHART, polylinePoints, trendPoints, type Trend, type TrendDay } from '@ideanest/dashboard/analytics';
import { formatMoney } from '@ideanest/money';
import { Body, Caption, Icon, Meta, PressableScale, TONES, useFocusRing } from '../../../components/ui';
import { BLOCK } from '../../../components/ui/surface';
import { Glyphs } from '../../../icons';
import { formatCount, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../../theme';

/**
 * The funding trend — the web's `TrendChart`, drawn with `react-native-svg` from the shared
 * geometry (`@ideanest/dashboard/analytics`), so both clients plot the same points.
 *
 * <p>The drawing is hidden from assistive technology and named by one sentence (the range and
 * where it reached); the daily figures below it are the accessible data, as the web's table is.
 * The line is `textPrimary`, not lime: a trend is not urgent. Nothing animates — a stroke that
 * draws in delays the one thing the panel exists to show.
 */

const { width: BOX_WIDTH, height: BOX_HEIGHT, padding: BOX_PADDING } = TREND_CHART;
const LINE = 2;
const DOT = 4;

export function TrendChart({ trend }: { readonly trend: Trend }) {
  const t = useT();
  const [width, setWidth] = useState(0);
  const points = trendPoints(trend.days, trend.from, trend.to);
  const peak = trend.days[trend.days.length - 1];
  // The shared points are in the web's 720-wide box. Only the plot's width is stretched to the
  // screen, so the 2pt stroke and the 4pt dot stay round and the height stays the web's 220.
  const box = width > 0 ? width : BOX_WIDTH;
  const stretch = (box - BOX_PADDING * 2) / (BOX_WIDTH - BOX_PADDING * 2);
  const drawn = points.map((point) => ({ x: BOX_PADDING + (point.x - BOX_PADDING) * stretch, y: point.y }));
  // One day is a dot: a one-point line draws nothing.
  const dot = drawn.length === 1 ? drawn[0] : undefined;
  const right = box - BOX_PADDING;
  const baseline = BOX_HEIGHT - BOX_PADDING;

  const summary =
    peak === undefined
      ? ''
      : t('mobile.dashboardFigures.chartSummary', {
          from: trend.from,
          to: trend.to,
          amount: formatMoney(peak.cumulativeAmount),
        });

  return (
    <View style={styles.figure}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={styles.chart}
        testID="trend-chart"
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fill}>
          <Svg width="100%" height={BOX_HEIGHT} viewBox={`0 0 ${box} ${BOX_HEIGHT}`}>
            <Line
              x1={BOX_PADDING}
              y1={baseline}
              x2={right}
              y2={baseline}
              stroke={colors.borderStrong}
              strokeWidth={1}
            />
            {drawn.length > 1 ? (
              <Polyline
                points={polylinePoints(drawn)}
                fill="none"
                stroke={colors.textPrimary}
                strokeWidth={LINE}
                strokeLinejoin="round"
                strokeLinecap="round"
                testID="trend-line"
              />
            ) : null}
            {dot !== undefined ? (
              <Circle cx={dot.x} cy={dot.y} r={DOT} fill={colors.textPrimary} testID="trend-dot" />
            ) : null}
          </Svg>
        </View>
      </View>
      <View style={styles.captions}>
        <Caption>{t('dashboard.charts.trendLabel', { from: trend.from, to: trend.to, zone: trend.zone })}</Caption>
        {peak === undefined ? null : (
          <Caption tone="primary">
            {t('dashboard.trend.peak', { amount: formatMoney(peak.cumulativeAmount), day: peak.day })}
          </Caption>
        )}
      </View>
    </View>
  );
}

/**
 * "Show the daily figures": the web's folded table, as a disclosure and one card per day. A
 * 420-wide table does not fit a phone, and four columns of figures read better as a card's rows.
 */
export function DailyFigures({ days }: { readonly days: readonly TrendDay[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { ring, onFocus, onBlur } = useFocusRing();
  const label = t(open ? 'mobile.dashboardFigures.hideDaily' : 'dashboard.trend.showDaily');

  return (
    <View style={styles.daily}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        onFocus={onFocus}
        onBlur={onBlur}
        contentStyle={[styles.toggle, ring]}
        testID="daily-toggle"
      >
        <Body>{label}</Body>
        <Icon icon={open ? Glyphs.ArrowUp2 : Glyphs.ArrowDown2} size={18} color={TONES.dark.secondary} />
      </PressableScale>
      {open ? (
        <View accessibilityRole="list" accessibilityLabel={t('dashboard.trend.dailyLabel')} style={styles.days}>
          {days.map((day) => (
            <DayCard key={day.day} day={day} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DayCard({ day }: { readonly day: TrendDay }) {
  const t = useT('dashboard.trend');
  const locale = useLocale();
  const rows = [
    { key: 'backers', label: t('backers'), value: formatCount(day.pledgeCount, locale) },
    { key: 'pledged', label: t('pledged'), value: formatMoney(day.amount) },
    { key: 'runningTotal', label: t('runningTotal'), value: formatMoney(day.cumulativeAmount) },
  ];

  return (
    <View
      accessible
      accessibilityLabel={[`${t('day')} ${day.day}`, ...rows.map((row) => `${row.label} ${row.value}`)].join(', ')}
      style={styles.card}
      testID={`day-${day.day}`}
    >
      <Body tone="primary">{day.day}</Body>
      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <Meta tone="secondary" style={styles.rowLabel}>
            {row.label}
          </Meta>
          <Text style={[styles.value, row.key === 'runningTotal' ? styles.strong : null]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { gap: spacing[2] },
  chart: { height: BOX_HEIGHT, width: '100%' },
  fill: { flex: 1 },
  captions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing[4] },
  daily: { gap: spacing[3] },
  toggle: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    borderRadius: radius.full,
  },
  days: { gap: spacing[2] },
  card: {
    gap: spacing[1],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: BLOCK.dark.rest,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing[3] },
  rowLabel: { flexShrink: 1 },
  value: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  strong: { ...font.medium, color: colors.textPrimary },
});
