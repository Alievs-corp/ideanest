import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { spacing } from '../../theme';
import { CardStack, LAYER_SCALE, PEEK, STACK_DEPTH, stackHeight, type CardStackItem } from './card-stack';
import { MotionBudgetProvider, type MotionLevel } from './motion-budget';

/**
 * The card stack (#279): stacked → spread on transforms of fixed-size cards, the glows last, the
 * reverse on collapse, one stop while stacked and one per card while spread.
 */

const HEIGHT = 120;
const GAP = spacing[3];

const items: CardStackItem[] = (['sun', 'mint', 'sky', 'sun'] as const).map((accent, index) => ({
  key: `card-${index}`,
  accent,
  accessibilityLabel: `Card ${index}`,
  onPress: jest.fn(),
  children: <Text>{`Card ${index}`}</Text>,
}));

function stack(expanded: boolean, level: MotionLevel = 'full', onExpand = jest.fn()) {
  return (
    <MotionBudgetProvider level={level}>
      <CardStack
        items={items}
        expanded={expanded}
        onExpand={onExpand}
        label="Show all cards"
        cardHeight={HEIGHT}
        gap={GAP}
        testID="stack"
      />
    </MotionBudgetProvider>
  );
}

function layer(index: number): {
  translateX: number;
  translateY: number;
  scale: number;
  opacity: number;
} {
  const style = getAnimatedStyle(screen.getByTestId(`card-stack-layer-${index}`, { includeHiddenElements: true }) as never) as unknown as {
    transform: Array<Record<string, number>>;
    opacity: number;
  };
  return { ...Object.assign({}, ...style.transform), opacity: style.opacity };
}

function groupHeight(): number {
  return (StyleSheet.flatten(screen.getByTestId('stack').props.style) as { height: number }).height;
}

describe('stackHeight', () => {
  it('is one card plus a peek per visible layer when stacked, the column when spread', () => {
    expect(stackHeight(4, HEIGHT, GAP, false)).toBe(HEIGHT);
    expect(stackHeight(4, HEIGHT, GAP, true)).toBe(4 * HEIGHT + 3 * GAP);
    expect(stackHeight(0, HEIGHT, GAP, true)).toBe(0);
  });
});

describe('CardStack', () => {
  it('starts stacked: layers peek out beside the front one, smaller, and the fourth waits unseen', async () => {
    await render(stack(false));
    expect(layer(0)).toMatchObject({ translateX: 0, translateY: 0, scale: 1, opacity: 1 });
    expect(layer(1)).toMatchObject({ translateX: PEEK, translateY: 0 });
    expect(layer(1).scale).toBeCloseTo(1 - LAYER_SCALE);
    expect(layer(3).translateX).toBe((STACK_DEPTH - 1) * PEEK);
    expect(layer(3).opacity).toBe(0);
    expect(groupHeight()).toBe(stackHeight(4, HEIGHT, GAP, false));
  });

  it('is one button while stacked and hides the cards from a screen reader', async () => {
    const onExpand = jest.fn();
    await render(stack(false, 'full', onExpand));
    const button = screen.getByRole('button', { name: 'Show all cards' });
    expect(button.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.getByTestId("card-stack-layer-0", { includeHiddenElements: true }).props.importantForAccessibility).toBe(
      'no-hide-descendants',
    );
    await fireEvent.press(button);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('spreads into a column, taking the column height at once', async () => {
    const view = await render(stack(false));
    await view.rerender(stack(true));

    expect(groupHeight()).toBe(stackHeight(4, HEIGHT, GAP, true));
    expect(screen.queryByRole('button', { name: 'Show all cards' })).toBeNull();
    await waitFor(
      () => {
        expect(layer(0).translateY).toBeCloseTo(0, 0);
        expect(layer(3).translateY).toBeCloseTo(3 * (HEIGHT + GAP), 0);
        expect(layer(3).translateX).toBeCloseTo(0, 0);
        expect(layer(3).opacity).toBeCloseTo(1, 1);
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole('button', { name: 'Card 2' })).toBeTruthy();
  });

  it('folds back and keeps the column height until the front card has landed', async () => {
    const view = await render(stack(true));
    await view.rerender(stack(false));

    expect(groupHeight()).toBe(stackHeight(4, HEIGHT, GAP, true));
    await waitFor(() => expect(groupHeight()).toBe(stackHeight(4, HEIGHT, GAP, false)), {
      timeout: 3000,
    });
    expect(layer(1).translateX).toBeCloseTo(PEEK, 0);
    expect(layer(1).translateY).toBeCloseTo(0, 0);
  });

  it('changes state at once under Reduce Motion', async () => {
    const view = await render(stack(false, 'none'));
    await view.rerender(stack(true, 'none'));
    expect(layer(2).translateY).toBe(2 * (HEIGHT + GAP));
    expect(layer(2).scale).toBe(1);

    await view.rerender(stack(false, 'none'));
    expect(layer(2)).toMatchObject({ translateX: 2 * PEEK, translateY: 0 });
    expect(groupHeight()).toBe(stackHeight(4, HEIGHT, GAP, false));
  });
});
