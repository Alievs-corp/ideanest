import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { motion, spacing, staggerDelay } from '../theme';
import { useMotionAllowed, useReducedMotion } from './ui/motion-budget';

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
 * Whether this device has asked for less motion. It lives with the motion budget now, which is
 * the one place that combines it with the surface's level; it is re-exported here because this
 * file is where screens have always found it.
 */
export { useReducedMotion };

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
 * things rather than to move them faster. The same is true on a surface whose
 * motion budget is `none` — checkout, the editor, settings — which is how a
 * heading shared with one of those screens stays still there.
 */
export function FadeUp({ index = 0, children }: FadeUpProps) {
  const allowed = useMotionAllowed('minimal');

  if (!allowed) {
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
