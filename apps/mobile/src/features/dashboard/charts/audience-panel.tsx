import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { dateTimeFormat } from '@ideanest/messages/formats';
import type { Locale } from '@ideanest/messages/locale';
import {
  Body,
  CardTitle,
  Caption,
  Chip,
  ChipRow,
  Icon,
  InlineAlert,
  Meta,
  Pill,
  PressableScale,
  Skeleton,
  SkeletonGroup,
  StatBlock,
  StatRow,
  TONES,
  useFocusRing,
  useSurface,
} from '../../../components/ui';
import { BLOCK, blockSurface } from '../../../components/ui/surface';
import { Glyphs } from '../../../icons';
import { formatCount, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../../theme';
import { countryName } from '../../checkout/format';
import type { PanelFailure, SectionState } from '../shared-charts-finance';
import {
  AUDIENCE_PERIODS,
  UNKNOWN_COUNTRY,
  countWidths,
  type Audience,
  type AudienceBucket,
  type AudiencePeriod,
  type AudiencePoint,
} from './audience';

/**
 * The Charts tab's audience panel — #636, the mobile half of the owner dashboard's audience block
 * (#632; the web's is #634).
 *
 * <p>A period filter (Daily · Weekly · Monthly · Yearly = `day|week|month|year`), then the
 * period's views and clicks beside the campaign's all-time views, a column chart of each, the
 * countries the views came from and the lists the clicks came from, and the note that people are
 * counted per day and summed.
 *
 * <h2>Why chips and not a segmented pill</h2>
 *
 * `SegmentedPill` gives every option an equal quarter of the row. At 360dp with the font at 1.4×,
 * "Həftəlik" needs about twice the quarter it would get and would be cut to "Həf…". The filter is
 * a `ChipRow` instead, as the inbox's: each chip as wide as its word, the row scrolling if four
 * long words ever do not fit, the chosen one the inverted pill and announced as selected.
 *
 * <h2>Two small charts, not one with two series</h2>
 *
 * Views and clicks are the same unit but an order of magnitude apart, and clicks drawn on the
 * views' axis would be a row of slivers. Two single-series charts on the same buckets need no
 * legend and no colour key — each is named by its heading — and colour carries nothing.
 *
 * <h2>Motion</h2>
 *
 * The columns do not grow in: like the funding trend, the figures are the point, and a chart
 * that animates on every period switch makes the reader wait for the answer they asked for. The
 * section rises with the rest of the panel's first screenful (`FadeUp` in `charts-panel.tsx`),
 * which honours Reduce Motion.
 */

export interface AudienceSectionProps {
  readonly state: SectionState<Audience>;
  readonly period: AudiencePeriod;
  readonly onPeriod: (period: AudiencePeriod) => void;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}

/** The two charts' placeholder while a period loads. */
const PLACEHOLDER = 220;

export function AudienceSection({ state, period, onPeriod, onRetry, retrying }: AudienceSectionProps) {
  const t = useT();
  return (
    <View style={styles.section} testID="audience">
      <View accessibilityRole="toolbar" accessibilityLabel={t('common.audience.periodLabel')} testID="audience-periods">
        <ChipRow>
          {AUDIENCE_PERIODS.map((option) => (
            <Chip
              key={option}
              label={t(`common.audience.period.${option}`)}
              selected={option === period}
              onPress={() => {
                if (option !== period) onPeriod(option);
              }}
              testID={`audience-period-${option}`}
            />
          ))}
        </ChipRow>
      </View>
      <AudienceBody state={state} onRetry={onRetry} retrying={retrying} />
    </View>
  );
}

function AudienceBody({ state, onRetry, retrying }: Omit<AudienceSectionProps, 'period' | 'onPeriod'>) {
  const t = useT();
  const locale = useLocale();

  if (state.kind === 'loading') {
    return (
      <SkeletonGroup label={t('mobile.audience.loading')} testID="audience-loading">
        <Skeleton height={PLACEHOLDER} radius="lg" />
      </SkeletonGroup>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <InlineAlert
        variant="danger"
        description={state.kind === 'unreachable' ? t('mobile.offline.nothingCached') : t(FAILURE_WORDS[state.failure])}
        action={<Pill size="sm" variant="ghost" label={t('common.tryAgain')} busy={retrying} onPress={onRetry} />}
        testID="audience-failed"
      />
    );
  }

  const audience = state.data;
  const countries = audience.countries.map((row) => ({
    key: row.country,
    label: row.country === UNKNOWN_COUNTRY ? t('common.audience.unknownCountry') : countryName(row.country, locale),
    value: row.views,
    figures: `${t('common.audience.views')} ${formatCount(row.views, locale)} · ${t('common.audience.clicks')} ${formatCount(row.clicks, locale)}`,
  }));
  const surfaces = audience.surfaces.map((row) => ({
    key: row.surface,
    label: t(`common.audience.surface.${row.surface}`),
    value: row.clicks,
    figures: `${t('common.audience.clicks')} ${formatCount(row.clicks, locale)}`,
  }));

  return (
    <View style={styles.body} testID="audience-ready">
      <StatRow>
        <StatBlock size="md" label={t('common.audience.views')} value={formatCount(audience.views, locale)} testID="audience-views" />
        <StatBlock size="md" label={t('common.audience.clicks')} value={formatCount(audience.clicks, locale)} testID="audience-clicks" />
        <StatBlock
          size="md"
          label={t('mobile.audience.allTimeViews')}
          value={formatCount(audience.allTimeViews, locale)}
          testID="audience-all-time"
        />
      </StatRow>

      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('common.audience.views')}</CardTitle>
        <Columns audience={audience} pick="views" label={t('common.audience.views')} />
      </View>
      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('common.audience.clicks')}</CardTitle>
        <Columns audience={audience} pick="clicks" label={t('common.audience.clicks')} />
      </View>
      <Figures audience={audience} />

      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('common.audience.countries')}</CardTitle>
        {countries.length === 0 ? (
          <Body testID="audience-countries-empty">{t('mobile.audience.countriesEmpty')}</Body>
        ) : (
          <CountBars rows={countries} label={t('mobile.audience.countriesLabel')} testID="audience-countries" />
        )}
      </View>

      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('mobile.audience.surfacesHeading')}</CardTitle>
        {surfaces.length === 0 ? (
          <Body testID="audience-surfaces-empty">{t('mobile.audience.surfacesEmpty')}</Body>
        ) : (
          <CountBars rows={surfaces} label={t('mobile.audience.surfacesLabel')} testID="audience-surfaces" />
        )}
      </View>

      <Caption testID="audience-note">{t('common.audience.dailySumNote')}</Caption>
    </View>
  );
}

