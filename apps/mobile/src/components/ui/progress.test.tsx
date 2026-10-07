import type { ReactElement } from 'react';
import { act, render as renderBare, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { PROGRESS_FILL, ProgressBar, fillFraction } from './progress';
import { SurfaceProvider } from './surface';

/**
 * The kit's funding bar — issue #151's Tests section, item by item: it clamps at 100, it turns
 * success (not lime) at 100, it moves on `scaleX` and never on `width`, and its words come from
 * the catalogue. The screens import it from the kit now; the old `components/progress.tsx`
 * re-export and its test are gone, and the one case only that test had — a figure far past the
 * goal is still success, not lime — is here.
 */

/*
 * Reanimated's own Jest helpers, so `getAnimatedStyle` can read a fill's style as it animates under
 * fake timers. Without them the rendered props keep the first frame's value for ever, and a test
 * of where an animation goes cannot tell a rise from a slide.
 */
setUpTests();

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

/** The fill's style where nothing moves, so the figure it settles at is the one drawn. */
async function stillFill(percent: string, size?: 'sm' | 'md') {
  const { getByTestId } = await render(
    <MotionBudgetProvider level="none">
      <ProgressBar completionPercent={percent} label="Funding" size={size} />
    </MotionBudgetProvider>,
  );
  return StyleSheet.flatten(getByTestId(PROGRESS_FILL).props.style) as ViewStyle;
}

function scaleXOf(style: ViewStyle): unknown {
  const transform = style.transform;
  return Array.isArray(transform)
    ? (transform as Record<string, unknown>[]).find((step) => 'scaleX' in step)?.scaleX
    : undefined;
}

describe('ProgressBar (kit)', () => {
  it('fills with scaleX from the left edge, over the full track width — never by width', async () => {
    const style = await stillFill('42.5');
    expect(scaleXOf(style)).toBeCloseTo(0.425, 5);
    expect(style.transformOrigin).toBe('left');
    // The fill is always the track's width; the fraction is a transform, which composites.
    expect(style.width).toBe('100%');
  });

  it('animates the transform, not the width, where motion is allowed', async () => {
    const { getByTestId } = await render(
      <MotionBudgetProvider level="full">
        <ProgressBar completionPercent="60" label="Funding" />
      </MotionBudgetProvider>,
    );
    const style = StyleSheet.flatten(getByTestId(PROGRESS_FILL).props.style) as ViewStyle;
    expect(scaleXOf(style)).toEqual(expect.any(Number));
    expect(style.width).toBe('100%');
  });

  it('clamps the bar at 100 while the words keep the real figure', async () => {
    expect(scaleXOf(await stillFill('340'))).toBe(1);
    expect(fillFraction('340')).toBe(1);

    const { getByText } = await render(
      <MotionBudgetProvider level="none">
        <ProgressBar completionPercent="340" label="Funding" />
      </MotionBudgetProvider>,
    );
    expect(getByText('340% — funded')).toBeTruthy();
  });

  it('is lime below 100', async () => {
    expect((await stillFill('99.4')).backgroundColor).toBe(colors.lime500);
  });

  it('is success at 100, not lime, and gains the funded glow', async () => {
    expect((await stillFill('100')).backgroundColor).toBe(colors.success);
    // Past the goal is still reached: 340% is success, and the bar is not lime again.
    expect((await stillFill('340')).backgroundColor).toBe(colors.success);

    const { getByTestId } = await render(
      <MotionBudgetProvider level="none">
        <ProgressBar completionPercent="100" label="Funding" />
      </MotionBudgetProvider>,
    );
    // The glow is on the track's wrapper, outside the clip that would otherwise hide it.
    const track = getByTestId(PROGRESS_FILL).parent?.parent;
    const shadow = StyleSheet.flatten(track?.props.style as ViewStyle).boxShadow;
    expect(String(shadow)).toContain(colors.limeGlow);
  });

  it('inside a white sheet: a muted track, a dark fill while asking, success once funded', async () => {
    const onWhite = async (percent: string) => {
      const { getByTestId } = await render(
        <MotionBudgetProvider level="none">
          <SurfaceProvider surface="white">
            <ProgressBar completionPercent={percent} label="Funding" />
          </SurfaceProvider>
        </MotionBudgetProvider>,
      );
      const fill = getByTestId(PROGRESS_FILL);
      return {
        fill: (StyleSheet.flatten(fill.props.style) as ViewStyle).backgroundColor,
        track: StyleSheet.flatten(fill.parent?.parent?.props.style as ViewStyle).backgroundColor,
      };
    };
    // Lime on white is 1.3:1 — an invisible fill (CLAUDE.md §2).
    expect(await onWhite('40')).toEqual({ fill: colors.surface1, track: colors.whiteMuted });
    expect((await onWhite('100')).fill).toBe(colors.success);
  });

  it('drops the funded glow at 100 when asked to, keeping success (#162 review completeness)', async () => {
    const { getByTestId } = await render(
      <MotionBudgetProvider level="none">
        <ProgressBar completionPercent="100" label="Completeness" glow={false} />
      </MotionBudgetProvider>,
    );
    const fill = getByTestId(PROGRESS_FILL);
    expect((StyleSheet.flatten(fill.props.style) as ViewStyle).backgroundColor).toBe(colors.success);
    const track = fill.parent?.parent;
    expect(track).toBeTruthy();
    expect(StyleSheet.flatten(track?.props.style as ViewStyle).boxShadow).toBeUndefined();
  });

  it('has no glow while still asking', async () => {
    const { getByTestId } = await render(
      <MotionBudgetProvider level="none">
        <ProgressBar completionPercent="80" label="Funding" />
      </MotionBudgetProvider>,
    );
    const track = getByTestId(PROGRESS_FILL).parent?.parent;
    expect(StyleSheet.flatten(track?.props.style as ViewStyle).boxShadow).toBeUndefined();
  });

  it('reads its words from the catalogue, and they differ between the two states', async () => {
    const asking = await render(<ProgressBar completionPercent="60" label="Funding" />);
    const reached = await render(<ProgressBar completionPercent="100" label="Funding" />);

    expect(asking.getByText(en.common.card.funded.replace('{percent}', '60'))).toBeTruthy();
    expect(reached.getByText(en.mobile.funding.reached.replace('{percent}', '100'))).toBeTruthy();
  });

  it('announces the figure in the catalogue’s words', async () => {
    const { getByRole } = await render(
      <ProgressBar completionPercent="42.5" label="Funding progress for Solar Lamp" />,
    );
    expect(
      getByRole('progressbar', { name: 'Funding progress for Solar Lamp' }).props
        .accessibilityValue,
    ).toEqual({
      min: 0,
      max: 100,
      now: 43,
      text: en.common.card.progressLabel.replace('{percent}', '43'),
    });
  });

  it('keeps announcing the figure when the line under the bar is hidden', async () => {
    const { queryByText, getByRole } = await render(
      <ProgressBar completionPercent="60" label="Funding" showLabel={false} />,
    );
    expect(queryByText('60% funded')).toBeNull();
    expect(getByRole('progressbar').props.accessibilityValue.text).toBe('60 percent of the goal');
  });

  it('draws the web’s heights: sm 6, md 10', async () => {
    const heights = [];
    for (const size of ['sm', 'md'] as const) {
      const { getByTestId } = await render(
        <MotionBudgetProvider level="none">
          <ProgressBar completionPercent="50" label="Funding" size={size} />
        </MotionBudgetProvider>,
      );
      const track = getByTestId(PROGRESS_FILL).parent?.parent;
      heights.push(StyleSheet.flatten(track?.props.style as ViewStyle).height);
    }
    expect(heights).toEqual([6, 10]);
  });

  describe('the timed rise (#162, the editor review score)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('fills over motion.progress (800ms), not on a spring, and lands on the figure', async () => {
      const tree = await renderBare(
        <IntlProvider locale="en" messages={en}>
          <MotionBudgetProvider level="minimal">
            <ProgressBar completionPercent="72" label="Completeness" rise="progress" />
          </MotionBudgetProvider>
        </IntlProvider>,
      );
      const drawn = () =>
        Number(scaleXOf(getAnimatedStyle(tree.getByTestId(PROGRESS_FILL)) as ViewStyle));

      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      const halfway = drawn();
      expect(halfway).toBeGreaterThan(0);
      expect(halfway).toBeLessThan(0.72);

      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(drawn()).toBeCloseTo(0.72, 5);
    });

    it('is drawn at the figure under a none budget', async () => {
      const tree = await renderBare(
        <IntlProvider locale="en" messages={en}>
          <MotionBudgetProvider level="none">
            <ProgressBar completionPercent="72" label="Completeness" rise="progress" />
          </MotionBudgetProvider>
        </IntlProvider>,
      );
      expect(scaleXOf(StyleSheet.flatten(tree.getByTestId(PROGRESS_FILL).props.style) as ViewStyle)).toBeCloseTo(
        0.72,
        5,
      );
    });
  });

  describe('in a recycled list row', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const bar = (percent: string) => (
      <IntlProvider locale="en" messages={en}>
        <MotionBudgetProvider level="full">
          <ProgressBar completionPercent={percent} label="Funding" />
        </MotionBudgetProvider>
      </IntlProvider>
    );

    function drawn(tree: Awaited<ReturnType<typeof render>>): number {
      const style = getAnimatedStyle(tree.getByTestId(PROGRESS_FILL)) as ViewStyle;
      return Number(scaleXOf(style));
    }

    it('rises from zero to a new figure instead of sliding from the last campaign’s', async () => {
      const tree = await renderBare(bar('80'));
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(drawn(tree)).toBeCloseTo(0.8, 5);

      // FlashList hands the same card a different campaign.
      await tree.rerender(bar('12'));
      const frames: number[] = [];
      for (let step = 0; step < 10; step += 1) {
        await act(async () => {
          jest.advanceTimersByTime(100);
        });
        frames.push(drawn(tree));
      }

      // Never above the new figure: an 80% bar sliding down to 12% reads as money leaving.
      expect(Math.max(...frames)).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(frames.at(-1)).toBeCloseTo(0.12, 5);
    });
  });

  describe('motion', () => {
    afterEach(() => jest.restoreAllMocks());

    function drawn(tree: Awaited<ReturnType<typeof render>>): number {
      return Number(scaleXOf(getAnimatedStyle(tree.getByTestId(PROGRESS_FILL) as never) as ViewStyle));
    }

    it('rises from zero to the figure on a spring that never passes it', async () => {
      const tree = await render(<ProgressBar completionPercent="60" label="Funding" />);
      const frames: number[] = [];
      await waitFor(
        () => {
          frames.push(drawn(tree));
          expect(frames.at(-1)).toBeCloseTo(0.6, 3);
        },
        { timeout: 3000, interval: 16 },
      );
      expect(Math.min(...frames)).toBeLessThan(0.6);
      expect(Math.max(...frames)).toBeLessThanOrEqual(0.6 + 1e-6);
    });

    it('is drawn at the figure at once under Reduce Motion', async () => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      const tree = await render(<ProgressBar completionPercent="60" label="Funding" />);
      await waitFor(() => expect(drawn(tree)).toBeCloseTo(0.6, 5));
      // A different figure arrives: it is drawn there on the next frame, not sprung to.
      await tree.rerender(
        <IntlProvider locale="en" messages={en}>
          <ProgressBar completionPercent="25" label="Funding" />
        </IntlProvider>,
      );
      expect(drawn(tree)).toBeCloseTo(0.25, 5);
    });

    it('draws the timed rise at its figure at once under Reduce Motion, too', async () => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      const bar = (percent: string) => (
        <MotionBudgetProvider level="minimal">
          <ProgressBar completionPercent={percent} label="Completeness" rise="progress" />
        </MotionBudgetProvider>
      );
      const tree = await render(bar('72'));
      await waitFor(() => expect(drawn(tree)).toBeCloseTo(0.72, 5));
      await tree.rerender(<IntlProvider locale="en" messages={en}>{bar('30')}</IntlProvider>);
      // Drawn there on the next frame: not timed over 800ms.
      expect(drawn(tree)).toBeCloseTo(0.3, 5);
    });
  });

  it('draws nothing rather than throwing on a figure it cannot read', async () => {
    expect(scaleXOf(await stillFill('not-a-number'))).toBe(0);
    expect(scaleXOf(await stillFill(''))).toBe(0);
  });
});
