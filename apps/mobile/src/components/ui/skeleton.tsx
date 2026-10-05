import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type BackgroundImageValue,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useT } from '../../lib/i18n';
import { easing, lineHeight, motion, radius, size as measure, spacing, tint } from '../../theme';
import { useMotionAllowed } from './motion-budget';
import { BLOCK, blockSurface, useSurface, type BlockSurface } from './surface';

/**
 * Loading placeholders — the native `Skeleton`, `SkeletonGroup` and `SkeletonCard`
 * (`docs/ui-kit.md` §7.15), which replaced the spinner `Loading` the app's first `states.tsx` drew.
 *
 * <h2>Sanctioned motion, and only transform</h2>
 *
 * The shimmer and the skeleton-to-content crossfade (`mobile-design` skill §6.3) say "the request
 * is alive" rather than "look at this". The shimmer is an overlay that **translates** across the
 * block on `translateX`, over `motion.shimmer` — the web's `.skeleton-shimmer` — on the UI thread,
 * so it composites and never repaints the block. Its band is a native linear gradient from
 * transparent through a lighter tone and back: `surface-3` blocks with a `surface-4` band on the
 * canvas, `whiteMuted` blocks with a `whiteSurface` band inside a white sheet (`useSurface()`).
 *
 * <h2>Cheap, because there are many</h2>
 *
 * A column of placeholder cards is dozens of blocks, mounted while a page is still sliding in. So
 * each block is two native views, the block and its band; the band is a view background, not an
 * SVG (a `react-native-svg` gradient was seven views a block and drew on the UI thread); the
 * block's width reaches the band through a shared value, not React state, so laying out does not
 * render the page a second time; and every band on screen runs on one clock.
 *
 * <p>With Reduce Motion, or under a `none` budget, the overlay is **not rendered** — not frozen
 * mid-travel, which is what a collapsed duration leaves on the web and why its stylesheet removes
 * the overlay outright. A grey block is a complete placeholder by itself.
 *
 * <h2>A screen reader never reads shimmer</h2>
 *
 * Every placeholder is hidden from assistive technology. `SkeletonGroup` is the one accessible
 * element around them: it carries the caller's words ("Loading your pledges") and
 * `accessibilityState.busy`, and hides its children, so the wait is one announcement instead of
 * forty grey rectangles or none.
 */

export interface SkeletonProps {
  /** Any React Native width. Fills the container by default. */
  readonly width?: DimensionValue;
  /** In points. A line of body text by default. */
  readonly height?: number;
  /** A width-to-height ratio instead of a height, for a cover whose height follows its width. */
  readonly aspectRatio?: number;
  /** Circular, for an avatar. The width follows the height. */
  readonly circle?: boolean;
  /** `sm` by default; `none` for a block inside a clipped card, as the card's cover. */
  readonly radius?: 'none' | 'sm' | 'md' | 'lg';
  readonly testID?: string;
}

const RADIUS = { none: 0, sm: radius.sm, md: radius.md, lg: radius.lg } as const;

/** The shimmer's test identifier, so a test can say it is absent without motion. */
export const SKELETON_SHIMMER = 'skeleton-shimmer';

/** The band: the surface's shimmer tone in the middle, the same tone fully transparent at both ends. */
function band(tone: string): BackgroundImageValue[] {
  const clear = tint(tone, 0);
  return [
    {
      type: 'linear-gradient',
      direction: 'to right',
      colorStops: [
        { color: clear, positions: ['0%'] },
        { color: tone, positions: ['50%'] },
        { color: clear, positions: ['100%'] },
      ],
    },
  ];
}

const BANDS: Record<BlockSurface, BackgroundImageValue[]> = {
  dark: band(BLOCK.dark.shimmer),
  white: band(BLOCK.white.shimmer),
};

/**
 * One clock for every band on screen: the first shimmer to mount starts it, the last to go stops
 * it. Seventy blocks used to mean seventy repeating animations, each a callback every frame, each
 * started when its own block happened to lay out.
 */
const clock = makeMutable(0);
let shimmering = 0;

function useShimmerClock(): SharedValue<number> {
  useEffect(() => {
    shimmering += 1;
    if (shimmering === 1) {
      clock.value = 0;
      clock.value = withRepeat(
        withTiming(1, { duration: motion.shimmer, easing: Easing.bezier(...easing.standard) }),
        -1,
      );
    }
    return () => {
      shimmering -= 1;
      if (shimmering === 0) cancelAnimation(clock);
    };
  }, []);
  return clock;
}

export function Skeleton({
  width = '100%',
  height = 16,
  aspectRatio,
  circle = false,
  radius: corner = 'sm',
  testID,
}: SkeletonProps) {
  const shimmers = useMotionAllowed('minimal');
  const block = blockSurface(useSurface());
  const span = useSharedValue(0);
  const measured = useCallback(
    ({ nativeEvent }: LayoutChangeEvent) => {
      span.value = nativeEvent.layout.width;
    },
    [span],
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={shimmers ? measured : undefined}
      testID={testID}
      style={[
        styles.block,
        {
          backgroundColor: BLOCK[block].placeholder,
          width: circle ? height : width,
          ...(aspectRatio === undefined ? { height } : { aspectRatio }),
          borderRadius: circle ? radius.full : RADIUS[corner],
        },
      ]}
    >
      {shimmers ? <Shimmer span={span} block={block} /> : null}
    </View>
  );
}

