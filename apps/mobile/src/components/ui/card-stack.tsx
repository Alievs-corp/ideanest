import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { motion, radius, spacing, spring, staggerDelay, type Accent } from '../../theme';
import { AccentCard, accentGlow } from './accent-card';
import { useFocusRing } from './focus';
import { useMotionAllowed } from './motion-budget';
import { FOCUS_DELAY_MS, focusOn } from './overlay';

/**
 * A group of accent cards that sits as a stack and spreads into a column — `mobile-design` skill
 * §6.3, "card stack fan-out", and `references/motion-recipes.md` § CardStack (#279).
 *
 * <h2>Transforms on fixed-size cards</h2>
 *
 * Every card is the same height (`cardHeight`) and absolutely placed at the top of the group. The
 * stack and the column are two sets of transforms on those layers — `translateX`, `translateY`
 * and `scale` — so nothing animates a height. Stacked, each layer behind the front one is moved
 * right and scaled down by {@link LAYER_SCALE} so that it shows {@link PEEK} beyond the layer in
 * front of it, the way the reference app's stack peeks in at the side; past the third it waits
 * invisibly behind the third. Two peeks fit in the screen gutter. Spread, layer `i` is at
 * `i × (cardHeight + gap)` down the column.
 *
 * <p>The group's own height is the column's while it is spread or spreading and the stack's once
 * it has collapsed: it grows at once when the cards start to spread, and shrinks only after they
 * have folded back, so a card is never drawn over what follows the group. That one jump is a
 * layout change, not an animation.
 *
 * <h2>Order of motion</h2>
 *
 * Spreading, the front card leaves first and each next one {@link STEP_MS} later
 * (`staggerDelay`), on `spring.soft`; each layer's glow fades in after that layer has settled.
 * Collapsing is the exact reverse: the glows go first, then the back card folds in first and the
 * front one last. Under Reduce Motion the group changes state at once.
 *
 * <h2>One stop or many</h2>
 *
 * Stacked, the group is one button — "show all" — and the cards inside are hidden from a screen
 * reader: they cannot be reached separately while they are on top of each other. Spread, each card
 * is its own stop with its own action. Pressing "show all" removes the button that had focus, so
 * focus moves onto the first card instead of being dropped.
 */

export interface CardStackItem {
  readonly key: string;
  readonly accent: Accent;
  readonly children: ReactNode;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
}

export interface CardStackProps {
  readonly items: readonly CardStackItem[];
  readonly expanded: boolean;
  /** Called when the stacked group is pressed. The parent decides; the group is controlled. */
  readonly onExpand: () => void;
  /** The stacked group's accessible name: what pressing it shows. */
  readonly label: string;
  /** Every card's height. Fixed, because the layers are transforms on fixed-size cards. */
  readonly cardHeight: number;
  readonly gap?: number;
  readonly testID?: string;
}

/** How far each layer behind the front one peeks out at the side while stacked. */
export const PEEK = spacing[2];
/** How much smaller each layer behind the front one is while stacked. */
export const LAYER_SCALE = 0.05;
/** The most layers a stack shows; the rest wait behind the last. */
export const STACK_DEPTH = 3;
/** The spread stagger step: a little slower than a list entry, as the recipe asks. */
export const STEP_MS = 60;

/**
 * How far right layer `index` sits while stacked, in a group `width` wide: enough to undo its
 * scale's shrink at the right edge, plus a peek per layer, never past the third.
 */
export function stackedOffset(index: number, width: number): number {
  return ((1 - stackedScale(index)) * width) / 2 + Math.min(index, STACK_DEPTH - 1) * PEEK;
}

export function stackedScale(index: number): number {
  return 1 - Math.min(index, STACK_DEPTH - 1) * LAYER_SCALE;
}

export function spreadOffset(index: number, cardHeight: number, gap: number): number {
  return index * (cardHeight + gap);
}

/** The group's height in either state. */
export function stackHeight(count: number, cardHeight: number, gap: number, expanded: boolean) {
  if (count === 0) return 0;
  return expanded
    ? spreadOffset(count - 1, cardHeight, gap) + cardHeight
    : cardHeight;
}

