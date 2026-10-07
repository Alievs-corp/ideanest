import Decimal from 'decimal.js';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '../../lib/i18n';
import { colors, motion, radius, spacing, spring } from '../../theme';
import { Meta } from '../text';
import { useMotionAllowed } from './motion-budget';
import { BLOCK, blockSurface, useSurface } from './surface';

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
 * <p>Inside a white sheet the track is `whiteMuted` and a bar still asking is `surface1`, the dark
 * fill the skill's primary pill inverts to on white: lime on white measures 1.3:1 and would leave
 * the fill invisible (CLAUDE.md §2). Funded stays `success` on both.
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
 * animated element on the platform. It rises from zero to the figure on `spring.soft` — settled,
 * never overshooting past the figure (`mobile-design` skill §6) — on the UI thread. With Reduce
 * Motion, or under an explicit `none` budget, it is drawn at the figure and does not move.
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

/**
 * How the fill rises. `spring` (the default) settles on `spring.soft`, as every funding bar does.
 * `progress` is the token's 800ms fill (`motion.progress`), eased out: the campaign editor's review
 * score (#162), the one fill that surface's budget sanctions. Either way it is drawn at the figure,
 * unmoving, under Reduce Motion or a `none` budget.
 */
export type ProgressBarRise = 'spring' | 'progress';

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
  /**
   * Drawn for the eye only: no accessible element, no value. For a bar inside a control that
   * already says the figure in its own name or value — the campaign card (#153), which is one
   * link — where a second focus stop, or a value swallowed by the parent on iOS, helps nobody.
   */
  readonly decorative?: boolean;
  /**
   * The funded halo at 100%. On by default, as every funding bar has it; off where 100% is not
   * money raised (the editor's review completeness, #162), which keeps `success` but not the glow.
   */
  readonly glow?: boolean;
  /** How the fill rises where motion is allowed. See {@link ProgressBarRise}. */
  readonly rise?: ProgressBarRise;
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

/**
 * Rounded for display with `decimal.js`, as the web card rounds: "84.49999999999999999" is 84, where
 * `Math.round(Number(...))` makes it 85. The exact figure is a percentage of somebody's money.
 */
function readablePercent(completionPercent: string): string {
  if (!PERCENT.test(completionPercent)) return '0';
  return new Decimal(completionPercent).toFixed(0);
}

/**
 * Whether the goal is met, decided on the decimal: 99.999 is not funded, and a float compare after
 * any rounding would draw it in `success` with the funded glow before the goal is reached.
 */
function goalReached(completionPercent: string): boolean {
  return PERCENT.test(completionPercent) && new Decimal(completionPercent).greaterThanOrEqualTo(100);
}

export function ProgressBar({
  completionPercent,
  label,
  size = 'sm',
  showLabel = true,
  decorative = false,
  rise = 'spring',
  glow = true,
  testID,
}: ProgressBarProps) {
  const t = useT();
  const fraction = fillFraction(completionPercent);
  const reached = goalReached(completionPercent);
  const readable = readablePercent(completionPercent);
  const block = blockSurface(useSurface());

  return (
    <View
      style={styles.column}
      {...(decorative
        ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
        : {
            accessible: true,
            accessibilityRole: 'progressbar' as const,
            accessibilityLabel: label,
            accessibilityValue: {
              min: 0,
              max: 100,
              now: Math.min(Number(readable), 100),
              text: t('common.card.progressLabel', { percent: readable }),
            },
          })}
      accessibilityElementsHidden={decorative}
      testID={testID}
    >
      {/*
        The glow is on a wrapper outside the track, because the track clips its fill and would
        clip a shadow drawn by the fill as well. The web draws it on the fill inside an
        `overflow-hidden` track, where it is clipped away.
      */}
      <View
        style={[
          styles.track,
          { height: HEIGHT[size], backgroundColor: BLOCK[block].track },
          reached && glow && { boxShadow: FUNDED_GLOW },
        ]}
      >
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
            rise={rise}
            colour={reached ? colors.success : block === 'white' ? colors.surface1 : colors.lime500}
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
function Fill({
  fraction,
  colour,
  rise,
}: {
  readonly fraction: number;
  readonly colour: string;
  readonly rise: ProgressBarRise;
}) {
  const moves = useMotionAllowed('minimal');
  const scale = useSharedValue(moves ? 0 : fraction);

  useEffect(() => {
    scale.value = !moves
      ? fraction
      : rise === 'progress'
        ? withTiming(fraction, { duration: motion.progress, easing: Easing.out(Easing.cubic) })
        : withSpring(fraction, spring.soft);
  }, [fraction, moves, rise, scale]);

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
  track: { borderRadius: radius.full },
  clip: { flex: 1, borderRadius: radius.full, overflow: 'hidden' },
  fill: {
    width: '100%',
    height: '100%',
    borderRadius: radius.full,
    transformOrigin: 'left',
  },
});
