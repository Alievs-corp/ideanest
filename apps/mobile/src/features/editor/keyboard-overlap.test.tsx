import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, type EmitterSubscription, type KeyboardEvent, type View } from 'react-native';
import { keyboardOverlap, useKeyboardOverlap } from './keyboard-overlap';

/**
 * The editor's keyboard measurement (#162's first device test): an edge-to-edge Android window is
 * not resized for the keyboard, so the covered height is measured, not assumed.
 */

type Handler = (event: KeyboardEvent) => void;

function keyboardEvents() {
  const handlers = new Map<string, Handler>();
  const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: Handler) => {
    handlers.set(name, handler);
    return { remove: () => handlers.delete(name) } as unknown as EmitterSubscription;
  }) as unknown as typeof Keyboard.addListener);
  const emit = (name: string, screenY = 0, height = 0) =>
    handlers.get(name)?.({ endCoordinates: { screenX: 0, screenY, width: 390, height } } as KeyboardEvent);
  return { spy, handlers, emit };
}

/** A view whose frame in the window starts at `y` and is `height` tall. */
function frame(y: number, height: number): View {
  return {
    measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) =>
      callback(0, y, 390, height),
  } as unknown as View;
}

afterEach(() => jest.restoreAllMocks());

describe('keyboardOverlap', () => {
  it('is how far the frame reaches below the keyboard’s top edge', () => {
    // A view from 100 to 844 in an 844pt window, the keyboard's top at 500.
    expect(keyboardOverlap({ y: 100, height: 744 }, 500)).toBe(344);
  });

  it('is 0 when the view already ends above the keyboard — a window that did resize', () => {
    expect(keyboardOverlap({ y: 100, height: 400 }, 500)).toBe(0);
  });
});

describe('useKeyboardOverlap', () => {
  it('pads by what the keyboard covers when it arrives, and by nothing when it goes', async () => {
    const { emit } = keyboardEvents();
    const hook = await renderHook(() => useKeyboardOverlap());
    hook.result.current.ref.current = frame(91, 753);
    expect(hook.result.current.overlap).toBe(0);
    expect(hook.result.current.keyboardShown).toBe(false);

    // jest-expo runs as iOS: the keyboard says where it is going before it moves.
    await act(async () => emit('keyboardWillChangeFrame', 508, 336));
    expect(hook.result.current.overlap).toBe(91 + 753 - 508);
    expect(hook.result.current.keyboardShown).toBe(true);

    await act(async () => emit('keyboardWillHide'));
    expect(hook.result.current.overlap).toBe(0);
    expect(hook.result.current.keyboardShown).toBe(false);
  });

  it('measures again on layout, so a window that shrank for the keyboard is not avoided twice', async () => {
    const { emit } = keyboardEvents();
    const hook = await renderHook(() => useKeyboardOverlap());
    hook.result.current.ref.current = frame(0, 844);
    await act(async () => emit('keyboardWillChangeFrame', 500, 344));
    expect(hook.result.current.overlap).toBe(344);

    hook.result.current.ref.current = frame(0, 500);
    await act(async () => hook.result.current.onLayout());
    expect(hook.result.current.overlap).toBe(0);
  });

  it('treats a keyboard with no height, or a floating one at the top, as no keyboard', async () => {
    const { emit } = keyboardEvents();
    const hook = await renderHook(() => useKeyboardOverlap());
    hook.result.current.ref.current = frame(0, 844);
    await act(async () => emit('keyboardWillChangeFrame', 0, 300));
    expect(hook.result.current.overlap).toBe(0);
    expect(hook.result.current.keyboardShown).toBe(false);
  });

  it('stops listening when it unmounts', async () => {
    const { handlers } = keyboardEvents();
    const hook = await renderHook(() => useKeyboardOverlap());
    expect(handlers.size).toBe(2);
    await hook.unmount();
    expect(handlers.size).toBe(0);
  });
});
