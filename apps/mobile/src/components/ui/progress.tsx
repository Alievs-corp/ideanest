import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '../../lib/i18n';
import { colors, easing, motion, radius, spacing } from '../../theme';
import { Meta } from '../text';
import { useMotionAllowed } from './motion-budget';

/**
 * A campaign's funding progress — the native `ProgressBar` (`docs/ui-kit.md` §7.11), moved into
 * the kit from `components/progress.tsx`, which is gone: the screens import it from here.
 *
 * <h2>Lime means urgent. Success means achieved.</h2>
 *
 * CLAUDE.md §2 states it and this is the component where getting it wrong tells a backer the
 * opposite of the truth: a campaign still asking for money is lime, and one that reached its goal
 * is `success`, with the `limeGlow` halo §6 gives a funded bar. A single token swapped here turns
 * "hurry" into "done" on every card in the feed.
 *
 * <h2>Colour is never the only signal</h2>
 *
 * The percentage is printed under the bar in words that differ between the two states ("60%
 * funded", "100% — funded"), and the bar carries `accessibilityValue` with the catalogue's
 * "43 percent of the goal". Somebody who cannot tell lime from green, and somebody with a screen
 * reader, who sees no colour at all, read the same fact.
 *
 * <h2>The fill scales; it never changes width</h2>
 *
 * The fill is always the track's full width, and its `transform: scaleX` is the funded fraction,
 * scaled from the left edge (`transformOrigin`). `docs/motion-system.md` §8: only `transform` and
 * `opacity` animate, because `width` runs layout on every frame — and this is the most frequently
 * animated element on the platform. It rises from zero to the figure over `motion.progress` (§6's
 * 800ms, `ease-out`), wherever the motion budget allows `minimal` motion, which is everywhere but
 * checkout, the editor and settings (§5.1 keeps it even on discovery). With Reduce Motion or under
 * a `none` budget it is drawn at the figure and does not move.
 *
 * <p>The web bar translates rather than scales (issue #146), because a scaled fill squashes its
 * rounded leading edge at small percentages. Issue #151 asked the native bar for `scaleX`; at 6 and
 * 10pt the squashed end cap is under a point wide, which is the trade taken here.
 */

/**
 * The fill's test identifier. Exported rather than typed twice: a `testID` is also what Maestro
 * drives in the end-to-end suite, so it is a production affordance, not a hook a test bolted on.
 */
export const PROGRESS_FILL = 'progress-fill';

export type ProgressBarSize = 'sm' | 'md';

const HEIGHT: Record<ProgressBarSize, number> = { sm: 6, md: 10 };

export interface ProgressBarProps {
  /** Percent funded, as the API sends it: a decimal string, never a float. May exceed 100. */
  readonly completionPercent: string;
  /** What the bar measures, for the accessible name ("Funding progress for Solar Lamp"). */
  readonly label: string;
  readonly size?: ProgressBarSize;
  /**
   * Whether the "60% funded" line is drawn under the bar. Off where the figure is already printed
   * beside it; the bar still announces it either way.
   */
  readonly showLabel?: boolean;
  readonly testID?: string;
}

/** §6's funded halo: the web's `shadow-[0_0_12px_var(--lime-glow)]`, from the token. */
const FUNDED_GLOW = `0 0 12px ${colors.limeGlow}`;

const PERCENT = /^\d{1,6}(\.\d+)?$/;

/**
 * The drawn fraction, from 0 to 1: the bar is clamped and the label is not. A campaign at 340% has
 * earned the number; a bar drawn at 340% of its track is a layout bug. A value that is not a plain
 * decimal draws nothing rather than throwing — it arrives from the network, and a feed that crashes
 * on one malformed card is worse than one card showing zero.
 */
export function fillFraction(completionPercent: string): number {
  if (!PERCENT.test(completionPercent)) return 0;
  return Math.min(Number(completionPercent), 100) / 100;
}

/** Rounded for display. The exact figure is a percentage of somebody's money, not a score. */
function readablePercent(completionPercent: string): string {
  if (!PERCENT.test(completionPercent)) return '0';
  return String(Math.round(Number(completionPercent)));
}

export function ProgressBar({
  completionPercent,
  label,
  size = 'sm',
  showLabel = true,
  testID,
}: ProgressBarProps) {
  const t = useT();
  const fraction = fillFraction(completionPercent);
  const reached = fraction >= 1;
  const readable = readablePercent(completionPercent);

  return (
    <View
      style={styles.column}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(fraction * 100),
        text: t('common.card.progressLabel', { percent: readable }),
      }}
      testID={testID}
    >
      {/*
        The glow is on a wrapper outside the track, because the track clips its fill and would
        clip a shadow drawn by the fill as well. The web draws it on the fill inside an
        `overflow-hidden` track, where it is clipped away.
      */}
      <View style={[styles.track, { height: HEIGHT[size] }, reached && { boxShadow: FUNDED_GLOW }]}>
        <View style={styles.clip}>
          {/*
            Keyed by the figure, so a new figure is a new fill that rises from zero. A card in a
            recycled FlashList row keeps its component instance when it is handed another
            campaign, and a fill that kept its shared value would slide from the last campaign's
            80% down to this one's 12% — motion that reads as money leaving.
          */}
          <Fill
            key={String(fraction)}
            fraction={fraction}
            colour={reached ? colors.success : colors.lime500}
          />
        </View>
      </View>
      {showLabel ? (
        <Meta>
          {reached
            ? t('mobile.funding.reached', { percent: readable })
            : t('common.card.funded', { percent: readable })}
        </Meta>
      ) : null}
    </View>
  );
}

/**
 * The fill. It only ever rises, from 0 to its figure: it starts at 0 when motion is allowed and
 * animates up, and when motion is not allowed it starts at the figure and the effect keeps it
 * there. The animated style is always the one passed, so there is one source for the transform
 * whichever way the motion question is answered.
 */
function Fill({ fraction, colour }: { readonly fraction: number; readonly colour: string }) {
  const moves = useMotionAllowed('minimal');
  const scale = useSharedValue(moves ? 0 : fraction);

  useEffect(() => {
    scale.value = moves
      ? withTiming(fraction, { duration: motion.progress, easing: Easing.bezier(...easing.out) })
      : fraction;
  }, [fraction, moves, scale]);

  const rising = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));

  return (
    <Animated.View
      testID={PROGRESS_FILL}
      style={[styles.fill, { backgroundColor: colour }, rising]}
    />
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[2] },
  track: { borderRadius: radius.full, backgroundColor: colors.surface3 },
  clip: { flex: 1, borderRadius: radius.full, overflow: 'hidden' },
  fill: {
    width: '100%',
    height: '100%',
    borderRadius: radius.full,
    transformOrigin: 'left',
  },
});