export function CardStack({
  items,
  expanded,
  onExpand,
  label,
  cardHeight,
  gap = spacing[3],
  testID,
}: CardStackProps) {
  const moves = useMotionAllowed('minimal');
  const ring = useFocusRing();
  const count = items.length;
  /** The column's height while spread, spreading or folding back; the stack's once folded. */
  const [folded, setFolded] = useState(!expanded);
  const tall = expanded || !folded;
  useEffect(() => {
    if (expanded) setFolded(false);
  }, [expanded]);
  const [width, setWidth] = useState(0);
  const first = useRef<View>(null);
  const pressed = useRef(false);

  useEffect(() => {
    if (!expanded || !pressed.current) return undefined;
    pressed.current = false;
    const timer = setTimeout(() => focusOn(first.current), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [expanded]);

  return (
    <View
      style={[styles.group, { height: stackHeight(count, cardHeight, gap, tall) }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      testID={testID}
    >
      {items
        .map((item, index) => (
          <Layer
            key={item.key}
            item={item}
            index={index}
            count={count}
            expanded={expanded}
            moves={moves}
            onFolded={setFolded}
            cardHeight={cardHeight}
            gap={gap}
            width={width}
            pressableRef={index === 0 ? first : undefined}
          />
        ))
        .reverse()}
      {expanded ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: false }}
          onPress={() => {
            pressed.current = true;
            onExpand();
          }}
          onFocus={ring.onFocus}
          onBlur={ring.onBlur}
          style={[styles.cover, ring.ring]}
          testID={testID === undefined ? undefined : `${testID}-expand`}
        />
      )}
    </View>
  );
}

function Layer({
  item,
  index,
  count,
  expanded,
  moves,
  onFolded,
  cardHeight,
  gap,
  width,
  pressableRef,
}: {
  readonly item: CardStackItem;
  readonly index: number;
  readonly count: number;
  readonly expanded: boolean;
  readonly moves: boolean;
  readonly onFolded: (folded: true) => void;
  readonly cardHeight: number;
  readonly gap: number;
  readonly width: number;
  readonly pressableRef?: Ref<View>;
}) {
  const progress = useSharedValue(expanded ? 1 : 0);
  const glow = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    cancelAnimation(progress);
    cancelAnimation(glow);
    if (!moves) {
      progress.value = expanded ? 1 : 0;
      glow.value = expanded ? 1 : 0;
      if (!expanded && index === 0) onFolded(true);
      return;
    }
    if (expanded) {
      progress.value = withDelay(
        staggerDelay(index, STEP_MS),
        withSpring(1, spring.soft, (finished) => {
          if (finished === true) glow.value = withTiming(1, { duration: motion.base });
        }),
      );
      return;
    }
    glow.value = withTiming(0, { duration: motion.fast });
    progress.value = withDelay(
      // The glows go first, then the back card folds in first and the front one last.
      motion.fast + staggerDelay(count - 1 - index, STEP_MS),
      withSpring(0, spring.soft, (finished) => {
        if (finished === true && index === 0) runOnJS(onFolded)(true);
      }),
    );
  }, [count, expanded, glow, index, moves, onFolded, progress]);

  const aside = stackedOffset(index, width);
  const to = spreadOffset(index, cardHeight, gap);
  const smallest = stackedScale(index);
  const buried = index >= STACK_DEPTH;

  const layerStyle = useAnimatedStyle(() => ({
    opacity: buried ? progress.value : 1,
    transform: [
      { translateX: aside * (1 - progress.value) },
      { translateY: to * progress.value },
      { scale: smallest + (1 - smallest) * progress.value },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View
      style={[styles.layer, { height: cardHeight }, layerStyle]}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      pointerEvents={expanded ? 'auto' : 'none'}
      testID={`card-stack-layer-${index}`}
    >
      <Animated.View
        style={[styles.glow, { boxShadow: accentGlow(item.accent) }, glowStyle]}
        pointerEvents="none"
      />
      <AccentCard
        accent={item.accent}
        glow={false}
        onPress={item.onPress}
        accessibilityLabel={item.accessibilityLabel}
        pressableRef={pressableRef}
        style={styles.fill}
      >
        {item.children}
      </AccentCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  group: { position: 'relative' },
  layer: { position: 'absolute', top: 0, left: 0, right: 0 },
  glow: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.xl },
  fill: { flex: 1 },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.xl },
});
