import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { motion, spacing, staggerDelay } from '../theme';

/**
 * The one scroll-entry animation — `docs/motion-system.md` §4.1 and §7, and
 * CLAUDE.md §2's "one scroll-entry animation, `FadeUp`, everywhere".
 *
 * <h2>Why there is exactly one component here</h2>
 *
 * A second entry animation is a design change rather than an implementation
 * detail, and the way a codebase acquires one is never a decision — it is a
 * screen that needed something slightly different and had a whole animation
 * library within reach. Having one exported component makes the second one a
 * diff somebody has to justify.
 *
 * <h2>Transform and opacity only</h2>
 *
 * `FadeInDown` moves on `translateY` and fades on `opacity`, both of which are
 * composited on the UI thread by Reanimated. §8's rule is not about elegance:
 * animating `height` or `top` runs layout on every frame, on the JavaScript
 * thread, in a list that is already scrolling.
 */

/**
 * Whether this device has asked for less motion.
 *
 * Built on `AccessibilityInfo` rather than on Reanimated's `useReducedMotion`,
 * for two reasons. It is the platform's own answer — "Reduce Motion" on iOS,
 * "Remove animations" on Android — rather than a library's reading of it, and it
 * is a core React Native API, which means it behaves under Jest instead of
 * needing the animation runtime that does not exist there.
 *
 * The subscription matters as much as the initial read. Somebody who turns the
 * setting on because a screen is making them ill should not have to restart the
 * application for it to take effect.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let current = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (current) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export interface FadeUpProps {
  /**
   * Position in the list this element belongs to, which decides its delay.
   *
   * `staggerDelay` caps at 300ms — `docs/motion-system.md` §7 spells the ceiling
   * out because without it the fiftieth card in a feed waits two and a half
   * seconds to appear, and by then the reader has scrolled past where it was.
   */
  readonly index?: number;
  readonly children: ReactNode;
}

/**
 * Fade up, once, on entry.
 *
 * With Reduce Motion on this renders a plain `View` — not a shorter animation.
 * A 10ms fade is still a fade, and the setting is a request to stop moving
 * things rather than to move them faster.
 */
export function FadeUp({ index = 0, children }: FadeUpProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <View>{children}</View>;
  }

  /*
   * Reanimated's `FadeInDown` starts 25pt low; the web's `FadeUp` (`packages/ui`) rises 24px,
   * `spacing[6]`, and both platforms should travel the same token distance. Only the start is
   * overridden — the end is still `translateY: 0` at full opacity, over `motion.slow`. A new
   * builder per render, because a builder's methods change it in place and a shared one would
   * hand every card the last card's delay.
   */
  const entering = FadeInDown.duration(motion.slow)
    .delay(staggerDelay(index))
    .withInitialValues({ opacity: 0, transform: [{ translateY: spacing[6] }] });

  return <Animated.View entering={entering}>{children}</Animated.View>;
}
