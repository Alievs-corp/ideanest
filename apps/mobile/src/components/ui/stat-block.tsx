import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, radius, spacing } from '../../theme';
import { AnimatedAmount, type AnimatedAmountMode } from './animated-amount';
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
  up: { icon: Glyphs.ArrowUp, background: colors.lime500, text: colors.textOnLime, key: 'change.up' },
  down: {
    icon: Glyphs.ArrowDown,
    background: colors.danger,
    text: colors.textOnDanger,
    key: 'change.down',
  },
  neutral: {
    icon: Glyphs.ArrowRight,
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
  /**
   * The figure's colour. `success` is a goal that has been met — the campaign page's funded
   * percent (#155) — and only on the dark surface, where it reads; the label beside it says the
   * same thing in words, so the hue is never the only signal.
   */
  readonly tone?: 'default' | 'success';
  /** A glyph before the figure (`Users` before a backer count). Decorative: the label names it. */
  readonly icon?: IconComponent;
  /** Moves the figure through `AnimatedAmount` (#278): `count` on first view, then rolls. */
  readonly motion?: AnimatedAmountMode;
  readonly testID?: string;
}

export function StatBlock({
  value,
  label,
  badge,
  badgeTone = 'up',
  size = 'lg',
  tone = 'default',
  icon,
  motion,
  testID,
}: StatBlockProps) {
  const t = useT('mobile.kitDisplay');
  const surface = useSurface();
  const points = VALUE_SIZE[size];
  const trend = TREND[badgeTone];
  const figure = {
    fontSize: points,
    lineHeight: points,
    letterSpacing: points * -0.04,
    color: tone === 'success' && surface === 'dark' ? colors.success : TONES[surface].primary,
  };

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.figureRow}>
        {icon === undefined ? null : (
          <View style={[styles.glyph, { height: points }]}>
            <Icon icon={icon} size={20} color={TONES[surface].tertiary} />
          </View>
        )}
        {motion === undefined ? (
          <Text style={[styles.value, figure]}>{value}</Text>
        ) : (
          <AnimatedAmount value={value} mode={motion} style={[styles.value, figure]} />
        )}
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
  // A long figure wraps the badge onto the next line and shrinks to the column rather than running
  // off it. Never truncated: an ellipsis in the middle of a sum of money is a different sum.
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 },
  value: { ...font.semibold, fontVariant: ['tabular-nums'], flexShrink: 1 },
  glyph: { justifyContent: 'center', marginRight: 2 },
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
