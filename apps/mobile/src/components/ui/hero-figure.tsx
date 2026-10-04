import { StyleSheet } from 'react-native';
import { formatMoney } from '@ideanest/money/format';
import { font, fontSize, lineHeight, tracking } from '../../theme';
import { AnimatedAmount, type AnimatedAmountMode } from './animated-amount';
import { TONES, useSurface } from './surface';

/**
 * The one large number on a screen — issue #277, `mobile-design` skill §2.
 *
 * Formatted by `@ideanest/money` from the wire string, never from a float. The major units are
 * large in the surface's primary tone; the minor units and the currency after them about half the
 * size in its tertiary tone, on the same baseline. It moves through {@link AnimatedAmount}: a roll
 * when the value changes, or a count-up on first view.
 */

export type HeroFigureSize = 'md' | 'lg';

export interface HeroFigureProps {
  readonly money: { readonly amount: string; readonly currency: string };
  readonly size?: HeroFigureSize;
  readonly mode?: AnimatedAmountMode;
  /** Said before the amount: "Raised", "Your pledge". */
  readonly label?: string;
  readonly testID?: string;
}

const MAJOR: Record<HeroFigureSize, { fontSize: number; lineHeight: number; letterSpacing: number }> = {
  lg: { fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: tracking.display },
  md: { fontSize: fontSize.h1, lineHeight: lineHeight.h1, letterSpacing: tracking.h1 },
};

const MINOR: Record<HeroFigureSize, { fontSize: number; letterSpacing: number }> = {
  lg: { fontSize: fontSize.h3, letterSpacing: tracking.h3 },
  md: { fontSize: fontSize.base, letterSpacing: tracking.body },
};

/** Where the minor units start in a `formatMoney` string: its decimal point. */
export function minorStart(formatted: string): number {
  const point = formatted.indexOf('.');
  return point === -1 ? formatted.length : point;
}

export function HeroFigure({ money, size = 'lg', mode = 'roll', label, testID }: HeroFigureProps) {
  const surface = useSurface();
  const formatted = formatMoney(money);
  return (
    <AnimatedAmount
      value={formatted}
      mode={mode}
      minorFrom={minorStart(formatted)}
      style={[styles.major, MAJOR[size], { color: TONES[surface].primary }]}
      minorStyle={[styles.minor, MINOR[size], { color: TONES[surface].tertiary }]}
      accessibilityLabel={label === undefined ? formatted : `${label}, ${formatted}`}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  major: { ...font.semibold },
  minor: { ...font.medium },
});
