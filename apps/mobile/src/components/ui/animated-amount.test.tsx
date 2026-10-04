import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { AnimatedAmount, countFrame } from './animated-amount';
import { HeroFigure, minorStart } from './hero-figure';
import { MotionBudgetProvider } from './motion-budget';
import { SurfaceProvider, TONES } from './surface';

/**
 * Every moving number (#278) and the hero figure built on it (#277): the final frame is always the
 * formatted string itself, a screen reader only ever hears it, and Reduce Motion draws it at once.
 */

/** The single-character cells on screen, in order, hidden from assistive technology as they are. */
function cells(): string {
  return screen
    .getAllByText(/./, { includeHiddenElements: true, normalizer: (text) => text })
    .filter((node) => typeof node.props.children === 'string' && node.props.children.length === 1)
    .map((node) => node.props.children as string)
    .join('');
}

describe('countFrame', () => {
  it('lands exactly on the formatted string at the end, character for character', () => {
    for (const template of [
      formatMoney({ amount: '1234567.89', currency: 'AZN' }),
      formatMoney({ amount: '0.05', currency: 'EUR' }),
      formatMoney({ amount: '999999999999.99', currency: 'AZN' }),
      '₼12,000',
    ]) {
      expect(countFrame(template, 1)).toBe(template);
      expect(countFrame(template, 1.2)).toBe(template);
    }
  });

  it('starts from nothing, with no run of leading zeros or separators', () => {
    expect(countFrame('12,345', 0)).toBe('0');
    expect(countFrame('₼12,345', 0)).toBe('₼0');
    expect(countFrame('1,234.56 AZN', 0)).toBe('0.00 AZN');
  });

  it('counts through the value in between, regrouped as the target is', () => {
    expect(countFrame('12,000', 0.5)).toBe('6,000');
    expect(countFrame('1,000,000', 0.25)).toBe('250,000');
    expect(countFrame('2,500.00 AZN', 0.5)).toBe('1,250.00 AZN');
  });

  it('keeps the currency and any text around the number untouched', () => {
    expect(countFrame('100.00 AZN', 0.5).endsWith(' AZN')).toBe(true);
    expect(countFrame('no digits', 0.5)).toBe('no digits');
  });
});

describe('AnimatedAmount', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is one element to a screen reader, named by the final value', async () => {
    await render(<AnimatedAmount value="1,250.00 AZN" testID="amount" />);
    expect(screen.getByRole('text', { name: '1,250.00 AZN' })).toBeTruthy();
    expect(screen.queryByText('1', { exact: true })).toBeNull();
  });

  it('rolls between strings of different lengths and ends on the new one', async () => {
    const view = await render(<AnimatedAmount value="99.00 AZN" mode="roll" testID="amount" />);
    expect(cells()).toBe('99.00 AZN');
    await view.rerender(<AnimatedAmount value="100.00 AZN" mode="roll" testID="amount" />);
    await waitFor(() => expect(cells()).toBe('100.00 AZN'), { timeout: 3000 });
    expect(screen.getByRole('text', { name: '100.00 AZN' })).toBeTruthy();
  });

  it('enters typed characters one cell each', async () => {
    const view = await render(<AnimatedAmount value="1" mode="enter" testID="amount" />);
    await view.rerender(<AnimatedAmount value="12" mode="enter" testID="amount" />);
    await view.rerender(<AnimatedAmount value="128" mode="enter" testID="amount" />);
    expect(cells()).toBe('128');
    expect(screen.getByRole('text', { name: '128' })).toBeTruthy();
  });

  it('counts up in place, holding the final string as its value, the minor part still', async () => {
    await render(
      <AnimatedAmount value="2,500.00 AZN" mode="count" minorFrom={5} testID="amount" />,
    );
    expect(screen.getByTestId('animated-amount-count', { includeHiddenElements: true }).props.defaultValue).toBe(
      '2,500',
    );
    expect(screen.getByText('.00 AZN', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('text', { name: '2,500.00 AZN' })).toBeTruthy();
  });

  it('with motion off: the string at once, as plain text, in every mode', async () => {
    for (const mode of ['enter', 'roll', 'count'] as const) {
      const view = await render(
        <MotionBudgetProvider level="none">
          <AnimatedAmount value="42.00 AZN" mode={mode} testID="amount" />
        </MotionBudgetProvider>,
      );
      expect(screen.getByText('42.00 AZN', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('animated-amount-count', { includeHiddenElements: true })).toBeNull();
      await view.unmount();
    }
  });

  it('with Reduce Motion on, draws the string at once instead of counting', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    await render(<AnimatedAmount value="42.00 AZN" mode="count" testID="amount" />);
    await waitFor(() =>
      expect(screen.getByText('42.00 AZN', { includeHiddenElements: true })).toBeTruthy(),
    );
  });

  it('uses tabular figures, so a changing digit does not shift its neighbours', async () => {
    await render(
      <MotionBudgetProvider level="none">
        <AnimatedAmount value="42" testID="amount" />
      </MotionBudgetProvider>,
    );
    const text = screen.getByText('42', { includeHiddenElements: true });
    expect(StyleSheet.flatten(text.props.style).fontVariant).toEqual(['tabular-nums']);
  });
});

describe('HeroFigure', () => {
  it('formats from the wire string and splits at the decimal point', () => {
    expect(minorStart(formatMoney({ amount: '1234.5', currency: 'AZN' }))).toBe(5);
    expect(minorStart('12')).toBe(2);
  });

  it('names the amount with its label, formatted by @ideanest/money', async () => {
    await render(<HeroFigure money={{ amount: '1234.5', currency: 'AZN' }} label="Raised" />);
    expect(screen.getByRole('text', { name: 'Raised, 1,234.50 AZN' })).toBeTruthy();
  });

  it('draws the major units in the primary tone and the minor units smaller in the tertiary', async () => {
    await render(
      <MotionBudgetProvider level="none">
        <HeroFigure money={{ amount: '1234.5', currency: 'AZN' }} testID="hero" />
      </MotionBudgetProvider>,
    );
    const major = screen.getByText(/^1,234/, { includeHiddenElements: true });
    const minor = screen.getByText('.50 AZN', { includeHiddenElements: true });
    const majorStyle = StyleSheet.flatten(major.props.style);
    const minorStyle = StyleSheet.flatten(minor.props.style);
    expect(majorStyle.color).toBe(TONES.dark.primary);
    expect(minorStyle.color).toBe(TONES.dark.tertiary);
    expect(Number(minorStyle.fontSize)).toBeLessThanOrEqual(Number(majorStyle.fontSize) / 1.5);
  });

  it('reads in the white tones on a white sheet', async () => {
    await render(
      <SurfaceProvider surface="white">
        <MotionBudgetProvider level="none">
          <HeroFigure money={{ amount: '10', currency: 'AZN' }} />
        </MotionBudgetProvider>
      </SurfaceProvider>,
    );
    const major = screen.getByText(/^10/, { includeHiddenElements: true });
    expect(StyleSheet.flatten(major.props.style).color).toBe(TONES.white.primary);
  });
});
