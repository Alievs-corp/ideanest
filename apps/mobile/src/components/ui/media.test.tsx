import { render } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { colors } from '../../theme';
import { Media, MediaFrame, aspectRatioOf, isPlaceholderUri } from './media';
import { MotionBudgetProvider } from './motion-budget';

/**
 * The media primitive: the box is reserved before the picture arrives, a meaningful picture cannot
 * be unnamed, and a picture only fades in where the surface's budget allows it.
 */

const SRC = 'https://cdn.test.invalid/cover.jpg';
const PREVIEW = 'data:image/png;base64,iVBORw0KGgo=';

function frameStyle(element: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle);
}

describe('MediaFrame', () => {
  it('reserves the box on surface-3 at the token ratio, clipped to its radius', async () => {
    const { getByTestId } = await render(<MediaFrame testID="frame" ratio="16/9" radius="lg" />);
    const style = frameStyle(getByTestId('frame'));
    expect(style.aspectRatio).toBeCloseTo(16 / 9, 5);
    expect(style.backgroundColor).toBe(colors.surface3);
    expect(style.borderRadius).toBe(20);
    expect(style.overflow).toBe('hidden');
  });

  it('takes an intrinsic size, and falls back to 16:9 for one that cannot be a ratio', () => {
    expect(aspectRatioOf({ width: 1200, height: 1600 })).toBeCloseTo(0.75, 5);
    expect(aspectRatioOf({ width: 0, height: 0 })).toBeCloseTo(16 / 9, 5);
    expect(aspectRatioOf({ width: Number.NaN, height: 10 })).toBeCloseTo(16 / 9, 5);
    expect(aspectRatioOf('1/1')).toBe(1);
  });
});

describe('Media', () => {
  it('names a meaningful picture by its alt', async () => {
    const { getByRole } = await render(
      <Media src={SRC} ratio="16/9" alt="A solar lamp on a windowsill" />,
    );
    expect(getByRole('image', { name: 'A solar lamp on a windowsill' })).toBeTruthy();
  });

  it('hides a decorative picture', async () => {
    const { queryByRole, getByTestId } = await render(
      <Media testID="media" src={SRC} ratio="16/9" decorative />,
    );
    expect(queryByRole('image')).toBeNull();
    expect(
      getByTestId('media', { includeHiddenElements: true }).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('treats an empty alt as decorative, as alt="" is on the web, rather than an unnamed image', async () => {
    const { queryByRole, getByTestId } = await render(
      <Media testID="media" src={SRC} ratio="16/9" alt="" />,
    );
    expect(queryByRole('image')).toBeNull();
    expect(
      getByTestId('media', { includeHiddenElements: true }).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('only accepts an inline data URI as a placeholder', () => {
    expect(isPlaceholderUri(PREVIEW)).toBe(true);
    expect(isPlaceholderUri('https://cdn.test.invalid/preview.jpg')).toBe(false);
  });

  it('does not fade on a surface whose budget is below moderate, such as discovery', async () => {
    const { getByTestId } = await render(
      <MotionBudgetProvider level="minimal">
        <Media testID="media" src={SRC} ratio="16/9" decorative />
      </MotionBudgetProvider>,
    );
    expect(getByTestId('media', { includeHiddenElements: true }).props.transition).toBe(0);
  });
});

// Compile-time: a picture is described or declared decorative — never neither, never both.
function _typeChecks() {
  // @ts-expect-error — a meaningful image cannot be left unnamed.
  void (<Media src={SRC} ratio="16/9" />);
  // @ts-expect-error — and a decorative one has nothing to describe.
  void (<Media src={SRC} ratio="16/9" decorative alt="A lamp" />);
}
void _typeChecks;
