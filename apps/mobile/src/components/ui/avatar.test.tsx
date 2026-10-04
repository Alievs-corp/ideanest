import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { colors } from '../../theme';
import { Avatar, initials } from './avatar';
import { SurfaceProvider, TONES } from './surface';

/**
 * An avatar is a picture of a person or their initials, named by them when it stands alone and
 * silent when their name is already beside it. (`expo-image` is React Native's `Image` under Jest —
 * `jest.setup.ts`.)
 */

describe('Avatar', () => {
  it('draws the initials on surface-3 when there is no picture, named by the person', async () => {
    const { getByRole, getByText } = await render(<Avatar name="Aysel Məmmədova" />);
    const avatar = getByRole('image', { name: 'Aysel Məmmədova' });
    expect(StyleSheet.flatten(avatar.props.style as ViewStyle).backgroundColor).toBe(
      colors.surface3,
    );
    expect(getByText('AM', { includeHiddenElements: true })).toBeTruthy();
  });

  it('does not let Dynamic Type push the decorative initials out of their circle', async () => {
    const { getByText } = await render(<Avatar name="Jane Doe" />);
    expect(getByText('JD', { includeHiddenElements: true }).props.maxFontSizeMultiplier).toBe(1);
  });

  it('takes the first letter of the first two words, as the web does', () => {
    expect(initials('  Jane   Doe Smith ')).toBe('JD');
    expect(initials('cher')).toBe('C');
    expect(initials('')).toBe('');
  });

  it('shows the picture when there is one', async () => {
    const { container } = await render(
      <Avatar name="Jane Doe" src="https://cdn.test.invalid/jane.jpg" />,
    );
    const pictures = container.queryAll((node) => node.props.source !== undefined);
    expect(JSON.stringify(pictures[0]?.props.source)).toContain(
      'https://cdn.test.invalid/jane.jpg',
    );
  });

  it('falls back to the initials when the picture fails to load', async () => {
    const { container, getByText } = await render(
      <Avatar name="Jane Doe" src="https://cdn.test.invalid/gone.jpg" />,
    );
    const picture = container.queryAll((node) => node.props.source !== undefined)[0];
    if (picture === undefined) throw new Error('no picture');
    await fireEvent(picture, 'error');
    expect(getByText('JD', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is hidden when decorative, so a name beside it is not read twice', async () => {
    const { queryByRole, getByTestId } = await render(
      <Avatar name="Jane Doe" decorative testID="avatar" />,
    );
    expect(queryByRole('image')).toBeNull();
    expect(
      getByTestId('avatar', { includeHiddenElements: true }).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('keeps the web’s sizes and the 2pt surface-1 ring', async () => {
    const sides = [];
    for (const avatarSize of ['xs', 'sm', 'md', 'lg'] as const) {
      const { getByRole } = await render(<Avatar name="Jane Doe" size={avatarSize} />);
      const style = StyleSheet.flatten(getByRole('image').props.style as ViewStyle);
      sides.push(style.width);
      expect(style.outlineWidth).toBe(2);
      expect(style.outlineColor).toBe(colors.surface1);
    }
    expect(sides).toEqual([24, 28, 40, 56]);
  });

  it('takes the white sheet’s muted fill, on-white initials and a white ring inside a sheet', async () => {
    const { getByRole, getByText } = await render(
      <SurfaceProvider surface="white">
        <Avatar name="Jane Doe" />
      </SurfaceProvider>,
    );
    const style = StyleSheet.flatten(getByRole('image').props.style as ViewStyle);
    expect(style.backgroundColor).toBe(colors.whiteMuted);
    expect(style.outlineColor).toBe(colors.whiteSurface);
    const letters = getByText('JD', { includeHiddenElements: true });
    expect(StyleSheet.flatten(letters.props.style as TextStyle).color).toBe(TONES.white.secondary);
  });
});
