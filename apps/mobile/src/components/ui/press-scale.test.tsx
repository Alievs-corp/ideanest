import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { haptics } from './haptics';
import { MotionBudgetProvider } from './motion-budget';
import { PressableScale } from './press-scale';

/**
 * Press feedback (#273, `mobile-design` skill §6.3): the surface gives under the thumb, the press
 * itself is never delayed, and Reduce Motion or an explicit `none` leaves it still.
 */

function sample(onPress = jest.fn()) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel="Open" onPress={onPress}>
      <Text>Open</Text>
    </PressableScale>
  );
}

function transformOf(tree: Awaited<ReturnType<typeof render>>) {
  const wrapper = tree.getByRole('button').parent;
  return wrapper === null ? undefined : StyleSheet.flatten(wrapper.props.style)?.transform;
}

describe('PressableScale', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scales on every surface by default', async () => {
    const tree = await render(sample());
    expect(transformOf(tree)).toEqual([{ scale: 1 }]);
  });

  it('stays still under an explicit budget of none', async () => {
    const tree = await render(<MotionBudgetProvider level="none">{sample()}</MotionBudgetProvider>);
    expect(transformOf(tree)).toBeUndefined();
  });

  it('stays still when the device asks for Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const tree = await render(sample());
    await waitFor(() => expect(transformOf(tree)).toBeUndefined());
  });

  it('fires onPress and its haptic on the press itself', async () => {
    const onPress = jest.fn();
    const save = jest.spyOn(haptics, 'save').mockImplementation(() => undefined);
    const tree = await render(
      <PressableScale accessibilityRole="button" accessibilityLabel="Save" haptic="save" onPress={onPress}>
        <Text>Save</Text>
      </PressableScale>,
    );
    fireEvent.press(tree.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
