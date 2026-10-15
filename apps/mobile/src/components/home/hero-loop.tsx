import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HERO_LOOP, HERO_LOOP_MS } from '@ideanest/messages/hero-loop';
import { useAppActive } from '../../lib/app-active';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import { useTabBarInset } from '../tab-bar';
import { EdgeFade } from '../ui/edge-fade';
import { useMotionAllowed } from '../ui/motion-budget';

export type HeroLines = readonly [string, string, string, string];

/**
 * The home hero's scene card — issue #490, the web's `HeroPhoneScene`.
 *
 * The square loop rendered from the web's `HeroSceneDrawing`, with the hero's informational lines
 * playing over it one at a time: each rises in, holds and lifts away, one every half loop, so the
 * four take two loops of the scene. The card is decoration with one accessible name, the
 * standfirst it replaces on screen.
 *
 * <ul>
 *   <li>It plays only while Home is focused and the app is in the foreground, and never under
 *       Reduce Motion: there the poster stands, with the last line on it.</li>
 *   <li>Its side follows the screen's height, so the two actions under it are still on the first
 *       screen of a short phone, and it is the full width of any taller one.</li>
 *   <li>`expo-video` is already in the binary (#331), so this ships over the air.</li>
 * </ul>
 */
export function HeroLoopCard({ lines, label }: { readonly lines: HeroLines; readonly label: string }) {
  const side = useCardSide();
  const moving = useMotionAllowed('moderate');
  const focused = useIsFocused();
  const appActive = useAppActive();
  const playing = moving && focused && appActive;

  const player = useVideoPlayer(moving ? HERO_LOOP.phone.url : null, (created) => {
    created.loop = true;
    created.muted = true;
  });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  const clock = useSharedValue(0);
  useEffect(() => {
    if (!playing) {
      cancelAnimation(clock);
      return;
    }
    clock.value = withRepeat(withTiming(clock.value + 1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
  }, [playing, clock]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.card, { width: side, height: side }]}
      testID="hero-loop"
    >
      <Image
        source={{ uri: HERO_LOOP.phone.posterUrl }}
        contentFit="cover"
        transition={0}
        style={StyleSheet.absoluteFill}
        accessible={false}
        testID="hero-loop-poster"
      />
      {moving ? (
        <VideoView
          player={player}
          nativeControls={false}
          contentFit="cover"
          allowsPictureInPicture={false}
          surfaceType="textureView"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.video]}
          testID="hero-loop-video"
        />
      ) : null}
      <EdgeFade color={colors.surface2} height={side * FADE} />
      {moving ? (
        lines.map((line, index) => <Line key={line} text={line} index={index} clock={clock} />)
      ) : (
        <StillLine text={lines[lines.length - 1] ?? ''} />
      )}
    </View>
  );
}

/** Two loops of the scene for the four lines. */
const CYCLE_MS = HERO_LOOP_MS * 2;
const BEATS = 4;
/** The fade under the lines, as a share of the card's side. */
const FADE = 0.38;
/** The smallest card that still reads; below it the actions move under the fold instead. */
const MIN_SIDE = 260;
/**
 * Everything on Home's first screen that is not the card: the header, the title's two lines, the
 * gaps and the actions.
 */
const RESERVED = 56 + spacing[4] + lineHeight.h1 * 2 + spacing[4] * 2 + spacing[12] + spacing[4];

function useCardSide(): number {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabInset = useTabBarInset();
  const across = width - insets.left - insets.right - spacing[5] * 2;
  const down = height - insets.top - Math.max(insets.bottom, tabInset) - RESERVED;
  return Math.round(Math.min(across, Math.max(MIN_SIDE, down)));
}

function Line({ text, index, clock }: { readonly text: string; readonly index: number; readonly clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const beat = (((clock.value % 1) * BEATS - index) % BEATS + BEATS) % BEATS;
    return {
      opacity: interpolate(beat, [0, 0.12, 0.84, 0.98, BEATS], [0, 1, 1, 0, 0], 'clamp'),
      transform: [{ translateY: interpolate(beat, [0, 0.12, 0.84, 0.98], [12, 0, 0, -10], 'clamp') }],
    };
  });
  return (
    <Animated.Text
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={[styles.line, style]}
      testID={`hero-loop-line-${index}`}
    >
      {text}
    </Animated.Text>
  );
}

function StillLine({ text }: { readonly text: string }) {
  return (
    <Animated.Text importantForAccessibility="no" accessibilityElementsHidden style={styles.line} testID="hero-loop-still">
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  video: { backgroundColor: 'transparent' },
  line: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    bottom: spacing[4],
    ...font.semibold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.h3,
    textAlign: 'center',
    color: colors.textPrimary,
  },
});