/** The words for a read that failed: the dashboard's for its shared refusals, the panel's own otherwise. */
const FAILURE_WORDS = {
  signedOut: 'dashboard.failures.signedOut',
  notGranted: 'mobile.audience.notGranted',
  noCampaign: 'dashboard.failures.noCampaign',
  unavailable: 'mobile.audience.unavailable',
} as const satisfies Record<PanelFailure, string>;

const BUCKET_FORMAT: Record<AudienceBucket, Intl.DateTimeFormatOptions> = {
  HOUR: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  DAY: { day: 'numeric', month: 'short' },
  MONTH: { month: 'short', year: 'numeric' },
};

/**
 * A bucket's start in the reader's language and the service's zone (Baku): "14:00", "7 Nov",
 * "Nov 2026". Read in the response's `timeZone`, never the phone's, so a reader abroad sees the
 * same hours as the service counted.
 */
export function formatBucket(start: string, bucket: AudienceBucket, timeZone: string, locale: Locale): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return start;
  try {
    return dateTimeFormat(locale, { ...BUCKET_FORMAT[bucket], timeZone }, `audience-${bucket}-${timeZone}`).format(at);
  } catch {
    return start;
  }
}

/** The plot's height, its fallback width before layout, and the gap between columns. */
const PLOT_HEIGHT = 96;
const FALLBACK_WIDTH = 320;
const GAP = 2;

/**
 * One series as columns over every bucket of the period, zeros included as empty slots on the
 * baseline. Hidden from assistive technology and named by one sentence; the figures disclosure
 * below is the accessible data.
 */
