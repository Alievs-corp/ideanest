import { useState, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, motion, radius, size } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { SearchField, type SearchSuggestion } from './search-field';
import { SurfaceProvider } from './surface';

/**
 * The search box the Search tab consumes: a search input, suggestions in flow below it that a
 * thumb can hit, and a query that is committed only when submitted or chosen.
 */

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

const LABEL = en.discovery.suggest.inputLabel;

const SUGGESTIONS: readonly SearchSuggestion[] = [
  { key: 'board-games', label: 'Board games' },
  { key: 'books', label: 'Books' },
];

function Search({
  onSubmit = jest.fn(),
  onSelectSuggestion,
  suggestions = SUGGESTIONS,
  initial = '',
}: {
  onSubmit?: (query: string) => void;
  onSelectSuggestion?: (suggestion: SearchSuggestion) => void;
  suggestions?: readonly SearchSuggestion[];
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      label={LABEL}
      value={value}
      onChangeText={setValue}
      onSubmit={onSubmit}
      placeholder={en.discovery.suggest.placeholder}
      suggestions={suggestions}
      onSelectSuggestion={onSelectSuggestion}
    />
  );
}

describe('SearchField', () => {
  it('is a search input named by its label', async () => {
    const { getByLabelText } = await renderEn(<Search />);
    const input = getByLabelText(LABEL);
    expect(input.props.accessibilityRole).toBe('search');
    expect(input.props.returnKeyType).toBe('search');
  });

  it('commits the trimmed query on submit, and not an empty one', async () => {
    const onSubmit = jest.fn();
    const { getByLabelText } = await renderEn(<Search onSubmit={onSubmit} />);

    await fireEvent(getByLabelText(LABEL), 'submitEditing', { nativeEvent: { text: '   ' } });
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent(getByLabelText(LABEL), 'submitEditing', {
      nativeEvent: { text: '  dice  ' },
    });
    expect(onSubmit).toHaveBeenCalledWith('dice');
  });

  it('lists suggestions in flow as 44pt buttons', async () => {
    const { getByRole } = await renderEn(<Search />);
    const row = getByRole('button', { name: 'Board games' });
    const { style } = row.props as { style?: unknown };
    const flat = StyleSheet.flatten(
      typeof style === 'function' ? style({ pressed: false }) : style,
    );
    expect(flat.minHeight).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('commits a chosen suggestion', async () => {
    const onSelectSuggestion = jest.fn();
    const { getByRole } = await renderEn(<Search onSelectSuggestion={onSelectSuggestion} />);
    await fireEvent.press(getByRole('button', { name: 'Books' }));
    expect(onSelectSuggestion).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it('submits a suggestion’s words when the screen takes no suggestion handler', async () => {
    const onSubmit = jest.fn();
    const { getByRole } = await renderEn(<Search onSubmit={onSubmit} />);
    await fireEvent.press(getByRole('button', { name: 'Board games' }));
    expect(onSubmit).toHaveBeenCalledWith('Board games');
  });

  it('offers to clear the search only when there is something to clear', async () => {
    const empty = await renderEn(<Search />);
    expect(empty.queryByRole('button', { name: en.discovery.feed.clearSearch })).toBeNull();

    const typed = await renderEn(<Search initial="dice" />);
    await fireEvent.press(typed.getByRole('button', { name: en.discovery.feed.clearSearch }));
    expect(typed.getByLabelText(LABEL).props.value).toBe('');
  });

  it('draws a suggestion’s kind after its label and reads both (#153)', async () => {
    const { getByRole, getByText } = await renderEn(
      <Search suggestions={[{ key: 'games', label: 'Games', detail: 'Category' }]} />,
    );
    expect(getByText('Category')).toBeTruthy();
    expect(getByRole('button', { name: 'Games, Category' })).toBeTruthy();
  });

  it('renders no list when there are no suggestions', async () => {
    const { queryAllByRole } = await renderEn(<Search suggestions={[]} />);
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('is a pill on the canvas, in the dark input skin', async () => {
    const { getByLabelText } = await renderEn(<Search />);
    const frame = getByLabelText(LABEL).parent as { props: { style?: unknown } };
    expect(StyleSheet.flatten(frame.props.style as never)).toMatchObject({
      borderRadius: radius.full,
      backgroundColor: colors.surface3,
    });
  });

  it('reads a white sheet: white-muted pill and list, on-white text', async () => {
    const { getByLabelText, getByText } = await renderEn(
      <SurfaceProvider surface="white">
        <Search />
      </SurfaceProvider>,
    );
    const input = getByLabelText(LABEL);
    const frame = input.parent as { props: { style?: unknown } };
    expect(StyleSheet.flatten(frame.props.style as never)).toMatchObject({
      borderRadius: radius.full,
      backgroundColor: colors.whiteMuted,
    });
    expect(StyleSheet.flatten(input.props.style).color).toBe(colors.textOnWhite);
    expect(StyleSheet.flatten(getByText('Books').props.style).color).toBe(colors.textOnWhite);
  });

  describe('suggestion press feedback', () => {
    afterEach(() => jest.restoreAllMocks());

    const scaleOf = (node: unknown) =>
      (getAnimatedStyle(node as never) as { transform?: { scale: number }[] }).transform?.[0]
        ?.scale;

    it('gives under the thumb, and the press still commits', async () => {
      const onSelectSuggestion = jest.fn();
      const { getByRole } = await renderEn(<Search onSelectSuggestion={onSelectSuggestion} />);
      const row = getByRole('button', { name: 'Books' });
      await fireEvent(row, 'pressIn');
      await waitFor(() => expect(scaleOf(row)).toBe(motion.pressScale), { timeout: 3000 });
      await fireEvent(row, 'pressOut');
      await fireEvent.press(row);
      expect(onSelectSuggestion).toHaveBeenCalledWith(SUGGESTIONS[1]);
    });

    it('does not move under Reduce Motion — the pressed colour is the whole response', async () => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      const { getByRole } = await renderEn(
        <MotionBudgetProvider level="none">
          <Search />
        </MotionBudgetProvider>,
      );
      const row = getByRole('button', { name: 'Books' });
      await fireEvent(row, 'pressIn');
      const style = StyleSheet.flatten(getByRole('button', { name: 'Books' }).props.style);
      expect(style.transform).toBeUndefined();
      expect(style.backgroundColor).toBe(colors.surface4);
    });
  });
});
