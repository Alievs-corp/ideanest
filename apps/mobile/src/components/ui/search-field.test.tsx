import { useState, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { size } from '../../theme';
import { SearchField, type SearchSuggestion } from './search-field';

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
});
