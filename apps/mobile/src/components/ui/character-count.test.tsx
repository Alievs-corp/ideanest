import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import { colors } from '../../theme';
import { CharacterCount } from './character-count';
import { SurfaceProvider, TONES } from './surface';

/**
 * The count's two jobs: say the right sentence in the reader's plural, and speak it only when it
 * starts to matter — once, after the typing pauses, not once per keystroke.
 */

function Russian({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="ru" messages={ru}>
      {children}
    </IntlProvider>
  );
}

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

describe('CharacterCount', () => {
  it.each([
    [1, 'Остался 1 символ'],
    [2, 'Осталось 2 символа'],
    [5, 'Осталось 5 символов'],
  ])('uses the Russian form for %i remaining', async (remaining, sentence) => {
    const { getByText } = await render(<CharacterCount count={60 - remaining} limit={60} />, {
      wrapper: Russian,
    });
    expect(getByText(sentence)).toBeTruthy();
  });

  it('says how many too many in words, then in danger — the colour is not the message', async () => {
    const { getByText } = await render(<CharacterCount count={63} limit={60} />, {
      wrapper: English,
    });
    const count = getByText('3 characters too many');
    expect(StyleSheet.flatten(count.props.style).color).toBe(colors.danger);
  });

  it('is tertiary and tabular while under the limit', async () => {
    const { getByText } = await render(<CharacterCount count={10} limit={60} />, {
      wrapper: English,
    });
    expect(StyleSheet.flatten(getByText('50 characters remaining').props.style)).toMatchObject({
      color: colors.textTertiary,
      fontVariant: ['tabular-nums'],
      fontSize: 13,
    });
  });

  it('switches tone on the render that crosses the limit, with nothing animated', async () => {
    const tree = await render(<CharacterCount count={60} limit={60} />, { wrapper: English });
    await tree.rerender(<CharacterCount count={61} limit={60} />);
    const style = StyleSheet.flatten(tree.getByText('1 character too many').props.style);
    expect(style.color).toBe(colors.danger);
    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });

  it('on a white sheet: on-white tertiary under the limit, on-white ink over it', async () => {
    const tree = await render(
      <SurfaceProvider surface="white">
        <CharacterCount count={10} limit={60} />
      </SurfaceProvider>,
      { wrapper: English },
    );
    expect(StyleSheet.flatten(tree.getByText('50 characters remaining').props.style).color).toBe(
      TONES.white.tertiary,
    );
    await tree.rerender(
      <SurfaceProvider surface="white">
        <CharacterCount count={63} limit={60} />
      </SurfaceProvider>,
    );
    // Danger text measures about 3.4:1 on white: the words carry it, in legible ink.
    expect(StyleSheet.flatten(tree.getByText('3 characters too many').props.style).color).toBe(
      colors.textOnWhite,
    );
  });

  describe('announcing', () => {
    let announced: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      jest.clearAllMocks();
      announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const advance = (ms: number) =>
      act(() => {
        jest.advanceTimersByTime(ms);
      });

    it('says nothing while far from the limit', async () => {
      await render(<CharacterCount count={10} limit={60} />, { wrapper: English });
      await advance(5000);
      expect(announced).not.toHaveBeenCalled();
    });

    it('announces exactly once when fast typing crosses 20 remaining, after it pauses', async () => {
      const tree = await render(<CharacterCount count={35} limit={60} />, { wrapper: English });

      // Seven keystrokes, 150ms apart, from 25 remaining to 18: across the threshold, never still.
      for (let count = 36; count <= 42; count += 1) {
        await tree.rerender(<CharacterCount count={count} limit={60} />);
        await advance(150);
      }
      expect(announced).not.toHaveBeenCalled();

      await advance(1000);
      expect(announced).toHaveBeenCalledTimes(1);
      expect(announced).toHaveBeenCalledWith('18 characters remaining', { queue: true });

      // Nothing more while the count stands still.
      await advance(5000);
      expect(announced).toHaveBeenCalledTimes(1);
    });

    it('does not repeat the same sentence when the timer runs again', async () => {
      const tree = await render(<CharacterCount count={45} limit={60} />, { wrapper: English });
      await advance(1000);
      expect(announced).toHaveBeenCalledTimes(1);

      // A new delay re-runs the effect and arms a fresh timer for the SAME sentence: only the
      // memory of what was last said keeps it from being said twice.
      await tree.rerender(<CharacterCount count={45} limit={60} announceDelayMs={900} />);
      await advance(1000);
      expect(announced).toHaveBeenCalledTimes(1);

      // A different sentence is still announced.
      await tree.rerender(<CharacterCount count={46} limit={60} announceDelayMs={900} />);
      await advance(1000);
      expect(announced).toHaveBeenCalledTimes(2);
    });
  });
});
