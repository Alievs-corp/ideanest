import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { motion, spring } from '../../theme';
import { haptics, type HapticEvent } from './haptics';
import { useMotionAllowed } from './motion-budget';

/**
 * Press feedback — `mobile-design` skill §6.3 and `references/motion-recipes.md`.
 *
 * The surface gives to `motion.pressScale` on press-in and springs back on release. `onPress`
 * fires exactly when it would without the animation: the scale is decoration on a press that has
 * already been accepted. Under Reduce Motion nothing moves and the pressed colour is the whole
 * response.
 *
 * <p>The scale lives on a wrapper and the press on the `Pressable` inside it. An animated
 * `Pressable` drops a function `style`, which is how the kit draws its pressed colours.
 */
export function usePressScale() {
  const allowed = useMotionAllowed('minimal');
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style: allowed ? animated : undefined,
    onPressIn: () => {
      if (allowed) scale.value = withTiming(motion.pressScale, { duration: motion.fast });
    },
    onPressOut: () => {
      if (allowed) scale.value = withSpring(1, spring.snappy);
    },
  };
}

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  readonly children: ReactNode;
  /** Layout of the scaled wrapper: margins, flex, width. */
  readonly style?: StyleProp<ViewStyle>;
  /** The surface's own look, pressed or not. */
  readonly contentStyle?: PressableProps['style'];
  readonly haptic?: HapticEvent;
}

export function PressableScale({
  children,
  style,
  contentStyle,
  haptic,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const press = usePressScale();
  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        {...rest}
        style={contentStyle}
        onPressIn={(event) => {
          press.onPressIn();
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          press.onPressOut();
          onPressOut?.(event);
        }}
        onPress={(event) => {
          if (haptic !== undefined) haptics[haptic]();
          onPress?.(event);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
