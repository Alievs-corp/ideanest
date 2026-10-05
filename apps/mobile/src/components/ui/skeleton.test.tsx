import { Profiler, type ReactElement } from 'react';
import { act, fireEvent, render as renderBare, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { FadeIn, getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, tint } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import {
  SKELETON_SHIMMER,
  Skeleton,
  SkeletonCard,
  SkeletonCrossfade,
  SkeletonGroup,
} from './skeleton';
import { SurfaceProvider } from './surface';

/**
 * Placeholders: the shimmer only runs where motion is allowed, a screen reader hears one sentence
 * rather than forty rectangles, and the swap to content fades only where the budget allows it.
 */

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

/** A skeleton that has been laid out, which is when the shimmer knows how far to travel. */
async function laidOut(ui: ReactElement) {
  const tree = await render(ui);
  await fireEvent(tree.getByTestId('block', { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { width: 200, height: 16, x: 0, y: 0 } },
  });
  return tree;
}

describe('Skeleton', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shimmers where the budget allows motion', async () => {
    const tree = await laidOut(
      <MotionBudgetProvider level="minimal">
        <Skeleton testID="block" />
      </MotionBudgetProvider>,
    );
    expect(tree.queryByTestId(SKELETON_SHIMMER, { includeHiddenElements: true })).not.toBeNull();
  });

  it('is static under a budget of none — no shimmer at all, not a frozen one', async () => {
    const tree = await laidOut(
      <MotionBudgetProvider level="none">
        <Skeleton testID="block" />
      </MotionBudgetProvider>,
    );
    expect(tree.queryByTestId(SKELETON_SHIMMER, { includeHiddenElements: true })).toBeNull();
  });

  it('is static when the device asks for Reduce Motion, whatever the budget', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const tree = await laidOut(
      <MotionBudgetProvider level="full">
        <Skeleton testID="block" />
      </MotionBudgetProvider>,
    );
    // The setting arrives asynchronously, so this waits for its answer rather than the first frame.
    await waitFor(() =>
      expect(tree.queryByTestId(SKELETON_SHIMMER, { includeHiddenElements: true })).toBeNull(),
    );
  });

  it('is hidden from assistive technology', async () => {
    const { getByTestId } = await render(<Skeleton testID="block" />);
    expect(
      getByTestId('block', { includeHiddenElements: true }).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('is surface-3 on the canvas and the sheet’s muted tone inside a white sheet', async () => {
    const fill = (tree: Awaited<ReturnType<typeof render>>) =>
      StyleSheet.flatten(
        tree.getByTestId('block', { includeHiddenElements: true }).props.style as ViewStyle,
      ).backgroundColor;
    expect(fill(await render(<Skeleton testID="block" />))).toBe(colors.surface3);
    expect(
      fill(
        await render(
          <SurfaceProvider surface="white">
            <Skeleton testID="block" />
          </SurfaceProvider>,
        ),
      ),
    ).toBe(colors.whiteMuted);
  });

  it('draws its band as a native gradient, with no SVG under it', async () => {
    const tree = await laidOut(
      <MotionBudgetProvider level="minimal">
        <Skeleton testID="block" />
      </MotionBudgetProvider>,
    );
    const shimmer = tree.getByTestId(SKELETON_SHIMMER, { includeHiddenElements: true });
    const style = StyleSheet.flatten(shimmer.props.style as ViewStyle) as ViewStyle & {
      experimental_backgroundImage?: { colorStops: { color: string }[] }[];
    };
    expect(style.experimental_backgroundImage?.[0]?.colorStops.map((stop) => stop.color)).toEqual([
      tint(colors.surface4, 0),
      colors.surface4,
      tint(colors.surface4, 0),
    ]);
    expect(JSON.stringify(tree.toJSON())).not.toContain('RNSVG');
  });

  it('takes the white sheet’s band inside a white sheet', async () => {
    const tree = await laidOut(
      <MotionBudgetProvider level="minimal">
        <SurfaceProvider surface="white">
          <Skeleton testID="block" />
        </SurfaceProvider>
      </MotionBudgetProvider>,
    );
    const shimmer = tree.getByTestId(SKELETON_SHIMMER, { includeHiddenElements: true });
    const style = StyleSheet.flatten(shimmer.props.style as ViewStyle) as ViewStyle & {
      experimental_backgroundImage?: { colorStops: { color: string }[] }[];
    };
    expect(style.experimental_backgroundImage?.[0]?.colorStops[1]?.color).toBe(colors.whiteSurface);
  });

  it('keeps the band hidden until the block has a width', async () => {
    const tree = await render(
      <MotionBudgetProvider level="minimal">
        <Skeleton testID="block" />
      </MotionBudgetProvider>,
    );
    const band = () =>
      getAnimatedStyle(tree.getByTestId(SKELETON_SHIMMER, { includeHiddenElements: true }) as never) as {
        opacity?: number;
      };
    expect(band().opacity).toBe(0);
    await fireEvent(tree.getByTestId('block', { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { width: 200, height: 16, x: 0, y: 0 } },
    });
    await waitFor(() => expect(band().opacity).toBe(1));
  });

  it('does not render the page again when a block is laid out', async () => {
    const commits = jest.fn();
    const tree = await render(
      <Profiler id="skeleton" onRender={commits}>
        <MotionBudgetProvider level="minimal">
          <Skeleton testID="block" />
        </MotionBudgetProvider>
      </Profiler>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const before = commits.mock.calls.length;
    await fireEvent(tree.getByTestId('block', { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { width: 200, height: 16, x: 0, y: 0 } },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(commits.mock.calls.length).toBe(before);
  });

  it('runs every band on one clock, so a block mounted later is in step', async () => {
    function Pair({ second }: { readonly second: boolean }) {
      return (
        <MotionBudgetProvider level="minimal">
          <View>
            <Skeleton testID="first" />
            {second ? <Skeleton testID="second" /> : null}
          </View>
        </MotionBudgetProvider>
      );
    }
    const tree = await render(<Pair second={false} />);
    await fireEvent(tree.getByTestId('first', { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { width: 200, height: 16, x: 0, y: 0 } },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await tree.rerender(
      <IntlProvider locale="en" messages={en}>
        <Pair second />
      </IntlProvider>,
    );
    await fireEvent(tree.getByTestId('second', { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { width: 100, height: 16, x: 0, y: 0 } },
    });
    const bands = tree.getAllByTestId(SKELETON_SHIMMER, { includeHiddenElements: true });
    const phase = (index: number, width: number) => {
      const style = getAnimatedStyle(bands[index] as never) as {
        transform?: { translateX?: number }[];
      };
      return (style.transform?.[0]?.translateX ?? 0) / width;
    };
    await waitFor(() => expect(phase(1, 100)).not.toBe(-1));
    // translateX / width is 2·progress − 1: the same progress for both, though one mounted later.
    expect(phase(1, 100)).toBeCloseTo(phase(0, 200), 2);
  });

  it('is round when it stands in for an avatar', async () => {
    const { getByTestId } = await render(<Skeleton testID="block" circle height={40} />);
    const style = getByTestId('block', { includeHiddenElements: true }).props.style;
    expect(JSON.stringify(style)).toContain('"width":40');
  });
});

describe('SkeletonGroup', () => {
  it('is one accessible element, busy, named by the caller, with its placeholders hidden', async () => {
    const { getByLabelText } = await render(
      <SkeletonGroup label="Loading your pledges">
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonGroup>,
    );
    const group = getByLabelText('Loading your pledges');
    expect(group.props.accessible).toBe(true);
    expect(group.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('falls back to the catalogue’s word when the caller gives none', async () => {
    const { getByLabelText } = await render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    expect(getByLabelText(en.common.list.loadingMore)).toBeTruthy();
  });
});

describe('SkeletonCrossfade', () => {
  let fade: jest.SpyInstance;
  beforeEach(() => {
    fade = jest.spyOn(FadeIn, 'duration');
  });
  afterEach(() => jest.restoreAllMocks());

  function swap(loading: boolean) {
    return (
      <SkeletonCrossfade loading={loading} placeholder={<Text>placeholder</Text>}>
        <Text>content</Text>
      </SkeletonCrossfade>
    );
  }

  it('crossfades over motion.overlay when the content replaces a placeholder', async () => {
    const tree = await render(
      <MotionBudgetProvider level="minimal">{swap(true)}</MotionBudgetProvider>,
    );
    expect(tree.getByText('placeholder')).toBeTruthy();
    await tree.rerender(
      <IntlProvider locale="en" messages={en}>
        <MotionBudgetProvider level="minimal">{swap(false)}</MotionBudgetProvider>
      </IntlProvider>,
    );
    expect(tree.getByText('content')).toBeTruthy();
    expect(fade).toHaveBeenCalledWith(200);
  });

  it('swaps instantly under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const tree = await render(
      <MotionBudgetProvider level="full">{swap(true)}</MotionBudgetProvider>,
    );
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    await tree.rerender(
      <IntlProvider locale="en" messages={en}>
        <MotionBudgetProvider level="full">{swap(false)}</MotionBudgetProvider>
      </IntlProvider>,
    );
    expect(tree.getByText('content')).toBeTruthy();
    expect(fade).not.toHaveBeenCalled();
  });

  it('swaps instantly under a budget of none', async () => {
    const tree = await render(
      <MotionBudgetProvider level="none">{swap(true)}</MotionBudgetProvider>,
    );
    await tree.rerender(
      <IntlProvider locale="en" messages={en}>
        <MotionBudgetProvider level="none">{swap(false)}</MotionBudgetProvider>
      </IntlProvider>,
    );
    expect(tree.getByText('content')).toBeTruthy();
    expect(fade).not.toHaveBeenCalled();
  });

  it('does not fade content that was ready on the first render', async () => {
    const tree = await render(
      <MotionBudgetProvider level="full">{swap(false)}</MotionBudgetProvider>,
    );
    expect(tree.getByText('content')).toBeTruthy();
    expect(fade).not.toHaveBeenCalled();
  });
});
