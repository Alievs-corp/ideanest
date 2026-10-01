import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { useSuggestions, type Suggestion } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { Caption } from '../text';
import { Pill, SearchField, type SearchSuggestion } from '../ui';

/**
 * The search field with its suggestions — the web's `components/discovery/SearchBox.tsx`
 * (issue #153), on the Discover screen and on the Search tab.
 *
 * <h2>The field never lags; the request does</h2>
 *
 * What is typed is drawn at once. The suggestion request follows 200ms after the last keystroke,
 * the web's `SUGGEST_DEBOUNCE_MS`, and only from two characters (`SuggestQuery.MIN_LENGTH`). Each
 * term is its own query key, so an answer for "sol" can never be drawn under "solar": a stale
 * response is dropped by construction rather than by a flag.
 *
 * <h2>What a suggestion does depends on what it is</h2>
 *
 * A campaign opens. A category, subcategory or tag narrows the feed — the caller decides how,
 * because Discover adds the filter in place and the Search tab opens Discover with it. A campaign
 * with no creator slug cannot be addressed, so its label is searched as text instead, which is
 * what the web does.
 */

export const SUGGEST_DEBOUNCE_MS = 200;
const SUGGEST_MIN_LENGTH = 2;

export type SlugKind = 'category' | 'subcategory' | 'tag';

export interface SearchBoxProps {
  /** The query in force, which the field shows until the reader types. */
  readonly query: string;
  /** Free text, committed by the return key or the Search pill. May be empty: clearing searches. */
  readonly onSubmitQuery: (text: string) => void;
  /** A category, subcategory or tag suggestion was chosen. */
  readonly onChooseFilter: (kind: SlugKind, slug: string) => void;
  readonly testID?: string;
}

/** The value, once it has stopped changing for `delay` milliseconds. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function isSlugKind(kind: string | undefined): kind is SlugKind {
  return kind === 'category' || kind === 'subcategory' || kind === 'tag';
}

export function SearchBox({ query, onSubmitQuery, onChooseFilter, testID }: SearchBoxProps) {
  const t = useT('discovery.suggest');
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  // Closed after a choice, until the reader types again: the list answered its question.
  const [open, setOpen] = useState(false);

  // A query changed elsewhere — a cleared search, a deep link — comes back into the field.
  useEffect(() => setDraft(query), [query]);

  const term = draft.trim();
  const settled = useDebouncedValue(open ? term : '', SUGGEST_DEBOUNCE_MS);
  const asking = open && term.length >= SUGGEST_MIN_LENGTH;
  const suggestions = useSuggestions(asking && settled === term ? settled : '');
  const items = useMemo(
    () => (suggestions.data?.items ?? []).filter((item) => (item.label ?? '') !== ''),
    [suggestions.data],
  );

  function submit(text: string): void {
    setOpen(false);
    onSubmitQuery(text.trim());
  }

  function choose(item: Suggestion): void {
    setOpen(false);
    const slug = item.slug ?? '';
    if (isSlugKind(item.kind) && slug !== '') {
      onChooseFilter(item.kind, slug);
      return;
    }
    if (item.kind === 'campaign' && item.parentSlug && slug !== '') {
      router.push({
        pathname: '/projects/[creatorSlug]/[projectSlug]',
        params: { creatorSlug: item.parentSlug, projectSlug: slug },
      });
      return;
    }
    submit(item.label ?? '');
  }

  /*
   * One line under the field while the list cannot speak for itself: looking, nothing found, or
   * failed. Failing is never a dead end — what was typed can still be searched for, and the line
   * says so.
   */
  const status = !asking
    ? null
    : settled !== term || suggestions.isLoading
      ? t('looking')
      : suggestions.isError
        ? failedLine(suggestions.error, t('failedFallback'), String(t.raw('failedDetail')))
        : items.length === 0
          ? fillPlaceholders(String(t.raw('none')), { query: term })
          : null;

  const rows: SearchSuggestion[] = asking
    ? items.map((item, index) => ({
        key: `${item.kind ?? ''}:${item.slug ?? index}`,
        label: item.label ?? '',
        detail: kindLabel(item.kind),
      }))
    : [];

  function kindLabel(kind: string | undefined): string | undefined {
    if (kind === 'campaign' || kind === 'category' || kind === 'subcategory' || kind === 'tag') {
      return t(`kinds.${kind}`);
    }
    return undefined;
  }

  return (
    <View style={styles.box} testID={testID}>
      <View style={styles.row}>
        <View style={styles.field}>
          <SearchField
            label={t('inputLabel')}
            placeholder={t('placeholder')}
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              setOpen(true);
              // Clearing the field with its X clears the search, as emptying the web's box does.
              if (next === '' && query !== '') submit('');
            }}
            onSubmit={submit}
            suggestions={rows}
            onSelectSuggestion={(row) => {
              const item = items[rows.findIndex((candidate) => candidate.key === row.key)];
              if (item !== undefined) choose(item);
            }}
          />
        </View>
        <Pill label={t('submit')} variant="ghost" onPress={() => submit(draft)} />
      </View>
      {status === null ? null : (
        <Caption accessibilityLiveRegion="polite" tone="tertiary">
          {status}
        </Caption>
      )}
    </View>
  );
}

/** The web's two failure sentences: with the problem's own detail when it gave one. */
function failedLine(error: unknown, fallback: string, withDetail: string): string {
  const detail = error instanceof ApiError ? error.problem?.detail : undefined;
  return detail === undefined || detail === null || detail === ''
    ? fallback
    : fillPlaceholders(withDetail, { detail });
}

const styles = StyleSheet.create({
  box: { gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  field: { flex: 1 },
});
