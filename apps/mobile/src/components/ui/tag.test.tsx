import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { CircleCheck } from 'lucide-react-native';
import { colors, tint } from '../../theme';
import { SurfaceProvider, TONES } from './surface';
import { Tag } from './tag';

/**
 * A tag is where colour most wants to carry the meaning on its own, so the test is mostly that it
 * cannot: every variant says its word, and the status tints are the token at 12%.
 */

function colourOf(element: { props: { style?: unknown } }) {
  return StyleSheet.flatten(element.props.style as StyleProp<TextStyle>)?.color;
}

function backgroundOf(element: { parent: { props: { style?: unknown } } | null }) {
  return StyleSheet.flatten(element.parent?.props.style as StyleProp<ViewStyle>)?.backgroundColor;
}

describe('Tag', () => {
  it('always says its word — colour is never the whole message', async () => {
    const { getByText } = await render(<Tag label="Funded" variant="success" />);
    expect(getByText('Funded')).toBeTruthy();
  });

  it.each([
    ['success', colors.success],
    ['warning', colors.warning],
    ['danger', colors.danger],
    ['hot', colors.hot],
  ] as const)('draws %s as its token on a 12%% tint of it', async (variant, token) => {
    const { getByText } = await render(<Tag label="State" variant={variant} />);
    const word = getByText('State');
    expect(colourOf(word)).toBe(token);
    expect(backgroundOf(word)).toBe(tint(token, 0.12));
  });

  it('is surface-3 with white/64 by default', async () => {
    const { getByText } = await render(<Tag label="Games" />);
    expect(colourOf(getByText('Games'))).toBe(colors.textSecondary);
    expect(backgroundOf(getByText('Games'))).toBe(colors.surface3);
  });

  it('switches the neutral tag to on-lime inside a lime surface, where the default would vanish', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="lime">
        <Tag label="Ending soon" />
      </SurfaceProvider>,
    );
    expect(colourOf(getByText('Ending soon'))).toBe(TONES.lime.secondary);
  });

  it('switches the neutral tag to on-white inside a white surface', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="white">
        <Tag label="Draft" />
      </SurfaceProvider>,
    );
    expect(colourOf(getByText('Draft'))).toBe(TONES.white.secondary);
  });

  it('keeps an icon beside the word, in the word’s colour', async () => {
    const { getByText, container } = await render(
      <Tag label="Funded" variant="success" icon={CircleCheck} />,
    );
    expect(getByText('Funded')).toBeTruthy();
    const glyphs = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.props.stroke).toBe(colors.success);
  });
});

// Compile-time: a tag without a word is colour alone.
function _typeChecks() {
  // @ts-expect-error — `label` is required.
  void (<Tag variant="danger" />);
}
void _typeChecks;