/**
 * The band, travelling from one block-width left of the block to one block-width right of it, and
 * again. Only mounted when motion is allowed, so there is nothing to stop when it is not; hidden
 * until the block has a width, so it never flashes across a block it has not measured.
 */
function Shimmer({ span, block }: { readonly span: SharedValue<number>; readonly block: BlockSurface }) {
  const progress = useShimmerClock();

  const travel = useAnimatedStyle(() => ({
    opacity: span.value > 0 ? 1 : 0,
    transform: [{ translateX: (progress.value * 2 - 1) * span.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      testID={SKELETON_SHIMMER}
      style={[styles.shimmer, { experimental_backgroundImage: BANDS[block] }, travel]}
    />
  );
}

export interface SkeletonGroupProps {
  /**
   * What is loading, in the caller's words — the one thing announced. Defaults to the catalogue's
   * "Loading" (`common.list.loadingMore`), which is true and says little; a screen should say what.
   */
  readonly label?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * The container the placeholders live in. Replace it with the content when the request resolves
 * (through `SkeletonCrossfade`): `busy` going away with it is the signal that the wait ended.
 */
export function SkeletonGroup({ label, children, testID }: SkeletonGroupProps) {
  const t = useT();
  return (
    <View
      accessible
      accessibilityLabel={label ?? t('common.list.loadingMore')}
      accessibilityState={{ busy: true }}
      testID={testID}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </View>
  );
}

/**
 * A placeholder shaped like `components/project-card.tsx`, line for line, so the feed does not
 * jump when the cards arrive. A raised block (no hairline, skill §2): the 16:9 cover, then a body padded 20 with 12 between rows — the
 * status tag, the title, the byline, the progress bar with its figures, the 80% rule and the goal,
 * and the footer (issue #153's card). Each text line is a row of that role's line height with a
 * thinner bar centred in it, which is the height the text will take.
 */
export function SkeletonCard({ testID }: { readonly testID?: string }) {
  const block = blockSurface(useSurface());
  return (
    <View
      style={[styles.card, { backgroundColor: BLOCK[block].rest }]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Skeleton aspectRatio={16 / 9} radius="none" />
      <View style={styles.cardBody}>
        <Skeleton height={26} width={72} radius="sm" />
        <Line height={lineHeight.cardTitle} bar={14} width="70%" />
        <Line height={lineHeight.small} bar={12} width="40%" />
        <View style={styles.progress}>
          <Skeleton height={6} radius="lg" />
          <View style={styles.footer}>
            <Line height={lineHeight.small} bar={12} width="30%" />
            <Line height={lineHeight.small} bar={10} width="20%" />
          </View>
          <Line height={lineHeight.body} bar={10} width="45%" />
          <Line height={lineHeight.body} bar={10} width="30%" />
        </View>
        <View style={styles.footer}>
          <Line height={lineHeight.body} bar={10} width="35%" />
          <Line height={lineHeight.body} bar={10} width="20%" />
        </View>
      </View>
    </View>
  );
}

function Line({
  height,
  bar,
  width,
}: {
  readonly height: number;
  readonly bar: number;
  readonly width: DimensionValue;
}) {
  return (
    <View style={[styles.line, { height, width }]}>
      <Skeleton height={bar} />
    </View>
  );
}

export interface SkeletonCrossfadeProps {
  /** True while the request is in flight. */
  readonly loading: boolean;
  /** What stands in: usually a `SkeletonGroup`. */
  readonly placeholder: ReactNode;
  readonly children: ReactNode;
}

/**
 * The skeleton-to-content swap — `mobile-design` skill §6.3 — as a 200ms crossfade
 * (`motion.overlay`): the content fades in over the placeholder as the placeholder fades out, both
 * on `opacity` alone, as Reanimated layout animations on the UI thread.
 *
 * <p>Only a swap fades. Content that is ready on the first render — a cache hit — appears at once,
 * because there was no placeholder to cross from, and a fade over nothing is just a delay. With
 * Reduce Motion or a `none` budget the swap is instant.
 */
export function SkeletonCrossfade({ loading, placeholder, children }: SkeletonCrossfadeProps) {
  const fades = useMotionAllowed('minimal');
  // Whether a placeholder has been on screen, so there is something to cross from.
  const waited = useRef(loading);
  if (loading) waited.current = true;

  /*
   * Distinct keys, so React replaces one view with the other instead of reusing the first and
   * swapping its children — which would run neither the exit nor the entry. The exiting view is
   * kept where it was by Reanimated for the length of its fade, so the two overlap.
   */
  if (loading) {
    return fades ? (
      <Animated.View key="placeholder" exiting={FadeOut.duration(motion.overlay)}>
        {placeholder}
      </Animated.View>
    ) : (
      <View key="placeholder">{placeholder}</View>
    );
  }

  return fades && waited.current ? (
    <Animated.View key="content" entering={FadeIn.duration(motion.overlay)}>
      {children}
    </Animated.View>
  ) : (
    <View key="content">{children}</View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden' },
  shimmer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  card: { borderRadius: radius.xl, overflow: 'hidden' },
  cardBody: { padding: measure.cardPaddingSmall, gap: spacing[3] },
  // The card's `funding` block: 8 between rows and 8 above, so nothing moves when it arrives.
  progress: { gap: spacing[2], paddingTop: spacing[2] },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  line: { justifyContent: 'center' },
});
