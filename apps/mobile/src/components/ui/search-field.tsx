import { forwardRef } from 'react';
import { StyleSheet, Text, View, type TextInput as RNTextInput } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  size as measure,
  spacing,
  tint,
} from '../../theme';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { AnimatedPressable, usePressScale } from './press-scale';
import { TONES, useSurface, type Surface } from './surface';
import { TextInput, inputTones } from './text-input';

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
 * <p>A single-line pill (`radius.full`) in the input skin of the surface it sits on — a dark well
 * on the canvas, `whiteMuted` in a sheet. The suggestion list arrives without an entry animation:
 * rows that slid in would move under the finger about to press one. Each row gives the kit's
 * press scale when touched, which is feedback on a press already accepted.
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
  const surface = useSurface();
  const tones = inputTones(surface);

  function submit(query: string): void {
    const trimmed = query.trim();
    if (trimmed !== '') onSubmit(trimmed);
  }

  return (
    <View style={styles.wrapper}>
      <TextInput
        ref={ref}
        testID={testID}
        shape="pill"
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
        leading={<Icon icon={Glyphs.SearchNormal1} size={18} color={tones.icon} />}
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
        <View style={[styles.list, { backgroundColor: tones.fill, borderColor: tones.border }]}>
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

/** A pressed row darkens whatever it sits on — the web's active row is surface-4. */
function pressedFill(surface: Surface): string {
  return surface === 'white' ? tint(colors.black, 0.06) : colors.surface4;
}

function SuggestionRow({
  suggestion,
  disabled,
  onPress,
}: {
  suggestion: SearchSuggestion;
  disabled: boolean;
  onPress: () => void;
}) {
  const surface = useSurface();
  const tones = TONES[surface];
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  return (
    <AnimatedPressable
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
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      style={[
        styles.row,
        press.pressed && !disabled ? { backgroundColor: pressedFill(surface) } : undefined,
        ring,
        press.style,
      ]}
    >
      <Text numberOfLines={2} style={[styles.rowLabel, { color: tones.primary }]}>
        {suggestion.label}
      </Text>
      {suggestion.detail === undefined ? null : (
        <Text style={[styles.rowDetail, { color: tones.tertiary }]}>{suggestion.detail}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing[2] },
  list: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing[1],
    overflow: 'hidden',
  },
  row: {
    minHeight: measure.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  rowLabel: {
    ...font.regular,
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  rowDetail: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
  },
});
