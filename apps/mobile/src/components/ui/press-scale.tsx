import { useState, type ReactNode } from 'react';
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
 * <p>An animated `Pressable` drops a function `style`, so a control that animates itself
 * ({@link AnimatedPressable}) draws its pressed colour from `pressed` here instead. That keeps the
 * scale on the control's own box: a wrapper would stretch across a column and the control would
 * drift sideways as it scaled about the wrapper's centre.
 */
export function usePressScale() {
  const allowed = useMotionAllowed('minimal');
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    pressed,
    style: allowed ? animated : undefined,
    onPressIn: () => {
      setPressed(true);
      if (allowed) scale.value = withTiming(motion.pressScale, { duration: motion.fast });
    },
    onPressOut: () => {
      setPressed(false);
      // Always back to rest, so a Reduce Motion switched on mid-press cannot leave it shrunk.
      scale.value = allowed ? withSpring(1, spring.snappy) : 1;
    },
  };
}

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
