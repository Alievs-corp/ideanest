import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Glyphs } from '../../icons';
import { colors, shadow, size } from '../../theme';
import { Body, CardTitle } from '../text';
import { Card } from './card';
import { FloatingPanel } from './floating-panel';
import { IconButton } from './icon-button';
import { TONES } from './surface';

/**
 * The two surfaces that change what their children look like — issue #151's "Card and
 * SurfaceContext" test. A `Body` inside a lime card is on-lime, inside a floating card or a
 * floating panel on-white: the native `data-on-lime`, and the thing that stops white/64 on lime.
 */

const noop = () => {};

function colourOf(element: { props: { style?: unknown } }) {
  return StyleSheet.flatten(element.props.style as StyleProp<TextStyle>)?.color;
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle {
  const { style } = element.props;
  return (
    StyleSheet.flatten(
      (typeof style === 'function' ? style({ pressed: false }) : style) as StyleProp<ViewStyle>,
    ) ?? {}
  );
}

describe('Card and SurfaceContext', () => {
  it('leaves a Body in its dark tone inside a default card', async () => {
    const { getByText } = await render(
      <Card>
        <Body>Prose</Body>
      </Card>,
    );
    expect(colourOf(getByText('Prose'))).toBe(colors.textSecondary);
  });

  it('switches a Body to on-lime inside an active card, and a title to near-black', async () => {
    const { getByText } = await render(
      <Card variant="active">
        <CardTitle>Ends tonight</CardTitle>
        <Body>Prose</Body>
      </Card>,
    );
    expect(colourOf(getByText('Prose'))).toBe(TONES.lime.secondary);
    expect(colourOf(getByText('Ends tonight'))).toBe(colors.textOnLime);
  });

  it('switches a Body to on-white inside a floating card', async () => {
    const { getByText } = await render(
      <Card variant="floating">
        <CardTitle>Summary</CardTitle>
        <Body>Prose</Body>
      </Card>,
    );
    expect(colourOf(getByText('Prose'))).toBe(TONES.white.secondary);
    expect(colourOf(getByText('Summary'))).toBe(colors.textOnWhite);
  });

  it('draws the three variants from tokens: surface-2, lime, white with the float shadow', async () => {
    const plain = await render(<Card testID="card" />);
    const active = await render(<Card testID="card" variant="active" />);
    const floating = await render(<Card testID="card" variant="floating" />);

    expect(styleOf(plain.getByTestId('card')).backgroundColor).toBe(colors.surface2);
    expect(styleOf(plain.getByTestId('card')).borderColor).toBe(colors.border);
    expect(styleOf(active.getByTestId('card')).backgroundColor).toBe(colors.lime500);
    expect(styleOf(floating.getByTestId('card')).backgroundColor).toBe(colors.whiteSurface);
    expect(styleOf(floating.getByTestId('card')).boxShadow).toBe(shadow.float);
  });

  it('keeps the web’s radius and padding per size', async () => {
    const shapes = [];
    for (const cardSize of ['sm', 'md', 'lg'] as const) {
      const { getByTestId } = await render(<Card testID="card" size={cardSize} />);
      const { borderRadius, padding } = styleOf(getByTestId('card'));
      shapes.push([borderRadius, padding]);
    }
    expect(shapes).toEqual([
      [14, 16],
      [20, 20],
      [28, 24],
    ]);
  });

  it('is not a control without onPress', async () => {
    const { queryByRole } = await render(
      <Card>
        <Body>Prose</Body>
      </Card>,
    );
    expect(queryByRole('button')).toBeNull();
  });

  describe('interactive', () => {
    it('is one button, named, that does not lift', async () => {
      const onPress = jest.fn();
      const { getByRole } = await render(
        <Card onPress={onPress} accessibilityLabel="Early bird reward">
          <Body>Prose</Body>
        </Card>,
      );
      const card = getByRole('button', { name: 'Early bird reward' });
      await fireEvent.press(card);
      expect(onPress).toHaveBeenCalledTimes(1);

      // At rest it is the plain card. It never lifts; the only transform is the press scale
      // (`usePressScale`, mobile-design skill §6.3), resting at 1.
      expect(styleOf(card).backgroundColor).toBe(colors.surface2);
      expect(styleOf(card).transform).toEqual([{ scale: 1 }]);
    });

    it('is at least a thumb tall', async () => {
      const { getByRole } = await render(<Card onPress={noop} accessibilityLabel="Reward" />);
      expect(Number(styleOf(getByRole('button')).minHeight)).toBeGreaterThanOrEqual(
        size.touchTarget,
      );
    });

    it('announces a chosen reward as selected, and as checked when it is a radio', async () => {
      const button = await render(<Card onPress={noop} accessibilityLabel="Reward" selected />);
      expect(button.getByRole('button').props.accessibilityState).toMatchObject({
        selected: true,
      });

      const radio = await render(
        <Card onPress={noop} accessibilityLabel="Reward" accessibilityRole="radio" selected />,
      );
      expect(radio.getByRole('radio').props.accessibilityState).toMatchObject({ checked: true });
    });

    it('refuses a press while disabled, says so, and dims', async () => {
      const onPress = jest.fn();
      const { getByRole } = await render(
        <Card onPress={onPress} accessibilityLabel="Sold out" disabled />,
      );
      await fireEvent.press(getByRole('button'));
      expect(onPress).not.toHaveBeenCalled();
      expect(getByRole('button').props.accessibilityState).toMatchObject({ disabled: true });
      expect(styleOf(getByRole('button')).opacity).toBe(0.4);
    });
  });
});

describe('FloatingPanel', () => {
  it('is white with the float shadow and a heading, and switches its body to on-white', async () => {
    const { getByTestId, getByRole, getByText } = await render(
      <FloatingPanel testID="panel" title="Your pledge">
        <Body>Prose</Body>
      </FloatingPanel>,
    );
    const panel = styleOf(getByTestId('panel'));
    expect(panel.backgroundColor).toBe(colors.whiteSurface);
    expect(panel.boxShadow).toBe(shadow.float);
    expect(panel.borderRadius).toBe(28);

    expect(getByRole('header', { name: 'Your pledge' })).toBeTruthy();
    expect(colourOf(getByText('Your pledge'))).toBe(colors.textOnWhite);
    expect(colourOf(getByText('Prose'))).toBe(TONES.white.secondary);
  });

  it('draws its actions for the white surface they sit on', async () => {
    const { container } = await render(
      <FloatingPanel
        title="Your pledge"
        actions={<IconButton icon={Glyphs.Close} label="Close" variant="ghost" onPress={noop} />}
      />,
    );
    const glyph = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView');
    expect(glyph[0]?.props.color).toBe(TONES.white.secondary);
  });
});
