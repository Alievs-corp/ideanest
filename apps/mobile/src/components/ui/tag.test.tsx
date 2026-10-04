import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Glyphs } from '../../icons';
import { colors, radius, tint } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
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

  describe('status tags on lime and white', () => {
    const surfaces = [
      ['lime', colors.lime500],
      ['white', colors.whiteSurface],
    ] as const;
    const statuses = ['success', 'warning', 'danger', 'hot'] as const;

    it.each(surfaces)(
      'draws the words in the %s surface’s ink, over the status tint, at 4.5:1 or better',
      async (surface, ground) => {
        for (const variant of statuses) {
          const { getByText } = await render(
            <SurfaceProvider surface={surface}>
              <Tag label="State" variant={variant} />
            </SurfaceProvider>,
          );
          const word = getByText('State');
          const text = String(colourOf(word));
          const background = String(backgroundOf(word));
          expect(text).toBe(TONES[surface].primary);
          // The tint keeps saying which status it is.
          expect(background).toBe(tint(colors[variant], 0.12));
          expect(contrast(text, background, ground)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    it('would have been illegible in the status colour — the reason for the switch', () => {
      expect(
        contrast(colors.success, tint(colors.success, 0.12), colors.whiteSurface),
      ).toBeLessThan(3);
    });
  });

  it('is a pill (#282)', async () => {
    const { getByTestId } = await render(<Tag testID="tag" label="Games" />);
    expect(StyleSheet.flatten(getByTestId('tag').props.style as StyleProp<ViewStyle>).borderRadius).toBe(
      radius.full,
    );
  });

  it.each(['full', 'none'] as const)(
    'is not a control and never moves, with motion %s',
    async (level) => {
      const { getByTestId } = await render(
        <MotionBudgetProvider level={level}>
          <Tag testID="tag" label="Games" />
        </MotionBudgetProvider>,
      );
      const tag = getByTestId('tag');
      const style = StyleSheet.flatten(tag.props.style as StyleProp<ViewStyle>);
      expect(style.transform).toBeUndefined();
      expect(style.opacity).toBeUndefined();
      expect(tag.props.accessibilityRole).toBeUndefined();
    },
  );

  it('hugs its word without overriding its parent’s alignment', async () => {
    const { getByTestId } = await render(<Tag testID="tag" label="Games" />);
    const tag = getByTestId('tag');
    expect(StyleSheet.flatten(tag.props.style as StyleProp<ViewStyle>).alignSelf).toBeUndefined();
    expect(
      StyleSheet.flatten(tag.parent?.props.style as StyleProp<ViewStyle>).alignSelf,
    ).toBeUndefined();
  });

  it('keeps an icon beside the word, in the word’s colour', async () => {
    const { getByText, container } = await render(
      <Tag label="Funded" variant="success" icon={Glyphs.TickCircle} />,
    );
    expect(getByText('Funded')).toBeTruthy();
    const glyphs = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.props.color).toBe(colors.success);
  });
});

/** `r,g,b,a` of a colour, read the way `tint()` writes one. */
function channels(colour: string): [number, number, number, number] {
  const parts = /^rgba\(([^)]+)\)$/.exec(tint(colour, 1))?.[1]?.split(',').map(Number) ?? [];
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return [r, g, b, a];
}

/** `top` painted over an opaque `bottom`. */
function over(top: string, bottom: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = channels(top);
  return [r * a + bottom[0] * (1 - a), g * a + bottom[1] * (1 - a), b * a + bottom[2] * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast of text over a translucent tag background over the surface underneath. */
function contrast(text: string, background: string, ground: string): number {
  const [gr, gg, gb] = channels(ground);
  const behind = over(background, [gr, gg, gb]);
  const front = over(text, behind);
  const [light, dark] = [luminance(front), luminance(behind)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

// Compile-time: a tag without a word is colour alone.
function _typeChecks() {
  // @ts-expect-error — `label` is required.
  void (<Tag variant="danger" />);
}
void _typeChecks;
