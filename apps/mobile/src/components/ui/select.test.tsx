import type { ReactElement, ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { Select, type SelectOption } from './select';
import { SurfaceProvider, TONES } from './surface';

/**
 * The select in the white sheet (#282): its options are pressable rows that give under the thumb,
 * the chosen one is marked by a glyph and a heavier word as well as a muted fill, a new choice
 * gives the selection haptic, and Reduce Motion keeps every row still. The round trip and the
 * combobox contract are in `sheet.test.tsx`.
 */

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

const CURRENCIES: readonly SelectOption[] = [
  { value: 'AZN', label: 'Azerbaijani manat' },
  { value: 'EUR', label: 'Euro', description: 'Eurozone' },
];

function flat(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

/** The scale wrapper's transform: PressableScale's `Animated.View` around the row. */
const scaleOf = (row: { parent: { props: { style?: unknown } } | null }) =>
  row.parent === null ? undefined : flat(row.parent).transform;

const select = (onChange = jest.fn()) => (
  <Select label="Currency" options={CURRENCIES} value="AZN" onChange={onChange} />
);

describe('Select options', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('marks the chosen option with a Bold tick and a heavier word, not the fill alone', async () => {
    const view = await renderEn(select());
    await fireEvent.press(view.getByRole('combobox'));

    const chosen = view.getByRole('radio', { name: 'Azerbaijani manat', checked: true });
    const other = view.getByRole('radio', { name: 'Euro', checked: false });
    expect(flat(chosen).backgroundColor).toBe(colors.whiteMuted);
    const ticks = (row: typeof chosen) =>
      within(row).queryAllByTestId('icon-TickCircle', { includeHiddenElements: true });
    expect(ticks(chosen)).toHaveLength(1);
    expect(ticks(other)).toHaveLength(0);
    expect(flat(within(chosen).getByText('Azerbaijani manat')).fontWeight).toBe('600');
    expect(flat(within(other).getByText('Euro')).fontWeight).toBe('400');
    // On the white sheet, in its tones.
    expect(flat(within(other).getByText('Euro')).color).toBe(TONES.white.primary);
    expect(flat(within(other).getByText('Eurozone')).color).toBe(TONES.white.secondary);
    expect(other.props.accessibilityHint).toBe('Eurozone');
  });

  it('gives the selection haptic for a new choice, and none for the one already made', async () => {
    const onChange = jest.fn();
    const view = await renderEn(select(onChange));
    await fireEvent.press(view.getByRole('combobox'));
    await fireEvent.press(view.getByRole('radio', { name: 'Azerbaijani manat' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();

    await fireEvent.press(view.getByRole('combobox'));
    await fireEvent.press(view.getByRole('radio', { name: 'Euro' }));
    expect(onChange).toHaveBeenCalledWith('EUR');
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('gives each option the press scale where motion is allowed', async () => {
    const view = await renderEn(select());
    await fireEvent.press(view.getByRole('combobox'));
    expect(scaleOf(view.getByRole('radio', { name: 'Euro' }))).toEqual([{ scale: 1 }]);
    // And the field itself.
    expect(scaleOf(view.getByRole('combobox'))).toEqual([{ scale: 1 }]);
  });

  it('keeps the options and the field still under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const view = await renderEn(select());
    await waitFor(() => expect(scaleOf(view.getByRole('combobox'))).toBeUndefined());
    await fireEvent.press(view.getByRole('combobox'));
    expect(scaleOf(view.getByRole('radio', { name: 'Euro' }))).toBeUndefined();
  });

  it('keeps everything still under a budget of none, and opens at once', async () => {
    const view = await renderEn(<MotionBudgetProvider level="none">{select()}</MotionBudgetProvider>);
    await fireEvent.press(view.getByRole('combobox'));
    expect(scaleOf(view.getByRole('radio', { name: 'Euro' }))).toBeUndefined();
    expect(view.getByRole('header', { name: 'Currency' })).toBeTruthy();
  });

  it('draws the field in the tones of the surface it sits on', async () => {
    const view = await renderEn(
      <SurfaceProvider surface="white">
        <Select label="Currency" options={CURRENCIES} value={null} placeholder="Choose" onChange={jest.fn()} />
      </SurfaceProvider>,
    );
    expect(flat(view.getByText('Choose')).color).toBe(TONES.white.tertiary);
  });
});
