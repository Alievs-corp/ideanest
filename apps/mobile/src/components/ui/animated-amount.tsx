import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  LayoutAnimationConfig,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { motion, spring, staggerDelay } from '../../theme';
import { useMotionAllowed } from './motion-budget';

/**
 * Every moving number — issue #278, `mobile-design` skill §6.3 and `references/motion-recipes.md`.
 *
 * <h2>A string in, never a number</h2>
 *
 * `value` is what `@ideanest/money` formatted from a `Decimal`. The component never parses it for
 * arithmetic: the final frame is always that exact string, and intermediate count-up frames are
 * decoration rebuilt from its own digits.
 *
 * <h2>Modes</h2>
 *
 * <ul>
 *   <li>`enter` — a new or changed character rises in (opacity, scale 0.85 → 1, 6pt): the soft
 *       blur-in, with no real blur. Keyed from the left, for typing.</li>
 *   <li>`roll` — a changed digit slides up out of its column and the new one in from below,
 *       columns staggered 30ms left to right. Keyed from the right, so 99.00 → 100.00 keeps the
 *       fraction still.</li>
 *   <li>`count` — counts up over `motion.countUp` on the UI thread on first view and lands exactly
 *       on `value`, then behaves as `roll`, so a live figure counts once and rolls on each update.
 *       Characters from `minorFrom` on stay still while the rest counts.</li>
 * </ul>
 *
 * The first render never animates in `enter` and `roll`: only a change does. Width changes snap —
 * each column takes its new glyph's width at once; nothing animates a width.
 *
 * <h2>Reduced motion and screen readers</h2>
 *
 * With motion off the new string is drawn at once as plain text. A screen reader always gets
 * `value` (or `accessibilityLabel`) from the container, never an intermediate frame.
 */

export type AnimatedAmountMode = 'enter' | 'roll' | 'count';

