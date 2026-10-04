import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { Glyphs } from '../../icons';
import { Body } from '../text';
import { accent, colors, tint } from '../../theme';
import { AccentCard } from './accent-card';
import { EdgeFade } from './edge-fade';
import { IconButton } from './icon-button';
import { MotionBudgetProvider } from './motion-budget';
import { SurfaceProvider, TONES } from './surface';

/**
 * Accent cards, the translucent circular button over their edge, and the list's edge fade (#277).
 */

describe('AccentCard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is the accent as a whole surface with a glow of the same hue under it', async () => {
    await render(
      <AccentCard accent="sky" testID="card">
        <Body>Garden kit</Body>
      </AccentCard>,
    );
    const surface = screen.getByText('Garden kit').parent;
    const style = StyleSheet.flatten(surface?.props.style);
    expect(style.backgroundColor).toBe(accent.sky.surface);
    expect(style.boxShadow).toEqual([
      expect.objectContaining({ color: accent.sky.glow }),
    ]);
  });

  it('puts its text in the accent tones: near-black, never the dark-canvas white', async () => {
    await render(
      <AccentCard accent="sun">
        <Body>Garden kit</Body>
      </AccentCard>,
    );
    expect(StyleSheet.flatten(screen.getByText('Garden kit').props.style).color).toBe(TONES.accent.secondary);
    expect(TONES.accent.primary).toBe(accent.sun.text);
  });

  it('is one named button with press feedback when it opens something', async () => {
    const onPress = jest.fn();
    await render(
      <AccentCard accent="mint" onPress={onPress} accessibilityLabel="Open Garden kit">
        <Body>Garden kit</Body>
      </AccentCard>,
    );
    const card = screen.getByRole('button', { name: 'Open Garden kit' });
    expect(StyleSheet.flatten(card.props.style).transform).toEqual([{ scale: 1 }]);
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives no press feedback with motion off, but still opens', async () => {
    const onPress = jest.fn();
    await render(
      <MotionBudgetProvider level="none">
        <AccentCard accent="mint" onPress={onPress} accessibilityLabel="Open Garden kit">
          <Body>Garden kit</Body>
        </AccentCard>
      </MotionBudgetProvider>,
    );
    const card = screen.getByRole('button', { name: 'Open Garden kit' });
    expect(StyleSheet.flatten(card.props.style).transform).toBeUndefined();
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('overhangs its action on the top edge, in the accent tones', async () => {
    await render(
      <AccentCard
        accent="sun"
        action={<IconButton icon={Glyphs.Heart} label="Save" variant="translucent" onPress={jest.fn()} />}
      >
        <Body>Garden kit</Body>
      </AccentCard>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(StyleSheet.flatten(save.props.style).backgroundColor).toBe(tint(colors.black, 0.08));
    expect(StyleSheet.flatten(save.parent?.props.style)).toMatchObject({ position: 'absolute', top: 0 });
  });

  it('has no press scale under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    await render(
      <AccentCard accent="mint" onPress={jest.fn()} accessibilityLabel="Open">
        <Body>Garden kit</Body>
      </AccentCard>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Open' }).props.style).transform).toBeUndefined();
  });
});

describe('IconButton variant="translucent"', () => {
  it('is a white veil with a white Bulk glyph on the dark canvas', async () => {
    await render(<IconButton icon={Glyphs.Heart} label="Save" variant="translucent" onPress={jest.fn()} />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe(tint(colors.whiteSurface, 0.12));
    expect(screen.getByTestId('icon-Heart', { includeHiddenElements: true }).props.color).toBe(TONES.dark.primary);
  });

  it('is a dark veil with a near-black glyph on a white sheet', async () => {
    await render(
      <SurfaceProvider surface="white">
        <IconButton icon={Glyphs.Heart} label="Save" variant="translucent" onPress={jest.fn()} />
      </SurfaceProvider>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe(tint(colors.black, 0.08));
    expect(screen.getByTestId('icon-Heart', { includeHiddenElements: true }).props.color).toBe(TONES.white.primary);
  });
});

describe('EdgeFade', () => {
  it('fades to the surface behind the list, takes no touch and says nothing', async () => {
    await render(<EdgeFade color={colors.whiteSurface} height={80} testID="fade" />);
    const fade = screen.getByTestId('fade', { includeHiddenElements: true });
    expect(fade.props.pointerEvents).toBe('none');
    expect(fade.props.accessibilityElementsHidden).toBe(true);
    expect(StyleSheet.flatten(fade.props.style)).toMatchObject({ position: 'absolute', bottom: 0, height: 80 });
  });

  it('is as tall as a gutter outside the tab bar', async () => {
    await render(<EdgeFade testID="fade" />);
    expect(StyleSheet.flatten(screen.getByTestId('fade', { includeHiddenElements: true }).props.style).height).toBe(24);
  });
});
