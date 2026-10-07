import { act, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';
import { spacing } from '../../../theme';
import { useStoryScrollController } from './story-scroll';

/** A field measured at `y` (inside the column) and `height` tall. */
function field(y: number, height: number): View {
  return {
    measureLayout: (_relativeTo: unknown, success: (x: number, y: number, w: number, h: number) => void) =>
      success(0, y, 300, height),
  } as unknown as View;
}

const layout = (y: number, height: number) => ({ nativeEvent: { layout: { x: 0, y, width: 390, height } } }) as LayoutChangeEvent;
const scrolled = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as unknown as NativeSyntheticEvent<NativeScrollEvent>;

async function controller() {
  const scrollTo = jest.fn();
  const scroll = { current: { scrollTo } as unknown as ScrollView };
  const content = { current: {} as View };
  const hook = await renderHook(() => useStoryScrollController({ scroll, content }));
  return { hook, scrollTo };
}

describe('useStoryScrollController', () => {
  it('scrolls a field below the view into sight, counting the page’s top padding', async () => {
    const { hook, scrollTo } = await controller();
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 400));
      hook.result.current.onScroll(scrolled(0));
    });
    await act(async () => hook.result.current.value.reveal(field(600, 100)));
    // Bottom of the field (16 + 600 + 100) plus the margin, at the bottom of a 400pt view.
    expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 600 + 100 + spacing[4] - 400, animated: false });
  });

  it('scrolls back up to a field above the view, and leaves a visible one alone', async () => {
    const { hook, scrollTo } = await controller();
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 400));
      hook.result.current.onScroll(scrolled(800));
    });
    await act(async () => hook.result.current.value.reveal(field(300, 50)));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 16 + 300 - spacing[4], animated: false });

    scrollTo.mockClear();
    await act(async () => hook.result.current.onScroll(scrolled(300)));
    await act(async () => hook.result.current.value.reveal(field(400, 50)));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