export interface AnimatedAmountProps {
  /** The formatted amount — `formatMoney(...)` output, or a string built from it. */
  readonly value: string;
  readonly mode?: AnimatedAmountMode;
  /** The text style of the characters before `minorFrom` (all of them without it). */
  readonly style?: StyleProp<TextStyle>;
  /** The text style of the characters from `minorFrom` on: the hero figure's minor units. */
  readonly minorStyle?: StyleProp<TextStyle>;
  readonly minorFrom?: number;
  /** What a screen reader hears. Defaults to `value`. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

const ROLL_STEP = 30;
const ENTER_RISE = 6;
const ENTER_SCALE = 0.85;

export function AnimatedAmount({
  value,
  mode = 'roll',
  style,
  minorStyle,
  minorFrom = value.length,
  accessibilityLabel,
  testID,
}: AnimatedAmountProps) {
  const moves = useMotionAllowed('minimal');
  const [counted, setCounted] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    previous.current = value;
  }, [value]);
  const split = Math.max(0, Math.min(minorFrom, value.length));
  const major = value.slice(0, split);
  const minor = value.slice(split);
  const majorStyle = [styles.figure, style];
  const tailStyle = [styles.figure, style, minorStyle];

  const container = {
    accessible: true,
    accessibilityRole: 'text' as const,
    accessibilityLabel: accessibilityLabel ?? value,
    testID,
  };

  if (!moves) {
    return (
      <View {...container} style={styles.row}>
        <Text style={majorStyle} accessibilityElementsHidden importantForAccessibility="no">
          {major}
          {minor === '' ? null : <Text style={tailStyle}>{minor}</Text>}
        </Text>
      </View>
    );
  }

  if (mode === 'count' && !counted) {
    return (
      <View {...container} style={styles.row}>
        <CountUp template={major} style={majorStyle} onDone={() => setCounted(true)} />
        {minor === '' ? null : (
          <Text style={tailStyle} accessibilityElementsHidden importantForAccessibility="no">
            {minor}
          </Text>
        )}
      </View>
    );
  }

  const rolls = mode !== 'enter';
  const height = lineHeightOf(style);
  const before = previous.current;
  let changed = 0;
  const cells = Array.from(value).map((char, index) => {
    const column = rolls ? value.length - 1 - index : index;
    const was = rolls ? before.charAt(before.length - 1 - column) : before.charAt(column);
    const order = was === char ? 0 : changed++;
    return { char, index, column, order };
  });

  return (
    <View {...container} style={styles.row}>
      <LayoutAnimationConfig skipEntering>
        {cells.map((cell) => (
          <View
            key={`c${cell.column}`}
            style={rolls ? styles.column : undefined}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Animated.Text
              key={cell.char}
              style={cell.index < split ? majorStyle : tailStyle}
              entering={rolls ? rollIn(height, staggerDelay(cell.order, ROLL_STEP)) : enterIn()}
              exiting={rolls ? rollOut(height) : undefined}
            >
              {cell.char}
            </Animated.Text>
          </View>
        ))}
      </LayoutAnimationConfig>
    </View>
  );
}

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

function CountUp({
  template,
  style,
  onDone,
}: {
  readonly template: string;
  readonly style: StyleProp<TextStyle>;
  readonly onDone: () => void;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: motion.countUp, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished === true) runOnJS(onDone)();
      },
    );
  }, [template, progress, onDone]);

  const animatedProps = useAnimatedProps(() => {
    return { text: countFrame(template, progress.value) } as unknown as Partial<{ defaultValue: string }>;
  });

  return (
    <AnimatedInput
      editable={false}
      caretHidden
      underlineColorAndroid="transparent"
      defaultValue={template}
      animatedProps={animatedProps}
      style={[style, styles.input]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="animated-amount-count"
    />
  );
}

/**
 * One count-up frame: `template`'s digits replaced by `progress` of their value, leading zeros of
 * the first number dropped. At `progress >= 1` it is `template` itself, character for character.
 *
 * <p>The intermediate value goes through a JS number, which is exact for the 14 digits a money
 * column holds. It is only ever a frame on the way: the last frame is the string, not the number.
 */
export function countFrame(template: string, progress: number): string {
  'worklet';
  if (progress >= 1) return template;
  let digits = '';
  for (let i = 0; i < template.length; i += 1) {
    const char = template.charAt(i);
    if (char >= '0' && char <= '9') digits += char;
  }
  if (digits.length === 0) return template;

  let current = String(Math.floor(Number(digits) * Math.max(0, progress)));
  while (current.length < digits.length) current = `0${current}`;

  let filled = '';
  let next = 0;
  for (let i = 0; i < template.length; i += 1) {
    const char = template.charAt(i);
    if (char >= '0' && char <= '9') {
      filled += current.charAt(next);
      next += 1;
    } else {
      filled += char;
    }
  }

  let start = 0;
  while (start < filled.length && !(filled.charAt(start) >= '0' && filled.charAt(start) <= '9')) start += 1;
  let end = start;
  while (end < filled.length && (filled.charAt(end) === ',' || (filled.charAt(end) >= '0' && filled.charAt(end) <= '9'))) {
    end += 1;
  }
  let cut = start;
  while (cut < end - 1 && (filled.charAt(cut) === '0' || filled.charAt(cut) === ',')) cut += 1;
  if (filled.charAt(cut) === ',') cut += 1;
  return filled.slice(0, start) + filled.slice(cut);
}

function enterIn(): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: ENTER_RISE }, { scale: ENTER_SCALE }] },
      animations: {
        opacity: withTiming(1, { duration: motion.fast }),
        transform: [{ translateY: withSpring(0, spring.snappy) }, { scale: withSpring(1, spring.snappy) }],
      },
    };
  };
}

function rollIn(height: number, delay: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: height }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: motion.fast })),
        transform: [{ translateY: withDelay(delay, withSpring(0, spring.snappy)) }],
      },
    };
  };
}

function rollOut(height: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: {
        opacity: withTiming(0, { duration: motion.fast }),
        transform: [{ translateY: withSpring(-height, spring.snappy) }],
      },
    };
  };
}

function lineHeightOf(style: StyleProp<TextStyle>): number {
  const flat = StyleSheet.flatten(style) ?? {};
  return flat.lineHeight ?? Math.round((flat.fontSize ?? 16) * 1.2);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'nowrap' },
  column: { overflow: 'hidden' },
  figure: { fontVariant: ['tabular-nums'] },
  input: { padding: 0, margin: 0, borderWidth: 0 },
});