function Columns({ audience, pick, label }: { readonly audience: Audience; readonly pick: 'views' | 'clicks'; readonly label: string }) {
  const t = useT();
  const locale = useLocale();
  const [width, setWidth] = useState(0);
  const points = audience.series;
  const values = points.map((point) => point[pick]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = values.reduce((most, value) => Math.max(most, value), 0);
  const peakAt = points[values.indexOf(peak)];
  const first = points[0];
  const last = points[points.length - 1];
  const when = (point: AudiencePoint | undefined) =>
    point === undefined ? '' : formatBucket(point.start, audience.bucket, audience.timeZone, locale);

  const range = { label, from: when(first), to: when(last) };
  const summary =
    total === 0
      ? t('mobile.audience.chartEmpty', range)
      : t('mobile.audience.chartSummary', {
          ...range,
          total: formatCount(total, locale),
          peak: formatCount(peak, locale),
          when: when(peakAt),
        });

  const box = width > 0 ? width : FALLBACK_WIDTH;
  const count = Math.max(1, values.length);
  const column = Math.max(1, (box - GAP * (count - 1)) / count);
  const baseline = PLOT_HEIGHT - 1;

  return (
    <View style={styles.figure}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        style={styles.chart}
        testID={`audience-${pick}-chart`}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fill}>
          <Svg width="100%" height={PLOT_HEIGHT} viewBox={`0 0 ${box} ${PLOT_HEIGHT}`}>
            <Line x1={0} y1={baseline} x2={box} y2={baseline} stroke={colors.borderStrong} strokeWidth={1} />
            {values.map((value, index) => {
              if (value <= 0 || peak <= 0) return null;
              const height = Math.max(2, (value / peak) * (baseline - 2));
              return (
                <Rect
                  key={points[index]?.start ?? index}
                  x={index * (column + GAP)}
                  y={baseline - height}
                  width={column}
                  height={height}
                  rx={Math.min(2, column / 2)}
                  fill={colors.textPrimary}
                  testID={`audience-${pick}-column`}
                />
              );
            })}
          </Svg>
        </View>
      </View>
      <View style={styles.captions}>
        <Caption>{range.from}</Caption>
        <Caption>{range.to}</Caption>
      </View>
    </View>
  );
}

/** "Show the figures": every bucket's views and clicks as a list, the charts' accessible data. */
function Figures({ audience }: { readonly audience: Audience }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { ring, onFocus, onBlur } = useFocusRing();
  const label = t(open ? 'mobile.audience.hideFigures' : 'mobile.audience.showFigures');
  const views = t('common.audience.views');
  const clicks = t('common.audience.clicks');

  return (
    <View style={styles.section}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        onFocus={onFocus}
        onBlur={onBlur}
        contentStyle={[styles.toggle, ring]}
        testID="audience-figures-toggle"
      >
        <Body>{label}</Body>
        <Icon icon={open ? Glyphs.ArrowUp2 : Glyphs.ArrowDown2} size={18} color={TONES.dark.secondary} />
      </PressableScale>
      {open ? (
        <View accessibilityRole="list" accessibilityLabel={t('mobile.audience.figuresLabel')} style={styles.rows}>
          {audience.series.map((point) => {
            const when = formatBucket(point.start, audience.bucket, audience.timeZone, locale);
            const line = `${views} ${formatCount(point.views, locale)} · ${clicks} ${formatCount(point.clicks, locale)}`;
            return (
              <View
                key={point.start}
                accessible
                accessibilityLabel={`${when}, ${line}`}
                style={styles.row}
                testID="audience-figure"
              >
                <Meta tone="secondary" style={styles.rowLabel}>
                  {when}
                </Meta>
                <Text style={styles.value}>{line}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface CountRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly figures: string;
}

/**
 * One bar per country or list — `ShareBars`' look and rule (widths against the largest, two
 * percent floor, still), for counts rather than money. Each row's words are its accessible
 * statement; the bar repeats them and is hidden.
 */
function CountBars({ rows, label, testID }: { readonly rows: readonly CountRow[]; readonly label: string; readonly testID: string }) {
  const surface = useSurface();
  const block = BLOCK[blockSurface(surface)];
  const widths = countWidths(rows.map((row) => row.value));

  return (
    <View accessibilityRole="list" accessibilityLabel={label} style={styles.list} testID={testID}>
      {rows.map((row, index) => (
        <View key={row.key} accessible accessibilityLabel={`${row.label}, ${row.figures}`} style={styles.bars} testID={`${testID}-${row.key}`}>
          <View style={styles.words}>
            <Body tone="primary" style={styles.label}>
              {row.label}
            </Body>
            <Text style={[styles.figures, { color: TONES[surface].secondary }]}>{row.figures}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: block.track }]}>
            <View style={[styles.bar, { width: `${widths[index] ?? 0}%`, backgroundColor: TONES[surface].primary }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  body: { gap: spacing[6] },
  figure: { gap: spacing[2] },
  chart: { height: PLOT_HEIGHT, width: '100%' },
  fill: { flex: 1 },
  captions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing[4] },
  toggle: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    borderRadius: radius.full,
  },
  rows: { gap: spacing[2] },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: BLOCK.dark.rest,
  },
  rowLabel: { flexShrink: 1 },
  value: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  list: { gap: spacing[3] },
  bars: { gap: spacing[2] },
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
