import { useDeferredValue, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSearchResults, useSuggestions, type Card } from '../../api/queries';
import { CampaignList, CampaignListSkeleton } from '../../components/campaign-list';
import { Body } from '../../components/text';
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  MotionBudgetProvider,
  SearchField,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { size, spacing } from '../../theme';

/**
 * Search — §4.3's second half.
 *
 * <h2>Why `useDeferredValue` and not a debounce timer</h2>
 *
 * A `setTimeout` debounce is the usual answer and it is worse in the way that
 * matters on a phone: it delays the FIELD as well as the request, so the letters
 * appear late under the thumb. `useDeferredValue` keeps the input at full speed
 * and lets the expensive half — the query, and the list that re-renders with it
 * — lag behind by a render. There is no timer to tune and no timer to leak.
 *
 * The request is still not made for one or two characters: `useSuggestions`
 * refuses under two, and results wait for three. A single-letter full-text
 * search against a trigram index is the most expensive query on the platform and
 * the least useful.
 *
 * <h2>Suggestions are not results</h2>
 *
 * `/v1/search/suggest` answers categories, tags and locations — the things
 * `Taxonomy` has translated — and tapping one narrows the search rather than
 * opening a campaign. They are drawn as the kit's chips above the list so that
 * the two are not confused; a suggestion styled like a result is a tap somebody
 * has to undo. A chosen chip is white with near-black text, never lime: a
 * filter somebody picked is a choice, not an urgent action (issue #151).
 *
 * <p>The field is the kit's `SearchField` without its suggestion rows — the
 * suggestions here narrow rather than submit, so they are chips instead. The
 * keyboard's search key only commits what is already typed; the results follow
 * the text as it changes.
 *
 * <h2>Motion: minimal</h2>
 *
 * Discovery's budget (`docs/motion-system.md` §5 and §5.1): no card moves, the
 * suggestions appear and disappear, a chip changes colour and nothing else. The
 * skeleton's shimmer is what is left.
 */

const MINIMUM_QUERY = 3;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /*
   * The field's place: the list's own side padding, and its top. Everything under it — the hint,
   * the skeleton, the error, the list — starts with the list's `cardGap` padding too, so the field
   * never moves when the state under it changes.
   */
  header: {
    gap: spacing[3],
    paddingHorizontal: size.cardGap,
    paddingTop: size.cardGap,
  },
  below: { padding: size.cardGap },
});

export default function SearchScreen() {
  const t = useT();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);

  const deferredTerm = useDeferredValue(term);
  const trimmed = deferredTerm.trim();
  const enabled = trimmed.length >= MINIMUM_QUERY || category !== undefined;

  const query = useMemo(
    () => ({
      q: trimmed === '' ? undefined : trimmed,
      // A list because the contract binds several; this screen offers one chip
      // at a time, which is one element rather than a different shape.
      category: category === undefined ? undefined : [category],
    }),
    [trimmed, category],
  );

  const results = useSearchResults(query, enabled);
  const suggestions = useSuggestions(deferredTerm);

  const cards = useMemo(
    () => (results.data?.pages ?? []).flatMap((page) => (page.items ?? []) as Card[]),
    [results.data],
  );

  const header = (
    <View style={styles.header}>
      {/*
        A field whose only label is its placeholder is announced as its current value, or as
        nothing at all once somebody has typed — so the placeholder's words are its name too.
      */}
      <SearchField
        label={t('discovery.suggest.inputLabel')}
        placeholder={t('discovery.suggest.inputLabel')}
        value={term}
        onChangeText={setTerm}
        onSubmit={setTerm}
      />

      {(suggestions.data?.items ?? []).length > 0 ? (
        <ChipRow>
          {(suggestions.data?.items ?? []).map((item) => {
            const selected = category === item.slug;
            return (
              <Chip
                key={`${item.kind}:${item.slug}`}
                label={item.label ?? ''}
                selected={selected}
                onPress={() => setCategory(selected ? undefined : item.slug)}
                // The label is the name speech input reaches it by; what pressing it does is the hint.
                accessibilityHint={t('mobile.search.narrow', { label: item.label ?? '' })}
              />
            );
          })}
        </ChipRow>
      ) : null}
    </View>
  );

  /*
   * The field is drawn ONCE, in one place above whatever state is under it — never as the list's
   * header. A field that moved between the hint, the loading state and the list's header was a
   * different element in each, so the input remounted as a search went from typing to loading to
   * results, and the keyboard closed under the thumb at the third character. Results from the last
   * query stay on screen while the next one loads (`placeholderData` in `useSearchResults`), so
   * typing does not fall back to the skeleton at every key either.
   */
  return (
    <MotionBudgetProvider level="minimal">
      <View style={styles.fill}>
        {header}
        {body()}
      </View>
    </MotionBudgetProvider>
  );

  function body() {
    if (!enabled) {
      return (
        <View style={styles.below}>
          <Body>{t('mobile.search.minimum', { count: MINIMUM_QUERY })}</Body>
        </View>
      );
    }

    if (cards.length === 0) {
      if (results.isLoading) return <CampaignListSkeleton label={t('discovery.feed.loading')} />;
      if (results.isError) {
        return (
          <View style={styles.below}>
            <ErrorState
              title={t('discovery.feed.errorTitle')}
              description={t('discovery.feed.unreachable')}
              onRetry={() => void results.refetch()}
              retrying={results.isFetching}
            />
          </View>
        );
      }
    }

    return (
      <CampaignList
        cards={cards}
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
        }}
        empty={
          /*
           * The web's empty feed for a term and for a term inside a category. A category chip on
           * its own has no term to quote back, and the web's "nothing published" body would be
           * untrue of it, so its body is the app's: try another category.
           */
          query.q === undefined ? (
            <EmptyState
              variant="filtered"
              title={t('discovery.feed.emptyFilteredTitle')}
              description={t('mobile.search.emptyCategoryBody')}
            />
          ) : (
            <EmptyState
              variant="filtered"
              title={t('discovery.feed.emptyQueryTitle', { query: query.q })}
              description={
                category === undefined
                  ? t('discovery.feed.emptyQueryBody')
                  : t('discovery.feed.emptyQueryBodyFiltered')
              }
            />
          )
        }
      />
    );
  }
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
