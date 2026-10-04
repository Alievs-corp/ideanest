import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { colors, radius, size } from '../../theme';
import { CHIP_REST_LAYER, CHIP_SELECTED_LAYER, Chip, ChipRow, RemovableChip } from './chip';
import { MotionBudgetProvider } from './motion-budget';
import { SurfaceProvider } from './surface';

/**
 * Filter chips: pills (#282) whose selected state is the inverted pill and never lime (docs/ui-kit.md
 * §7.3), crossfaded in on a spring and at once under Reduce Motion; selection is announced rather
 * than left to the fill, a 34pt chip is still a 44pt target, and a chip that removes a filter is
 * named by what pressing it does.
 */

const noop = () => {};

function styleOf(element: { props: { style?: unknown } }): ViewStyle {
  const { style } = element.props;
  return (
    StyleSheet.flatten(
      (typeof style === 'function' ? style({ pressed: false }) : style) as StyleProp<ViewStyle>,
    ) ?? {}
  );
}

function colourOf(element: { props: { style?: unknown } }) {
  return StyleSheet.flatten(element.props.style as StyleProp<TextStyle>)?.color;
}

type Tree = Awaited<ReturnType<typeof render>>;

/** A chip's fill layer, by its test identifier, as Reanimated currently draws it. */
function layer(tree: Tree, id: string) {
  return getAnimatedStyle(
    within(tree.getByRole('button')).getByTestId(id, { includeHiddenElements: true }) as never,
  ) as ViewStyle;
}

/** The words in each layer: the resting copy, then the selected copy over it. */
function wordColours(tree: Tree, label: string) {
  return tree.getAllByText(label, { includeHiddenElements: true }).map(colourOf);
}

/** The press-scale wrapper's transform. */
function scaleOf(tree: Tree) {
  const wrapper = tree.getByRole('button').parent;
  return wrapper === null ? undefined : styleOf(wrapper).transform;
}

