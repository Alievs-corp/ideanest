import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { motion, spacing, staggerDelay } from '../theme';
import { useMotionAllowed, useReducedMotion } from './ui/motion-budget';

/**
 * The entry rise — the `mobile-design` skill's `FadeUp` / `Stagger` (§6.3).
 *
 * <h2>Only the first screenful</h2>
 *
 * Elements at `index` {@link FIRST_SCREENFUL} or later render still. That is the skill's §6.5:
 * per-item entry is for what is on screen when it opens, and items a list appends while somebody
 * scrolls never animate in.
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
 * things rather than to move them faster.
 */
export const FIRST_SCREENFUL = 8;

export function FadeUp({ index = 0, children }: FadeUpProps) {
  const allowed = useMotionAllowed('minimal');

  if (!allowed || index >= FIRST_SCREENFUL) {
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
