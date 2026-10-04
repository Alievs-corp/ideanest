import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, motion, spacing, staggerDelay, tracking } from '../../theme';
import { haptics } from './haptics';
import { useMotionAllowed } from './motion-budget';

/**
 * The confirmed moment — issue #280, `mobile-design` skill §6.4 and `references/motion-recipes.md`.
 *
 * <h2>Only after the server said so</h2>
 *
 * This draws whatever it is told to the moment `visible` is true; it has no idea whether money
 * moved. The caller shows it only once the server has confirmed — a pledge read back as collected,
 * never an optimistic guess on the way out to the payment page.
 *
 * <h2>The motion</h2>
 *
 * A circle of fixed size, centred on `origin`, scales from nothing until it covers the screen in
 * `success` ({@link REVEAL_MS}, ease-out) — a `scale` transform, never an animated width. When it
 * lands, `notificationAsync(Success)` fires; then the check draws (the Iconsax tick's own path, its
 * stroke offset animated on the UI thread) and the words fade up, staggered. Everything is done by
 * {@link REVEAL_TOTAL_MS}, inside the skill's 700ms. Under Reduce Motion the final screen is drawn
 * at once and the haptic still fires.
 *
 * <h2>Closing</h2>
 *
 * A tap anywhere closes it, as the reference app does, and so do Android's back button and iOS's
 * escape gesture. The whole screen is one button to a screen reader, named by what it says.
 */

export interface SuccessRevealProps {
  readonly visible: boolean;
  /** The figure: a `formatMoney` amount. */
  readonly title: string;
  /** What happened, under it: "Your pledge is paid". */
  readonly caption: string;
  /** Where the circle grows from, in window points. Defaults to the centre of the window. */
  readonly origin?: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
  readonly testID?: string;
}

/** The circle's growth. */
export const REVEAL_MS = motion.slow;
/** The check's draw, after the circle. */
export const CHECK_MS = motion.base;
/** The last thing still moving ends here: the skill's ceiling is 700ms. */
export const REVEAL_TOTAL_MS = REVEAL_MS + Math.max(CHECK_MS, staggerDelay(2) + motion.fast);

const CHECK_SIZE = spacing[24];
const CIRCLE = 2;
const TEXT_RISE = spacing[4];

/** The tick inside Iconsax's `TickCircle`, the path the check draws along. */
export const TICK_PATH: string =
  Glyphs.TickCircle.linear
    .map((node) => node.attrs.d)
    .find((d): d is string => typeof d === 'string' && d.startsWith('m')) ?? '';

/**
 * The length of a path made of one relative move and relative line segments (`m x y dx dy …`) —
 * the only shape `TICK_PATH` has. A dash as long as the line, offset by as much, hides it; an offset
 * of zero shows all of it.
 */
export function polylineLength(d: string): number {
  const numbers = (d.match(/-?\d*\.?\d+/g) ?? []).map((part) => Number.parseFloat(part));
  if (!/^m[\d\s.,-]+$/.test(d.trim()) || numbers.length < 4 || numbers.length % 2 !== 0) {
    throw new Error(`polylineLength reads "m x y dx dy …" only; got ${d}`);
  }
  let length = 0;
  for (let i = 2; i < numbers.length; i += 2) {
    length += Math.hypot(numbers[i] ?? 0, numbers[i + 1] ?? 0);
  }
  return length;
}

const TICK_LENGTH = polylineLength(TICK_PATH);

/** The scale at which a circle of `diameter` centred on `origin` covers a `width` × `height` window. */
export function coverScale(origin: { x: number; y: number }, width: number, height: number, diameter: number): number {
  const reach = Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(width - origin.x, origin.y),
    Math.hypot(origin.x, height - origin.y),
    Math.hypot(width - origin.x, height - origin.y),
  );
  return diameter > 0 ? (reach * 2) / diameter : 1;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function SuccessReveal({ visible, title, caption, origin, onClose, testID = 'success-reveal' }: SuccessRevealProps) {
  if (!visible) return null;
  return <Reveal title={title} caption={caption} origin={origin} onClose={onClose} testID={testID} />;
}

