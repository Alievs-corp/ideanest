import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from 'react-native';
import { spacing } from '../../../theme';

/**
 * Keeping the caret visible in a long story (#162, "Block story editor on a phone").
 *
 * <p>The blocks are cards in ONE `ScrollView` in a frame that pads its bottom by what the keyboard
 * covers (`useKeyboardOverlap` — an edge-to-edge Android window is not resized for the keyboard,
 * so the panel cannot wait for the window to shrink). When a field takes focus — or the keyboard
 * arrives and that padding shrinks the scroll view under it — the field (with its formatting
 * toolbar) is measured against the scroll content and, if any of it is out of sight, scrolled into
 * view with a margin. Both orders happen: a block added while the keyboard is down is focused
 * first and covered after, one added while it is up is focused into an already smaller view. Not
 * animated: the editor's motion budget is none.
 *
 * <p>A field calls `reveal(node)` from its `onFocus` and `release(node)` from its `onBlur` (blocks,
 * image address and alt text, Risks); the panel wires `onScroll` and `onLayout`. Releasing matters:
 * a field that kept the keyboard's attention after it lost focus would be scrolled back to when
 * the keyboard next arrives for another one — a paragraph typed in earlier pulling the view away
 * from the image address now being typed. `release` forgets only the node it is given, so a blur
 * that lands after the next field's focus does not forget that field.
 */
interface StoryScroll {
  readonly reveal: (node: View | null) => void;
  readonly release: (node: View | null) => void;
}

const Context = createContext<StoryScroll>({ reveal: () => {}, release: () => {} });

export function useStoryScroll(): StoryScroll {
  return useContext(Context);
}

/** The margin left above or below a revealed field. */
const MARGIN = spacing[4];

export function useStoryScrollController({
  scroll,
  content,
}: {
  readonly scroll: RefObject<ScrollView | null>;
  readonly content: RefObject<View | null>;
}) {
  const viewport = useRef({ offset: 0, height: 0 });
  const focused = useRef<View | null>(null);
  /** Where the measured column starts inside the scrolled content: the page's top padding. */
  const contentTop = useRef(0);

  const place = useCallback(
    (node: View): void => {
      const relativeTo = content.current;
      if (relativeTo === null || typeof node.measureLayout !== 'function') return;
      node.measureLayout(
        relativeTo,
        (_x, inColumn, _width, height) => {
          // In the scroll view's terms, which is what `scrollTo` and the offset are in.
          const y = inColumn + contentTop.current;
          const { offset, height: visible } = viewport.current;
          if (visible <= 0) return;
          let target: number | null = null;
          if (y - MARGIN < offset) target = y - MARGIN;
          else if (y + height + MARGIN > offset + visible) {
            // A field taller than the view shows its top, where the toolbar is.
            target = height + 2 * MARGIN > visible ? y - MARGIN : y + height + MARGIN - visible;
          }
          if (target !== null) scroll.current?.scrollTo({ y: Math.max(0, target), animated: false });
        },
        () => {},
      );
    },
    [scroll, content],
  );

  const reveal = useCallback(
    (node: View | null): void => {
      focused.current = node;
      if (node !== null) place(node);
    },
    [place],
  );

  const release = useCallback((node: View | null): void => {
    if (focused.current === node) focused.current = null;
  }, []);

  // The keyboard arriving is what usually hides the field, so it is placed again then.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      if (focused.current !== null) place(focused.current);
    });
    return () => shown.remove();
  }, [place]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.current = { ...viewport.current, offset: event.nativeEvent.contentOffset.y };
  }, []);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const shrank = height < viewport.current.height;
      viewport.current = { ...viewport.current, height };
      if (shrank && focused.current !== null) place(focused.current);
    },
    [place],
  );

  /** The measured column's own layout, for its offset inside the scroll content. */
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    contentTop.current = event.nativeEvent.layout.y;
  }, []);

  const value = useMemo(() => ({ reveal, release }), [reveal, release]);
  return { value, onScroll, onLayout, onContentLayout };
}

export function StoryScrollProvider({ value, children }: { readonly value: StoryScroll; readonly children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
