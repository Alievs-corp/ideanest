import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, radius, spacing } from '../../theme';
import { Icon, type IconComponent } from './icon';
import { TONES, useSurface } from './surface';

/**
 * A headline figure with its label and an optional change — the native `StatBlock` and `StatRow`
 * (`docs/ui-kit.md` §7.7).
 *
 * <p>The figure is semibold at -0.04em and **tabular**, so a row of them and a figure that changes
 * in place (`LiveFunding`) do not shuffle sideways as digits change. `lg` is 40, the floor of the
 * web's `clamp(2.5rem → 4rem)` — the theme's rule for every clamp (`fontSize` in `theme/index.ts`)
 * — and `md` is the web's 30.
 *
 * <h2>The change says its direction three ways</h2>
 *
 * The web's badge is lime for up, danger for down and surface-4 for neutral, and the colour is
 * all that tells "+3" from "−3" to somebody who cannot see it. Here the badge also carries an
 * arrow and its accessible name says the direction in words from the catalogue ("Up: 12%"), so
 * the hue is the third signal, not the only one (CLAUDE.md §2).
 *
 * <p>Up is a lime **surface** with on-lime text, never lime text. Lime means "act now", and a
 * rising figure on a dashboard is the one place the web spends it on good news; that is the web's
 * decision, carried over rather than re-made here.
 */

export type StatBlockSize = 'md' | 'lg';
export type StatTrend = 'up' | 'down' | 'neutral';

const VALUE_SIZE: Record<StatBlockSize, number> = { lg: fontSize.display, md: 30 };

const TREND: Record<
  StatTrend,
  { icon: IconComponent; background: string; text: string; key: `change.${StatTrend}` }
> = {
  up: { icon: ArrowUp, background: colors.lime500, text: colors.textOnLime, key: 'change.up' },
  down: {
    icon: ArrowDown,
    background: colors.danger,
    text: colors.textPrimary,
    key: 'change.down',
  },
  neutral: {
    icon: ArrowRight,
    background: colors.surface4,
    text: colors.textSecondary,
    key: 'change.neutral',
  },
};

export interface StatBlockProps {
  /** The figure, already formatted — money through `formatMoney`, never a float. */
  readonly value: string;
  /** What the figure is ("Backers"). */
  readonly label: string;
  /** The change, as the caller formats it: "+3", "12%". */
  readonly badge?: string;
  readonly badgeTone?: StatTrend;
  readonly size?: StatBlockSize;
  readonly testID?: string;
}

export function StatBlock({
  value,
  label,
  badge,
  badgeTone = 'up',
  size = 'lg',
  testID,
}: StatBlockProps) {
  const t = useT('mobile.kitDisplay');
  const surface = useSurface();
  const points = VALUE_SIZE[size];
  const trend = TREND[badgeTone];

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.figureRow}>
        <Text
          style={[
            styles.value,
            {
              fontSize: points,
              lineHeight: points,
              letterSpacing: points * -0.04,
              color: TONES[surface].primary,
            },
          ]}
        >
          {value}
        </Text>
        {badge === undefined || badge === '' ? null : (
          <View
            accessible
            accessibilityLabel={t(trend.key, { change: badge })}
            style={[styles.badge, { backgroundColor: trend.background }]}
            testID={testID === undefined ? undefined : `${testID}-badge`}
          >
            <Icon icon={trend.icon} size={11} color={trend.text} />
            <Text style={[styles.badgeText, { color: trend.text }]}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, { color: TONES[surface].secondary }]}>{label}</Text>
    </View>
  );
}

/** A row of headline figures that wraps, with the web's gaps: 40 between columns, 24 between rows. */
export function StatRow({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[1] },
  figureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  value: { ...font.semibold, fontVariant: ['tabular-nums'] },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing[1],
    minHeight: 20,
    paddingHorizontal: 7,
    borderRadius: radius.full,
  },
  badgeText: { ...font.semibold, fontSize: fontSize.xxs, fontVariant: ['tabular-nums'] },
  label: { ...font.regular, fontSize: fontSize.sm },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: spacing[10],
    rowGap: spacing[6],
  },
});
