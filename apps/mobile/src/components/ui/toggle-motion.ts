import { useEffect } from 'react';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { spring } from '../../theme';
import { useMotionAllowed } from './motion-budget';

/**
 * A control's on/off as a number the UI thread can draw from — the chip's selected layer, the
 * switch's knob, the checkbox's mark, the radio's dot (issue #282, `mobile-design` skill §6).
 *
 * <p>`progress` springs between 0 and 1 on `spring.snappy`, which is critically damped, so a knob
 * settles without a bounce and a crossfade never goes past either end. Under Reduce Motion (or a
 * budget of `none`) it jumps: the control is drawn in its new state on the same frame. Not
 * exported from the kit's barrel.
 */
export function useToggleMotion(on: boolean) {
  const moves = useMotionAllowed('minimal');
  const progress = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    const target = on ? 1 : 0;
    progress.value = moves ? withSpring(target, spring.snappy) : target;
  }, [on, moves, progress]);

  return { moves, progress } as const;
}
