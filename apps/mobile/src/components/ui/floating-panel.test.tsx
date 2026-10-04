import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../../theme';
import { Body } from '../text';
import { FloatingPanel } from './floating-panel';
import { MotionBudgetProvider } from './motion-budget';
import { Switch } from './switch';
import { TONES } from './surface';

/**
 * The floating panel in the white-sheet language (#282): the sheet's white, radius and gutters,
 * on-white words and controls inside it, and no motion of its own in either motion mode — it is
 * placed, not presented. Its shadow and actions are covered in `card.test.tsx`.
 */

const styleOf = (element: { props: { style?: unknown } }) =>
  StyleSheet.flatten(element.props.style as StyleProp<ViewStyle>) ?? {};

describe('FloatingPanel', () => {
  it('is the white sheet’s material: whiteSurface, radius.xl, spacing[5] gutters', async () => {
    const { getByTestId, getByText } = await render(
      <FloatingPanel testID="panel" title="Your pledge">
        <Body>Prose</Body>
      </FloatingPanel>,
    );
    expect(styleOf(getByTestId('panel'))).toMatchObject({
      backgroundColor: colors.whiteSurface,
      borderRadius: radius.xl,
    });
    const body = getByText('Prose').parent;
    expect(body === null ? undefined : styleOf(body).paddingHorizontal).toBe(spacing[5]);
  });

  it('puts the controls inside it on white', async () => {
    const { getByText } = await render(
      <FloatingPanel>
        <Switch label="Alerts" value onValueChange={() => {}} />
      </FloatingPanel>,
    );
    expect(StyleSheet.flatten(getByText('Alerts').props.style).color).toBe(TONES.white.primary);
  });

  it.each(['full', 'none'] as const)('does not move, with motion %s', async (level) => {
    const { getByTestId } = await render(
      <MotionBudgetProvider level={level}>
        <FloatingPanel testID="panel" title="Your pledge" />
      </MotionBudgetProvider>,
    );
    const style = styleOf(getByTestId('panel'));
    expect(style.transform).toBeUndefined();
    expect(style.opacity).toBeUndefined();
  });
});
