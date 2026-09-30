import type { ReactElement } from 'react';
import { fireEvent, render as renderBare, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { FadeIn } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MotionBudgetProvider } from './motion-budget';
import {
  SKELETON_SHIMMER,
  Skeleton,
  SkeletonCard,
  SkeletonCrossfade,
  SkeletonGroup,
} from './skeleton';

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
