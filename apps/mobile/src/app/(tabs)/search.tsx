import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { NO_FILTERS, addSlugFilter, withQuery } from '@ideanest/discovery/filters';
import { useSearchResults, type Card } from '../../api/queries';
import { CampaignColumn, CampaignColumnSkeleton } from '../../components/campaign-column';
import { SearchBox } from '../../components/discovery/search-box';
import { Body, Heading, Meta } from '../../components/text';
import {
  EmptyState,
  InlineAlert,
  Pill,
  haptics,
} from '../../components/ui';
import { definedRouteParams, useFeedProblem } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { colors, font, size, spacing } from '../../theme';

/**
 * Search — the web's `/search` (`app/[locale]/(site)/search/page.tsx`), issue #153.
 *
 * <h2>Results on submit, at most twenty-four</h2>
 *
 * The query is this tab's `q` param, so `/search?q=lamp` opens it with the results. Results are
 * fetched when the query is submitted — not as it is typed — and any non-empty text counts. The
 * screen shows the first page only; "See more results in the feed" opens Discover with the same
 * query, where paging and the filters are.
 *
 * <h2>The suggestion list is Discover's</h2>
 *
 * The web's `/search` field has none, but a phone has no header search box, so this tab is the
 * only place to type. The suggestions behave as they do on Discover: a campaign opens, a category,
 * subcategory or tag opens Discover with that filter.
 *
 * <h2>A failure is a failure</h2>
 *
 * The web shows a failed search as "Nothing matched". The app says it failed, with a retry: a
 * backer told that nothing matches will not search again.
 */
export default function SearchScreen() {
  const t = useT('discovery.search');
  const tFeed = useT('discovery.feed');
  const tAll = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? '';

  const results = useSearchResults(query);
  const problem = useFeedProblem(results.error);
  const cards = (results.data?.items ?? []) as Card[];
  const hasMore = results.data?.nextCursor != null && results.data.nextCursor !== '';

  function openFeed(withText: boolean): void {
    const filters = withText ? withQuery(NO_FILTERS, query) : NO_FILTERS;
    router.push({ pathname: '/discover', params: definedRouteParams(filters) });
  }

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        query === '' ? undefined : (
          <RefreshControl
            refreshing={results.isRefetching}
            onRefresh={() => {
              haptics.refresh();
              void results.refetch();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        )
      }
    >
      <Heading accessibilityRole="header">
        {query === '' ? t('title') : t('resultsTitle', { query })}
      </Heading>

      {/*
        Drawn once, above every state, so the field is the same element from typing to loading
        to results and the keyboard does not close under the thumb.
      */}
      <SearchBox
        query={query}
        label={tAll('shell.search.label')}
        placeholder={tAll('shell.search.label')}
        onSubmitQuery={(text) => router.setParams({ q: text === '' ? undefined : text })}
        onChooseFilter={(kind, slug) =>
          router.push({
            pathname: '/discover',
            params: definedRouteParams(addSlugFilter(NO_FILTERS, kind, slug)),
          })
        }
      />

      {body()}
    </ScrollView>
  );

  function body() {
    if (query === '') {
      return (
        <Body testID="search-prompt">
          {t.rich('prompt', {
            feed: (chunks) => (
              <Text
                accessibilityRole="link"
                onPress={() => openFeed(false)}
                style={styles.inlineLink}
              >
                {chunks}
              </Text>
            ),
          })}
        </Body>
      );
    }

    if (results.isPending) return <CampaignColumnSkeleton label={tFeed('loading')} />;

    if (results.isError) {
      return (
        <InlineAlert
          variant="danger"
          title={tFeed('errorTitle')}
          description={problem.detail}
          action={
            <View style={styles.row}>
              <Pill
                label={tFeed('tryAgain')}
                variant="ghost"
                size="sm"
                busy={results.isFetching}
                onPress={() => void results.refetch()}
              />
            </View>
          }
          testID="search-error"
        />
      );
    }

    if (cards.length === 0) {
      // The count line first, as on the web: "No campaigns matched", the ICU plural's `=0`.
      return (
        <View style={styles.results}>
          <Meta tone="secondary" style={styles.count}>
            {t('count', { count: 0 })}
          </Meta>
          <EmptyState
          variant="filtered"
          title={t('emptyTitle', { query })}
          description={t('emptyBody')}
            action={<Pill label={t('emptyAction')} onPress={() => openFeed(false)} />}
            testID="search-empty"
          />
        </View>
      );
    }

    return (
      <View style={styles.results}>
        <Meta tone="secondary" style={styles.count}>
          {hasMore ? t('countMore', { count: cards.length }) : t('count', { count: cards.length })}
        </Meta>
        <CampaignColumn cards={cards} priority={3} />
        <View style={styles.centred}>
          <Pill
            label={hasMore ? t('moreInFeed') : t('refineInFeed')}
            variant="outline"
            onPress={() => openFeed(true)}
            testID="search-in-feed"
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  content: { padding: size.cardGap, paddingBottom: spacing[12], gap: spacing[4] },
  results: { gap: spacing[4] },
  count: { ...font.regular, fontVariant: ['tabular-nums'] },
  centred: { alignItems: 'center', paddingTop: spacing[2] },
  row: { flexDirection: 'row' },
  inlineLink: { color: colors.textPrimary, textDecorationLine: 'underline' },
});

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
