import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { MotionBudgetProvider, SurfaceProvider, TONES } from '../../components/ui';
import { BLOCK } from '../../components/ui/surface';
import { Glyphs } from '../../icons';
import { NavRow, RowGroup } from './settings-row';

/**
 * The Me hub's and the settings list's rows (#281): a Bulk glyph in a round badge, a trailing
 * arrow — or the external glyph for a page in the browser — and press feedback that stops under
 * Reduce Motion.
 */

function rows(onPress = jest.fn()) {
  return (
    <SurfaceProvider surface="white">
      <RowGroup title="Your account">
        <NavRow label="Saved projects" icon={Glyphs.Bookmark} onPress={onPress} testID="saved" />
        <NavRow
          label="Legal"
          icon={Glyphs.DocumentText}
          accessibilityRole="link"
          external
          onPress={jest.fn()}
          testID="legal"
        />
      </RowGroup>
    </SurfaceProvider>
  );
}

function scaledBox() {
  const wrapper = screen.getByTestId('saved').parent;
  return wrapper === null ? undefined : StyleSheet.flatten(wrapper.props.style);
}

describe('settings rows', () => {
  afterEach(() => jest.restoreAllMocks());

  it('names the row once, heads the group, and navigates on press', async () => {
    const onPress = jest.fn();
    await render(rows(onPress));

    expect(screen.getByRole('header', { name: 'Your account' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Saved projects' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Legal' })).toBeTruthy();
  });

  it('draws the glyph in on-white ink, an arrow in-app and the external glyph for the web', async () => {
    await render(rows());
    const hidden = { includeHiddenElements: true };

    const saved = within(screen.getByTestId('saved'));
    expect(saved.getByTestId('icon-Bookmark', hidden).props.color).toBe(TONES.white.primary);
    expect(saved.getAllByTestId('icon-ArrowRight2', hidden)).toHaveLength(1);
    const legal = within(screen.getByTestId('legal'));
    expect(legal.getAllByTestId('icon-ExportSquare', hidden)).toHaveLength(1);
    expect(legal.queryAllByTestId('icon-ArrowRight2', hidden)).toHaveLength(0);
  });

  it('sits in the white sheet as its nested block', async () => {
    await render(rows());
    const block = screen.getByTestId('saved').parent?.parent;
    expect(StyleSheet.flatten(block?.props.style).backgroundColor).toBe(BLOCK.white.rest);
  });

  it('gives under the thumb with motion allowed', async () => {
    await render(rows());
    expect(scaledBox()?.transform).toEqual([{ scale: 1 }]);

    await fireEvent(screen.getByTestId('saved'), 'pressIn');
    const wrapper = screen.getByTestId('saved').parent;
    await waitFor(
      () => {
        const scale = (getAnimatedStyle(wrapper as never) as { transform?: { scale: number }[] })
          .transform?.[0]?.scale;
        expect(scale).toBeLessThan(1);
      },
      { timeout: 3000 },
    );
  });

  it('stays still under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    await render(rows());
    await waitFor(() => expect(scaledBox()?.transform).toBeUndefined());
  });

  it('stays still under a budget of none', async () => {
    await render(<MotionBudgetProvider level="none">{rows()}</MotionBudgetProvider>);
    expect(scaledBox()?.transform).toBeUndefined();
  });
});
