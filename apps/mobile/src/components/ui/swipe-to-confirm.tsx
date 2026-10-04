import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing, spring, tracking } from '../../theme';
import { useAssistiveTechnology } from './assistive-tech';
import { haptics } from './haptics';
import { Icon } from './icon';
import { useMotionAllowed } from './motion-budget';
import { Pill } from './pill';
import { BLOCK, TONES, blockSurface, useSurface } from './surface';

/**
 * The final money confirmation — issue #280, `mobile-design` skill §6.4 and
 * `references/motion-recipes.md`.
 *
 * <h2>The gesture</h2>
 *
 * A lime thumb on a track follows the finger (gesture-handler `Pan`, on the UI thread), clamped to
 * the track. Let go past {@link SWIPE_COMMIT} of the way and it commits: the thumb settles at the
 * end, an `impactAsync(Medium)` lands, and `onConfirm` runs. Short of it, the thumb springs back.
 * While dragging, `amount` crossfades to its success layer in proportion — two layers and their
 * opacity, never an animated colour. The success haptic belongs to the screen that shows the
 * confirmed result, not to this one.
 *
 * <h2>Without the gesture</h2>
 *
 * A drag is a gesture a screen-reader or switch user cannot make, so the track is a `button` with
 * an `activate` accessibility action, and with a screen reader — or, on Android, any accessibility
 * service, which is how Switch Access appears — it is drawn as an ordinary accent pill instead.
 *
 * <h2>Once per request</h2>
 *
 * `busy` is the request in flight: the thumb holds at the end with a spinner and nothing can commit
 * again. When `busy` ends without the screen moving on — a failure, a dismissed payment page — the
 * thumb returns to the start, and the next swipe calls `onConfirm` again. Idempotency is the
 * caller's: a retry must send the same key, which `useCheckout`'s keyring does.
 *
 * <p>Wrapped in its own `GestureHandlerRootView`, as the library asks of a component that may be
 * mounted inside a modal screen.
 */