describe('Chip', () => {
  it('is a button named by its label', async () => {
    const { getByRole } = await render(<Chip label="Games" onPress={noop} />);
    expect(getByRole('button', { name: 'Games' })).toBeTruthy();
  });

  it('is a pill', async () => {
    const tree = await render(<Chip label="Games" onPress={noop} />);
    expect(styleOf(tree.getByRole('button')).borderRadius).toBe(radius.full);
  });

  it('is white with near-black text when selected — never lime — and says it is selected', async () => {
    const tree = await render(<Chip label="Live" selected onPress={noop} />);
    expect(layer(tree, CHIP_SELECTED_LAYER)).toMatchObject({
      backgroundColor: colors.whiteSurface,
      opacity: 1,
    });
    expect(layer(tree, CHIP_SELECTED_LAYER).backgroundColor).not.toBe(colors.lime500);
    expect(layer(tree, CHIP_REST_LAYER).opacity).toBe(0);
    expect(wordColours(tree, 'Live')).toEqual([colors.textSecondary, colors.textOnWhite]);
    expect(tree.getByRole('button').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('is surface-2 with a hairline and white/64 text when not selected', async () => {
    const tree = await render(<Chip label="Games" onPress={noop} />);
    expect(layer(tree, CHIP_REST_LAYER)).toMatchObject({
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      opacity: 1,
    });
    expect(layer(tree, CHIP_SELECTED_LAYER).opacity).toBe(0);
    expect(wordColours(tree, 'Games')[0]).toBe(colors.textSecondary);
    expect(tree.getByRole('button').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('inverts on a white sheet: white-muted at rest, near-black with white words when selected', async () => {
    const tree = await render(
      <SurfaceProvider surface="white">
        <Chip label="Live" selected onPress={noop} />
      </SurfaceProvider>,
    );
    expect(layer(tree, CHIP_REST_LAYER).backgroundColor).toBe(colors.whiteMuted);
    expect(layer(tree, CHIP_SELECTED_LAYER).backgroundColor).toBe(colors.surface1);
    expect(wordColours(tree, 'Live')[1]).toBe(colors.textPrimary);
  });

  it('crossfades its selected layer in on a spring, and scales under the thumb', async () => {
    const ui = (selected: boolean) => <Chip label="Live" selected={selected} onPress={noop} />;
    const tree = await render(ui(false));
    expect(scaleOf(tree)).toEqual([{ scale: 1 }]);
    await tree.rerender(ui(true));
    // Not there on the frame of the change: it travels.
    expect(layer(tree, CHIP_SELECTED_LAYER).opacity).toBeLessThan(1);
    await waitFor(() => expect(layer(tree, CHIP_SELECTED_LAYER).opacity).toBeCloseTo(1, 2), {
      timeout: 3000,
    });
    expect(layer(tree, CHIP_REST_LAYER).opacity).toBeCloseTo(0, 2);
  });

  it('changes at once and does not scale under a budget of none', async () => {
    const ui = (selected: boolean) => (
      <MotionBudgetProvider level="none">
        <Chip label="Live" selected={selected} onPress={noop} />
      </MotionBudgetProvider>
    );
    const tree = await render(ui(false));
    expect(scaleOf(tree)).toBeUndefined();
    await tree.rerender(ui(true));
    expect(layer(tree, CHIP_SELECTED_LAYER).opacity).toBe(1);
  });

  it('changes at once and does not scale under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const ui = (selected: boolean) => <Chip label="Live" selected={selected} onPress={noop} />;
    const tree = await render(ui(false));
    await waitFor(() => expect(scaleOf(tree)).toBeUndefined());
    await tree.rerender(ui(true));
    expect(layer(tree, CHIP_SELECTED_LAYER).opacity).toBe(1);
  });

  it('hugs its label without overriding its parent’s alignment', async () => {
    const { getByRole } = await render(<Chip label="Games" onPress={noop} />);
    const chip = getByRole('button');
    expect(styleOf(chip).alignSelf).toBeUndefined();
    expect(chip.parent === null ? undefined : styleOf(chip.parent).alignSelf).toBeUndefined();
  });

  it('keeps its 34pt look and reaches 44pt through hitSlop', async () => {
    const { getByRole } = await render(<Chip label="Games" onPress={noop} />);
    const chip = getByRole('button');
    const slop = chip.props.hitSlop as { top: number; bottom: number };
    expect(styleOf(chip).minHeight).toBe(34);
    expect(Number(styleOf(chip).minHeight) + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      size.touchTarget,
    );
  });

  it('announces its count as its value, not as part of its name', async () => {
    const { getByRole } = await render(<Chip label="Games" count={12} onPress={noop} />);
    const chip = getByRole('button', { name: 'Games' });
    expect(chip.props.accessibilityValue).toEqual({ text: '12' });
  });

  it('presses, and refuses a press while disabled', async () => {
    const onPress = jest.fn();
    const live = await render(<Chip label="Games" onPress={onPress} />);
    await fireEvent.press(live.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);

    const blocked = jest.fn();
    const off = await render(<Chip label="Games" disabled onPress={blocked} />);
    await fireEvent.press(off.getByRole('button'));
    expect(blocked).not.toHaveBeenCalled();
    expect(off.getByRole('button').props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('RemovableChip', () => {
  it('is named by what pressing it does, and removes', async () => {
    const onRemove = jest.fn();
    const { getByRole, getByText } = await render(
      <RemovableChip label="Live" removeLabel="Remove Status filter: Live" onRemove={onRemove} />,
    );
    const chip = getByRole('button', { name: 'Remove Status filter: Live' });
    // The visible word is still drawn, and the name contains it (WCAG 2.5.3).
    expect(getByText('Live', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(chip);
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Not a toggle: nothing about it is "selected".
    expect(chip.props.accessibilityState?.selected).toBeUndefined();
  });

  it('is a white pill, never lime, and a 44pt target', async () => {
    const { getByRole } = await render(
      <RemovableChip label="Live" removeLabel="Remove Live" onRemove={noop} />,
    );
    const chip = getByRole('button');
    const slop = chip.props.hitSlop as { top: number; bottom: number };
    expect(styleOf(chip).backgroundColor).toBe(colors.whiteSurface);
    expect(styleOf(chip).borderRadius).toBe(radius.full);
    expect(Number(styleOf(chip).minHeight) + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      size.touchTarget,
    );
  });
});

describe('RemovableChip on surfaces and in motion', () => {
  const chip = <RemovableChip label="Live" removeLabel="Remove Live" onRemove={noop} />;

  it('scales under the thumb where motion is allowed', async () => {
    const tree = await render(chip);
    expect(scaleOf(tree)).toEqual([{ scale: 1 }]);
  });

  it('stays still under a budget of none', async () => {
    const tree = await render(<MotionBudgetProvider level="none">{chip}</MotionBudgetProvider>);
    expect(scaleOf(tree)).toBeUndefined();
  });

  it('inverts to near-black on a white sheet', async () => {
    const tree = await render(<SurfaceProvider surface="white">{chip}</SurfaceProvider>);
    expect(styleOf(tree.getByRole('button')).backgroundColor).toBe(colors.surface1);
  });
});

describe('ChipRow', () => {
  function scrollerIn(tree: Awaited<ReturnType<typeof render>>) {
    const scroller = tree.container.queryAll(
      (node) => node.props.horizontal === true && 'showsHorizontalScrollIndicator' in node.props,
    )[0];
    if (scroller === undefined) throw new Error('no horizontal scroll view');
    return scroller;
  }

  const row = (
    <ChipRow testID="row">
      <Chip label="Games" onPress={noop} />
      <Chip label="Design" onPress={noop} />
    </ChipRow>
  );

  it('scrolls sideways without a scroll bar', async () => {
    const tree = await render(row);
    expect(scrollerIn(tree).props.showsHorizontalScrollIndicator).toBe(false);
  });

  it('draws no fade while every chip fits', async () => {
    const tree = await render(row);
    await fireEvent(tree.getByTestId('row'), 'layout', { nativeEvent: { layout: { width: 320 } } });
    await fireEvent(scrollerIn(tree), 'contentSizeChange', 200, 44);
    expect(tree.queryByTestId('chip-row-fade', { includeHiddenElements: true })).toBeNull();
  });

  it('takes the fade away when the chips shrink to fit, without waiting for a scroll', async () => {
    const tree = await render(row);
    await fireEvent(tree.getByTestId('row'), 'layout', { nativeEvent: { layout: { width: 320 } } });
    await fireEvent(scrollerIn(tree), 'contentSizeChange', 600, 44);
    expect(tree.getByTestId('chip-row-fade', { includeHiddenElements: true })).toBeTruthy();

    // A filter removed: the row now fits, and nobody has scrolled.
    await fireEvent(scrollerIn(tree), 'contentSizeChange', 280, 44);
    expect(tree.queryByTestId('chip-row-fade', { includeHiddenElements: true })).toBeNull();
  });

  it('fades the right edge while there is more, and stops at the end of the row', async () => {
    const tree = await render(row);
    await fireEvent(tree.getByTestId('row'), 'layout', { nativeEvent: { layout: { width: 320 } } });
    await fireEvent(scrollerIn(tree), 'contentSizeChange', 600, 44);
    expect(tree.getByTestId('chip-row-fade', { includeHiddenElements: true })).toBeTruthy();

    await fireEvent.scroll(scrollerIn(tree), {
      nativeEvent: {
        contentOffset: { x: 280, y: 0 },
        layoutMeasurement: { width: 320, height: 44 },
        contentSize: { width: 600, height: 44 },
      },
    });
    expect(tree.queryByTestId('chip-row-fade', { includeHiddenElements: true })).toBeNull();
  });
});

// Compile-time: a removable chip must say what pressing it does.
function _typeChecks() {
  // @ts-expect-error — `removeLabel` is required.
  void (<RemovableChip label="Live" onRemove={noop} />);
  // @ts-expect-error — a chip needs a label.
  void (<Chip onPress={noop} />);
}
void _typeChecks;
