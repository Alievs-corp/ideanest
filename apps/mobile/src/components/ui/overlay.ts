import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { spring } from '../../theme';
import { useMotionAllowed } from './motion-budget';

/**
 * What `Dialog` and `Sheet` share: where screen-reader focus goes when they open and close, the
 * page behind that they lift, and their presence on springs. Not exported from the kit's barrel —
 * a screen uses the overlays, not these.
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

/**
 * The page an overlay rises over: how far up the overlay that is open is, 0 to 1. `SheetHost`
 * provides it and scales the page from it; `Sheet` and `Dialog` drive it.
 */
export const OverlayHostContext = createContext<SharedValue<number> | null>(null);

/**
 * Hand an overlay's rise (0 gone, 1 fully up) to the page behind while the overlay is `active`.
 * Only an overlay that is up drives the page: a closed one mounting elsewhere leaves it alone, and
 * one that unmounts while up puts the page back.
 */
export function useHostLift(
  rise: SharedValue<number>,
  active: SharedValue<boolean>,
): SharedValue<number> | null {
  const host = useContext(OverlayHostContext);
  useAnimatedReaction(
    () => rise.value,
    (risen) => {
      if (host !== null && active.value) host.value = risen;
    },
    [host],
  );
  useEffect(
    () => () => {
      if (host !== null && active.value) host.value = 0;
    },
    [host, active],
  );
  return host;
}

/**
 * A centred overlay's presence — the `Dialog`. `progress` springs to 1 on open (`spring.soft`) and
 * back to 0 on close (`spring.snappy`, so a dismissed dialog does not linger); `mounted` stays true
 * until the fall ends, so the modal is not cut mid-frame. `visible` is the truth for touch and
 * screen readers: from the moment it is closed nothing in it takes either. The page behind lifts
 * with it under a `SheetHost`.
 *
 * <p>With Reduce Motion on (or a budget of `none`) `animated` is false and `progress` jumps: the
 * caller then draws the overlay with no animated style at all — a state change, not a fast
 * animation.
 */
export function useOverlayPresence(visible: boolean) {
  const animated = useMotionAllowed('minimal');
  const [mounted, setMounted] = useState(visible);
  const shown = useRef(visible);
  const active = useSharedValue(visible);
  const progress = useSharedValue(visible && !animated ? 1 : 0);
  const host = useHostLift(progress, active);

  useEffect(() => {
    if (visible) {
      shown.current = true;
      active.value = true;
      setMounted(true);
      progress.value = animated ? withSpring(1, spring.soft) : 1;
      return;
    }
    if (!shown.current) return;
    const gone = () => {
      shown.current = false;
      setMounted(false);
    };
    if (!animated) {
      progress.value = 0;
      if (host !== null && active.value) host.value = 0;
      active.value = false;
      gone();
      return;
    }
    progress.value = withSpring(0, spring.snappy, (finished) => {
      if (finished === true) {
        active.value = false;
        runOnJS(gone)();
      }
    });
  }, [visible, animated, progress, active, host]);

  return { animated, mounted, progress } as const;
}
