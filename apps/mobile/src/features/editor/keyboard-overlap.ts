import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';

/**
 * How much of a view the software keyboard covers — the editor's keyboard handling (#162).
 *
 * <h2>Why not `KeyboardAvoidingView` with no behaviour on Android</h2>
 *
 * The app draws edge to edge (Expo 57), and an edge-to-edge window is NOT resized by Android's
 * `adjustResize`: the keyboard is drawn over it. The first device test (a Xiaomi on Android 12)
 * showed it — "Start editing" and a newly added story paragraph both stayed under Gboard, because
 * the screens counted on the window shrinking. So the editor measures instead, on both platforms:
 * the keyboard's top edge (`endCoordinates.screenY`) against the view's own frame in the window
 * (`measureInWindow`). The difference is how much is covered, and the view pads its bottom by it.
 *
 * <p>Where the window DOES shrink (an Android build that resizes, a floating keyboard on an iPad)
 * the view's bottom is already above the keyboard and the overlap is 0, so nothing is avoided
 * twice. The frame is measured again whenever the view is laid out, which is when such a resize
 * shows up.
 *
 * <p>The padding goes on a wrapper whose own frame does not change with it, so applying it does
 * not trigger another measurement. It is not animated: the editor's motion budget is none.
 *
 * <p>iOS reports the keyboard before it moves (`keyboardWillChangeFrame`, which also covers a
 * height change such as the QuickType bar); Android only after (`keyboardDidShow`).
 */

/** The covered height of a frame whose window position is `y` and height `height`. */
export function keyboardOverlap(frame: { readonly y: number; readonly height: number }, keyboardTop: number): number {
  return Math.max(0, Math.round(frame.y + frame.height - keyboardTop));
}

const SHOW = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

export interface KeyboardOverlap {
  /** The view to measure — the one that pads its bottom by `overlap`. */
  readonly ref: RefObject<View | null>;
  /** Its `onLayout`: the frame may have moved or been resized. */
  readonly onLayout: () => void;
  /** Points of the view under the keyboard; 0 with no keyboard. */
  readonly overlap: number;
  /** Whether a keyboard is up at all, covering this view or not. */
  readonly keyboardShown: boolean;
}

export function useKeyboardOverlap(): KeyboardOverlap {
  const ref = useRef<View | null>(null);
  /** The keyboard's top edge in window terms, or null when there is no keyboard. */
  const keyboardTop = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);
  const [keyboardShown, setKeyboardShown] = useState(false);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    const node = ref.current;
    if (top === null || node === null || typeof node.measureInWindow !== 'function') {
      setOverlap(0);
      return;
    }
    node.measureInWindow((_x, y, _width, height) => {
      // The keyboard may have gone while the measurement was on its way.
      if (keyboardTop.current === null) return;
      setOverlap(keyboardOverlap({ y, height }, keyboardTop.current));
    });
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener(SHOW, (event: KeyboardEvent) => {
      const { screenY, height } = event.endCoordinates;
      // A keyboard with no height, or an iPad's floating one reported at the top, covers nothing.
      const up = height > 0 && screenY > 0;
      keyboardTop.current = up ? screenY : null;
      setKeyboardShown(up);
      measure();
    });
    const hidden = Keyboard.addListener(HIDE, () => {
      keyboardTop.current = null;
      setKeyboardShown(false);
      setOverlap(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [measure]);

  return { ref, onLayout: measure, overlap, keyboardShown };
}