function Reveal({
  title,
  caption,
  origin,
  onClose,
  testID,
}: Omit<SuccessRevealProps, 'visible'> & { readonly testID: string }) {
  const t = useT('mobile.kitMoney');
  const moves = useMotionAllowed('minimal');
  const { width, height } = useWindowDimensions();
  const centre = origin ?? { x: width / 2, y: height / 2 };
  const diameter = Math.max(width, height) / CIRCLE;
  const full = coverScale(centre, width, height, diameter);

  const circle = useSharedValue(moves ? 0 : 1);
  const check = useSharedValue(moves ? 0 : 1);
  const words = useSharedValue(moves ? 0 : 1);
  const fired = useRef(false);

  useEffect(() => {
    const land = () => {
      if (fired.current) return;
      fired.current = true;
      haptics.pledgeConfirmed();
    };
    if (!moves) {
      circle.value = 1;
      check.value = 1;
      words.value = 1;
      land();
      return;
    }
    circle.value = withTiming(1, { duration: REVEAL_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished === true) runOnJS(land)();
    });
    check.value = withDelay(REVEAL_MS, withTiming(1, { duration: CHECK_MS, easing: Easing.out(Easing.cubic) }));
    words.value = withDelay(REVEAL_MS, withTiming(1, { duration: staggerDelay(2) + motion.fast }));
    // Started once, on mount: a re-render, or Reduce Motion switched mid-reveal, must not replay it.
  }, []);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: circle.value * full }] }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - check.value) }));

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.fill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${caption}`}
        accessibilityHint={t('tapToClose')}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        testID={testID}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.circle,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              left: centre.x - diameter / 2,
              top: centre.y - diameter / 2,
            },
            circleStyle,
          ]}
          testID={`${testID}-circle`}
        />
        <View style={styles.content} pointerEvents="none">
          <Svg width={CHECK_SIZE} height={CHECK_SIZE} viewBox="0 0 24 24" fill="none">
            <AnimatedPath
              d={TICK_PATH}
              stroke={colors.textOnWhite}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[TICK_LENGTH, TICK_LENGTH]}
              animatedProps={checkProps}
              testID={`${testID}-check`}
            />
          </Svg>
          <Word index={0} progress={words} moves={moves} style={styles.title} testID={`${testID}-title`}>
            {title}
          </Word>
          <Word index={1} progress={words} moves={moves} style={styles.caption}>
            {caption}
          </Word>
        </View>
        <View style={styles.footer} pointerEvents="none">
          <Word index={2} progress={words} moves={moves} style={styles.hint}>
            {t('tapToClose')}
          </Word>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * One line fading up in its turn. `progress` runs 0 → 1 over the whole stagger; each line takes its
 * own `motion.fast` slice of it, starting `staggerDelay(index)` in.
 */
function Word({
  index,
  progress,
  moves,
  style,
  children,
  testID,
}: {
  readonly index: number;
  readonly progress: SharedValue<number>;
  readonly moves: boolean;
  readonly style: StyleProp<TextStyle>;
  readonly children: string;
  readonly testID?: string;
}) {
  const span = staggerDelay(2) + motion.fast;
  const from = staggerDelay(index) / span;
  const to = (staggerDelay(index) + motion.fast) / span;
  const animated = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (progress.value - from) / (to - from)));
    return { opacity: local, transform: [{ translateY: (1 - local) * TEXT_RISE }] };
  });
  return (
    <Animated.Text
      style={[style, moves ? animated : null]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      testID={testID}
    >
      {children}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  circle: { position: 'absolute', backgroundColor: colors.success },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[4], padding: spacing[6] },
  footer: { alignItems: 'center', paddingBottom: spacing[12], paddingHorizontal: spacing[6] },
  title: {
    ...font.semibold,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: tracking.display,
    color: colors.textOnWhite,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  caption: {
    ...font.medium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    color: colors.textOnWhite,
    textAlign: 'center',
  },
  hint: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textOnWhite, textAlign: 'center' },
});
