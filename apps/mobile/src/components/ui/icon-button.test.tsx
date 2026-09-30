import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, size } from '../../theme';
import { IconButton } from './icon-button';
import { SurfaceProvider, TONES } from './surface';

/**
 * An icon-only control is the one place an accessible name cannot be read off the screen, so
 * it is required at the type level and asserted here. The hit area is the other thing a phone
 * adds to the web's component: 32pt looks right and is too small to hit.
 */

const noop = () => {};

function styleOf(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

describe('IconButton', () => {
  it('is a button named by its label', async () => {
    const { getByRole } = await render(<IconButton icon={X} label="Close" onPress={noop} />);
    expect(getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it.each(['sm', 'md', 'lg'] as const)('reaches at least 44pt at size %s', async (buttonSize) => {
    const { getByRole } = await render(
      <IconButton icon={X} label="Close" size={buttonSize} onPress={noop} />,
    );
    const button = getByRole('button');
    const width = Number(styleOf(button).width);
    expect(width + 2 * Number(button.props.hitSlop)).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('carries a toggle state when it is one', async () => {
    const { getByRole } = await render(
      <IconButton icon={X} label="Show password" selected onPress={noop} />,
    );
    expect(getByRole('button').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('refuses a press while disabled', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <IconButton icon={X} label="Close" disabled onPress={onPress} />,
    );
    await fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByRole('button').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('presses', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<IconButton icon={X} label="Close" onPress={onPress} />);
    await fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws a ghost glyph in the tone of the surface it sits on, never white/64 on lime', async () => {
    const { container } = await render(
      <SurfaceProvider surface="lime">
        <IconButton icon={X} label="Dismiss" variant="ghost" onPress={noop} />
      </SurfaceProvider>,
    );
    const [glyph] = container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(glyph?.props.stroke).toBe(TONES.lime.secondary);
    expect(TONES.lime.secondary).not.toBe(colors.textSecondary);
  });

  it('inverts light on a white surface, as Pill does (#232)', async () => {
    const { getByRole } = await render(
      <SurfaceProvider surface="white">
        <IconButton icon={X} label="Share" variant="light" onPress={noop} />
      </SurfaceProvider>,
    );
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.surface1);
  });

  it('draws a near-black glyph on danger (#229)', async () => {
    const { container } = await render(
      <IconButton icon={X} label="Delete" variant="danger" onPress={noop} />,
    );
    const [glyph] = container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(glyph?.props.stroke).toBe(colors.textOnDanger);
  });
});

function _typeChecks() {
  // @ts-expect-error — an icon-only control without a label is announced as "button" and nothing else.
  void (<IconButton icon={X} onPress={noop} />);
}
void _typeChecks;
