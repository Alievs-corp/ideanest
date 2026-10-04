import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { SegmentedPill } from './segmented-pill';
import { SurfaceProvider } from './surface';

/**
 * "All / My accounts" (#277): one choice from a radio group, a white thumb under it that moves on
 * transform alone, inverted on a white sheet, and still under Reduce Motion.
 */

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'My accounts' },
] as const;

function Sample({ onChange = jest.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<'all' | 'mine'>('all');
  return (
    <SegmentedPill
      options={OPTIONS}
      value={value}
      label="Show"
      testID="segments"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

/** The thumb's current style, animated values included (Reanimated's own Jest reading). */
const thumb = () => getAnimatedStyle(screen.getByTestId('segments-thumb') as never) as {
  width?: number;
  backgroundColor?: string;
  transform?: unknown;
};

describe('SegmentedPill', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('is a radio group: every segment named, only the chosen one checked', async () => {
    await render(<Sample />);
    expect(screen.getByRole('radio', { name: 'All', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'My accounts', checked: false })).toBeTruthy();
  });

  it('moves the choice on a press, with the selection haptic, and ignores the chosen segment', async () => {
    const onChange = jest.fn();
    await render(<Sample onChange={onChange} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'My accounts' }));
    expect(onChange).toHaveBeenCalledWith('mine');
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'My accounts', checked: true })).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', { name: 'My accounts' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('slides the thumb on translateX, with a fixed width: no animated layout', async () => {
    await render(<Sample />);
    await fireEvent(screen.getByTestId('segments'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 208, height: 44 } },
    });
    expect(thumb().width).toBe(100);
    expect(thumb().transform).toEqual([{ translateX: 4 }]);
    await fireEvent.press(screen.getByRole('radio', { name: 'My accounts' }));
    await waitFor(() => expect(thumb().transform).toEqual([{ translateX: 104 }]), { timeout: 3000 });
    expect(thumb().width).toBe(100);
  });

  it('is a white thumb on the canvas and a dark one on a white sheet', async () => {
    const view = await render(<Sample />);
    expect(thumb().backgroundColor).toBe(colors.whiteSurface);
    await view.rerender(
      <SurfaceProvider surface="white">
        <Sample />
      </SurfaceProvider>,
    );
    expect(thumb().backgroundColor).toBe(colors.surface1);
  });

  it('jumps rather than slides with motion off', async () => {
    await render(
      <MotionBudgetProvider level="none">
        <Sample />
      </MotionBudgetProvider>,
    );
    await fireEvent(screen.getByTestId('segments'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 208, height: 44 } },
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'My accounts' }));
    expect(thumb().transform).toEqual([{ translateX: 104 }]);
  });

  it('jumps under Reduce Motion as well', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    await render(<Sample />);
    await fireEvent(screen.getByTestId('segments'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 208, height: 44 } },
    });
    await waitFor(() => expect(thumb().transform).toEqual([{ translateX: 4 }]));
    await fireEvent.press(screen.getByRole('radio', { name: 'My accounts' }));
    expect(thumb().transform).toEqual([{ translateX: 104 }]);
  });
});