export interface SwipeToConfirmProps {
  /** What the track says while idle: "Swipe to continue to payment". */
  readonly label: string;
  /** The action's name — the button's label when it is drawn as one, and the track's accessible name. */
  readonly actionLabel: string;
  readonly onConfirm: () => void;
  /** The formatted amount above the track, which turns to the success tone as the thumb travels. */
  readonly amount?: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** How far along the track a release commits. */
export const SWIPE_COMMIT = 0.85;

const TRACK_HEIGHT = 56;
const INSET = spacing[1];
const THUMB = TRACK_HEIGHT - INSET * 2;

/** How far along the thumb is, 0 to 1. */
export function swipeProgress(x: number, travel: number): number {
  'worklet';
  return travel > 0 ? Math.min(1, Math.max(0, x / travel)) : 0;
}

/** Whether a release at `x` commits. */
export function swipeCommits(x: number, travel: number): boolean {
  'worklet';
  return travel > 0 && swipeProgress(x, travel) >= SWIPE_COMMIT;
}

export function SwipeToConfirm({
  label,
  actionLabel,
  onConfirm,
  amount,
  busy = false,
  disabled = false,
  testID = 'swipe-to-confirm',
}: SwipeToConfirmProps) {
  const assisted = useAssistiveTechnology();
  const blocked = disabled || busy;

  if (assisted) {
    return (
      <View style={styles.root}>
        {amount === undefined ? null : <AmountLayers amount={amount} progress={null} testID={`${testID}-amount`} />}
        <Pill
          variant="accent"
          size="lg"
          fullWidth
          label={actionLabel}
          busy={busy}
          disabled={disabled}
          onPress={() => {
            haptics.swipeConfirm();
            onConfirm();
          }}
          testID={testID}
        />
      </View>
    );
  }

  return (
    <SwipeTrack
      label={label}
      actionLabel={actionLabel}
      onConfirm={onConfirm}
      amount={amount}
      busy={busy}
      blocked={blocked}
      testID={testID}
    />
  );
}

function SwipeTrack({
  label,
  actionLabel,
  onConfirm,
  amount,
  busy,
  blocked,
  testID,
}: {
  readonly label: string;
  readonly actionLabel: string;
  readonly onConfirm: () => void;
  readonly amount: string | undefined;
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly testID: string;
}) {
  const t = useT('mobile.kitMoney');
  const surface = useSurface();
  const tones = TONES[surface];
  const block = BLOCK[blockSurface(surface)];
  const moves = useMotionAllowed('minimal');

  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const travel = useSharedValue(0);
  const [commits, setCommits] = useState(0);

  const commit = () => {
    haptics.swipeConfirm();
    setCommits((count) => count + 1);
    onConfirm();
  };

  // Back to the start whenever nothing is in flight after a commit: the request failed, the page
  // it opened was dismissed, or the caller refused to send it.
  useEffect(() => {
    if (busy) return;
    x.value = moves ? withSpring(0, spring.snappy) : 0;
  }, [busy, commits, moves, x]);

  const pan = Gesture.Pan()
    .enabled(!blocked)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      start.value = x.value;
    })
    .onUpdate((event) => {
      x.value = Math.min(travel.value, Math.max(0, start.value + event.translationX));
    })
    .onEnd(() => {
      if (swipeCommits(x.value, travel.value)) {
        x.value = moves ? withSpring(travel.value, spring.snappy) : travel.value;
        runOnJS(commit)();
      } else {
        x.value = moves ? withSpring(0, spring.snappy) : 0;
      }
    })
    .withTestId(`${testID}-pan`);

  const onLayout = (event: LayoutChangeEvent) => {
    travel.value = Math.max(0, event.nativeEvent.layout.width - THUMB - INSET * 2);
  };

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const progress = useDerivedValue(() => swipeProgress(x.value, travel.value));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <GestureHandlerRootView style={styles.root}>
      {amount === undefined ? null : (
        <AmountLayers amount={amount} progress={progress} testID={`${testID}-amount`} />
      )}
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityHint={t('swipeHint')}
        accessibilityState={{ disabled: blocked, busy }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName !== 'activate' || blocked) return;
          x.value = moves ? withSpring(travel.value, spring.snappy) : travel.value;
          commit();
        }}
        onLayout={onLayout}
        style={[styles.track, { backgroundColor: block.track }, blocked && !busy && styles.blocked]}
        testID={testID}
      >
        <Animated.Text
          style={[styles.label, { color: tones.secondary }, labelStyle]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {label}
        </Animated.Text>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.thumb, thumbStyle]} testID={`${testID}-thumb`}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.textOnLime} />
            ) : (
              <Icon icon={Glyphs.ArrowRight} size={24} color={colors.textOnLime} />
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

/**
 * The amount twice, stacked: in the surface's ink, and on a `success` capsule in near-black. The
 * drag moves the second one's opacity; nothing animates a colour. `progress` null draws the first
 * alone — the button form, which has no drag.
 */
function AmountLayers({
  amount,
  progress,
  testID,
}: {
  readonly amount: string;
  readonly progress: SharedValue<number> | null;
  readonly testID: string;
}) {
  const surface = useSurface();
  return (
    <View style={styles.amount} accessible accessibilityRole="text" accessibilityLabel={amount} testID={testID}>
      <Text
        style={[styles.amountText, { color: TONES[surface].primary }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {amount}
      </Text>
      {progress === null ? null : <SuccessLayer amount={amount} progress={progress} />}
    </View>
  );
}

function SuccessLayer({ amount, progress }: { readonly amount: string; readonly progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <Animated.View
      style={[styles.successLayer, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="swipe-to-confirm-success"
    >
      <Text style={[styles.amountText, styles.onSuccess]}>{amount}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing[4] },
  amount: { alignSelf: 'center', paddingHorizontal: spacing[3] },
  amountText: {
    ...font.semibold,
    fontSize: fontSize.h2,
    lineHeight: lineHeight.h2,
    letterSpacing: tracking.h2,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  successLayer: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.full,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onSuccess: { color: colors.textOnWhite },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.full,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    textAlign: 'center',
    paddingLeft: THUMB + INSET * 2,
    paddingRight: spacing[4],
  },
  thumb: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    backgroundColor: colors.lime500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blocked: { opacity: 0.4 },
});
