import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput as RNTextInput } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size as measure, spacing } from '../../theme';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { TextInput } from './text-input';

/**
 * A search box with suggestions — the native half of the web's `Combobox` (`docs/ui-kit.md`
 * §7.14), which the Search tab consumes.
 *
 * <p>The web's combobox floats a listbox over the page and keeps focus in the input with
 * `aria-activedescendant`. A phone has no pointer to hover the popup with and no arrow keys to
 * walk it, and a floating list over a half-screen keyboard covers the thing being searched. So
 * the suggestions are drawn IN FLOW, directly under the input, each a 44pt row a thumb can hit
 * and a screen reader reaches by swiping on from the input.
 *
 * <p>The input is `accessibilityRole="search"`. Submitting — the keyboard's search key — commits
 * the query; choosing a suggestion commits that one. A clear button appears once there is
 * something to clear, named with the web's `discovery.feed.clearSearch`.
 *
 * <p>No animation, as on the web: suggestions that slid in would move under the finger that is
 * about to press one.
 */

export interface SearchSuggestion {
  readonly key: string;
  readonly label: string;
  /**
   * What the suggestion is — "Category", "Tag" (#153) — drawn on the right of the row and read
   * after the label, so a campaign and a category with the same name can be told apart.
   */
  readonly detail?: string;
  readonly accessibilityLanguage?: string;
}

export interface SearchFieldProps {
  /** The input's accessible name — e.g. `discovery.suggest.inputLabel`. */
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  /** Commit the query. Called with the trimmed text; never with an empty one. */
  readonly onSubmit: (query: string) => void;
  readonly placeholder?: string;
  readonly suggestions?: readonly SearchSuggestion[];
  /** Commit a suggestion. When absent, choosing one submits its label as the query. */
  readonly onSelectSuggestion?: (suggestion: SearchSuggestion) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export const SearchField = forwardRef<RNTextInput, SearchFieldProps>(function SearchField(
  {
    label,
    value,
    onChangeText,
    onSubmit,
    placeholder,
    suggestions = [],
    onSelectSuggestion,
    disabled = false,
    testID,
  },
  ref,
) {
  const t = useT('discovery.feed');

  function submit(query: string): void {
    const trimmed = query.trim();
    if (trimmed !== '') onSubmit(trimmed);
  }

  return (
    <View style={styles.wrapper}>
      <TextInput
        ref={ref}
        testID={testID}
        accessibilityRole="search"
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        disabled={disabled}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        onSubmitEditing={(event) => submit(event.nativeEvent.text)}
        leading={<Icon icon={Glyphs.SearchNormal1} size={16} color={colors.textTertiary} />}
        trailing={
          value !== '' ? (
            <IconButton
              icon={Glyphs.Close}
              label={t('clearSearch')}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onPress={() => onChangeText('')}
            />
          ) : undefined
        }
      />

      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.key}
              suggestion={suggestion}
              disabled={disabled}
              onPress={() =>
                onSelectSuggestion !== undefined
                  ? onSelectSuggestion(suggestion)
                  : submit(suggestion.label)
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function SuggestionRow({
  suggestion,
  disabled,
  onPress,
}: {
  suggestion: SearchSuggestion;
  disabled: boolean;
  onPress: () => void;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        suggestion.detail === undefined
          ? suggestion.label
          : `${suggestion.label}, ${suggestion.detail}`
      }
      accessibilityLanguage={suggestion.accessibilityLanguage}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, ring]}
    >
      <Text numberOfLines={2} style={styles.rowLabel}>
        {suggestion.label}
      </Text>
      {suggestion.detail === undefined ? null : (
        <Text style={styles.rowDetail}>{suggestion.detail}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing[2] },
  list: {
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing[1],
    overflow: 'hidden',
  },
  row: {
    minHeight: measure.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: 14,
  },
  // The web's active row: surface-4.
  rowPressed: { backgroundColor: colors.surface4 },
  rowLabel: {
    ...font.regular,
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
  rowDetail: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
  },
});
