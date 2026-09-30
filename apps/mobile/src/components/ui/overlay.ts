import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from '../../theme';
import { useMotionAllowed } from './motion-budget';

/**
 * What `Dialog` and `Sheet` share: where screen-reader focus goes when they open and close, and
 * their entry motion. Not exported from the kit's barrel — a screen uses the overlays, not these.
 *
 * <p>The web's `useFocusTrap`, `useDismiss` and `useScrollLock` have no native port (issue
 * #151). A React Native `Modal` is its own window on both platforms, so the trap and the scroll
 * lock come with it; what is left to do by hand is the focus move in and back out, and that is
 * here.
 */

/** Anything that can receive accessibility focus — a `View`, a `Text`, a `Pressable`. */
type Focusable = Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0];

/**
 * How long to wait before moving focus into a freshly presented overlay.
 *
 * <p>The `Modal`'s window has to exist before VoiceOver or TalkBack can land on anything in it,
 * and a focus event sent in the same frame the modal is presented is dropped. A tenth of a
 * second is below what anyone perceives as a wait and above the frame in which it is lost.
 */
export const FOCUS_DELAY_MS = 100;

/**
 * Move screen-reader focus to `node`.
 *
 * <p>Through `sendAccessibilityEvent(node, 'focus')` and not `setAccessibilityFocus(reactTag)`:
 * the latter is deprecated in React Native 0.86, takes a legacy numeric tag that
 * `findNodeHandle` has to dig out of the renderer, and routes through the old architecture's
 * event path. The former takes the element itself and goes through whichever renderer drew it.
 */
export function focusOn(node: unknown): void {
  if (node === null || node === undefined) return;
  AccessibilityInfo.sendAccessibilityEvent(node as Focusable, 'focus');
}

/**
 * Focus in on open, focus back on close — the web's focus trap's two ends.
 *
 * <p>On open, focus goes to the title, so the first thing read is what the overlay is about
 * rather than whatever element happened to be first. On close, it goes back to the control that
 * opened it (`returnTo`), so somebody who confirmed or dismissed a dialog carries on from where
 * they were instead of being dropped at the top of the screen.
 */
export function useOverlayFocus(
  visible: boolean,
  title: RefObject<unknown>,
  returnTo: RefObject<unknown> | undefined,
): void {
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      const timer = setTimeout(() => focusOn(title.current), FOCUS_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (!wasVisible.current) return undefined;
    wasVisible.current = false;
    const timer = setTimeout(() => focusOn(returnTo?.current), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, title, returnTo]);
}

/** How far an overlay travels on entry: the web's `useOverlayEntry({ y: 24 })`. */
export const ENTRY_OFFSET = 24;

/**
 * An overlay's entry: 200ms (`motion.overlay`) of opacity and a 24pt rise, transform and opacity
 * only — `packages/ui`'s `overlayMotion`. There is no exit animation, for the web's reason: a
 * dialog that lingers after it was dismissed reads as an unresponsive interface.
 *
 * <p>Only when `useMotionAllowed('minimal')` agrees. Under Reduce Motion or a budget of `none`
 * (checkout, the editor) `animated` is false and the caller draws the panel in its final place
 * with no animated style at all — an instant state change, not a fast animation.
 */
export function useOverlayEntry(visible: boolean) {
  const animated = useMotionAllowed('minimal');
  const progress = useSharedValue(animated ? 0 : 1);

  useEffect(() => {
    if (!visible) {
      // Reset while hidden, so the next opening starts from the beginning. No exit animation.
      progress.value = 0;
      return;
    }
    progress.value = animated ? withTiming(1, { duration: motion.overlay }) : 1;
  }, [visible, animated, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ENTRY_OFFSET }],
  }));

  return { animated, style } as const;
}
