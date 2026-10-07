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

  it('reveals a field focused before the keyboard once the keyboard’s padding shrinks the view', async () => {
    // "Paragraph" with the keyboard down: the new block is focused while it is still in sight…
    const { hook, scrollTo } = await controller();
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 700));
      hook.result.current.onScroll(scrolled(0));
    });
    await act(async () => hook.result.current.value.reveal(field(500, 120)));
    expect(scrollTo).not.toHaveBeenCalled();

    // …then the keyboard covers 336pt of the frame, which pads by it and the scroll view shrinks.
    await act(async () => hook.result.current.onLayout(layout(0, 700 - 336)));
    expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 500 + 120 + spacing[4] - 364, animated: false });
  });

  it('reveals a field focused while the keyboard is already up, in the smaller view', async () => {
    const { hook, scrollTo } = await controller();
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 700));
      hook.result.current.onLayout(layout(0, 364));
      hook.result.current.onScroll(scrolled(0));
    });
    await act(async () => hook.result.current.value.reveal(field(500, 120)));
    expect(scrollTo).toHaveBeenCalledWith({ y: 16 + 500 + 120 + spacing[4] - 364, animated: false });
  });

  it('forgets a field once it loses focus, so the next keyboard does not scroll back to it', async () => {
    // Paragraph 2 typed in, then the keyboard closed and the reader scrolled down to an image.
    const { hook, scrollTo } = await controller();
    const paragraph = field(300, 120);
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 3000));
      hook.result.current.onLayout(layout(0, 700));
      hook.result.current.onScroll(scrolled(0));
    });
    await act(async () => hook.result.current.value.reveal(paragraph));
    await act(async () => hook.result.current.value.release(paragraph));
    await act(async () => hook.result.current.onScroll(scrolled(1400)));
    scrollTo.mockClear();

    // A keyboard arriving now, for nothing in the story, does not pull the view back up.
    await act(async () => hook.result.current.onLayout(layout(0, 364)));
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => hook.result.current.onLayout(layout(0, 700)));

    // The image address takes focus, in sight; then the keyboard's padding shrinks the view.
    const address = field(1900, 90);
    await act(async () => hook.result.current.value.reveal(address));
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => hook.result.current.onLayout(layout(0, 364)));
    // The address is brought above the keyboard; nothing goes back up to paragraph 2.
    expect(scrollTo.mock.calls).toEqual([[{ y: 16 + 1900 + 90 + spacing[4] - 364, animated: false }]]);
  });

  it('does not forget the field now focused when the previous one’s blur arrives after it', async () => {
    const { hook, scrollTo } = await controller();
    const first = field(100, 50);
    const second = field(600, 100);
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 700));
      hook.result.current.onScroll(scrolled(0));
    });
    await act(async () => hook.result.current.value.reveal(first));
    await act(async () => hook.result.current.value.reveal(second));
    await act(async () => hook.result.current.value.release(first));
    await act(async () => hook.result.current.onLayout(layout(0, 364)));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 16 + 600 + 100 + spacing[4] - 364, animated: false });
  });

  it('does not move when the view shrinks with nothing focused', async () => {
    const { hook, scrollTo } = await controller();
    await act(async () => {
      hook.result.current.onContentLayout(layout(16, 2000));
      hook.result.current.onLayout(layout(0, 700));
      hook.result.current.onLayout(layout(0, 364));
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
