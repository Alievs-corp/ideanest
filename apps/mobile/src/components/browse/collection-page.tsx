import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { collectionOf, useCollection, type Card } from '../../api/queries';
import { pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, size, spacing } from '../../theme';
import { CampaignList } from '../campaign-list';
import { NotFoundState } from '../not-found-state';
import { Meta } from '../text';
import {
  EmptyState,
  ErrorState,
  InlineAlert,
  Pill,
  SkeletonCard,
  SkeletonGroup,
} from '../ui';
import { CollectionHeader, CollectionHeaderSkeleton } from './collection-header';

/**
 * One collection — the web's `/collections/{slug}` (`CollectionHeader` over
 * `CollectionCampaigns`), issue #154.
 *
 * <h2>One virtualised list</h2>
 *
 * The header is the list's header, the campaigns are its items, and "Show more" or the next
 * page's error is its footer — so a collection of two hundred scrolls as smoothly as one of six.
 *
 * <h2>It pages here, in the curator's order</h2>
 *
 * A category landing hands off to the feed after twenty-four; a collection cannot, because no
 * feed filter reproduces the order a curator set. So it pages in place, as on the web — and on a
 * phone it also pages by itself as the end of the list comes near, with "Show more" kept as the
 * path for somebody who does not scroll (and for a screen reader, which is told whose campaigns
 * it would load). A failed page keeps every card already read and says so above the button; the
 * button is how it is retried, and nothing asks again by itself.
 *
 * <h2>Not found, and could not be read</h2>
 *
 * The service answers 404 alike for a slug that names nothing, a collection not yet published,
 * and one outside its window, and this screen draws the same not-found for all three. Any other
 * failure of the first page is an error with retry, not a not-found: "this collection does not
 * exist" would be untrue of a phone that is only offline.
 */
export function CollectionPage({ slug }: { readonly slug: string }) {
  const t = useT('discovery.collections');
  const tAll = useT();
  const locale = useLocale();
  const router = useRouter();
  const query = useCollection(slug);
  const [pulling, setPulling] = useState(false);

  const pages = query.data?.pages;
  const collection = collectionOf(pages?.[0]);
  const cards = useMemo(() => (pages ?? []).flatMap((page) => (page.items ?? []) as Card[]), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor;
  const hasMore = query.hasNextPage;
  const nextPageFailed = query.isFetchNextPageError;

  /*
   * The cursor last asked for. A guard on `isFetchingNextPage` alone is a render late: a press and
   * the end of the list can both land before the flag is set, and both would ask for the same
   * page. Cleared when an ask settles without failing; kept on a failure, so the end of the list
   * does not hammer a page that just failed — the button is how that page is retried.
   */
  const asked = useRef<string | null>(null);

  /*
   * A refresh, a reconnect or a retry of the first page is new data, and the mark is about the
   * old: the service buckets its cursor to the minute, so a first page reloaded after a failed
   * Show more can hand back the very cursor that is still marked, and the button would do
   * nothing. New pages that did not come with a next-page failure clear it.
   */
  const { dataUpdatedAt, isFetchNextPageError } = query;
  useEffect(() => {
    if (!isFetchNextPageError) asked.current = null;
  }, [dataUpdatedAt, isFetchNextPageError]);

  function loadMore({ retry = false }: { retry?: boolean } = {}): void {
    if (!hasMore || nextCursor === undefined) return;
    if (asked.current === nextCursor && !(retry && nextPageFailed)) return;
    if (query.isFetchingNextPage) return;
    const ask = nextCursor;
    asked.current = ask;
    void query.fetchNextPage({ cancelRefetch: false }).then((result) => {
      if (!result.isError && asked.current === ask) asked.current = null;
    });
  }

  if (query.isPending) {
    return (
      <View style={styles.loading}>
        <Stack.Screen options={{ title: tAll('common.trail.collections') }} />
        <SkeletonGroup label={tAll('mobile.browse.loadingCollection')}>
          <View style={styles.loadingBody}>
            <CollectionHeaderSkeleton />
            <View style={styles.cards}>
              {[0, 1, 2].map((index) => (
                <SkeletonCard key={index} />
              ))}
            </View>
          </View>
        </SkeletonGroup>
      </View>
    );
  }

  if (query.isError && collection === null) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <NotFoundState testID="collection-not-found" />;
    }
    return (
      <>
        <Stack.Screen options={{ title: tAll('common.trail.collections') }} />
        <View style={styles.centre}>
          <ErrorState
            title={tAll('discovery.feed.errorTitle')}
            description={tAll('discovery.feed.unreachable')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            testID="collection-error"
          />
        </View>
      </>
    );
  }

  if (collection === null) return <NotFoundState testID="collection-not-found" />;

  const title = collection.title;
  const countLine = tAll(
    `discovery.collections.${hasMore ? 'shownMore' : 'shown'}.${pluralCategory(locale, cards.length)}`,
    { count: String(cards.length) },
  );

  const header = (
    <View style={styles.header}>
      <CollectionHeader collection={collection} />
      {cards.length > 0 ? (
        <Meta tone="secondary" style={styles.count} testID="collection-count">
          {countLine}
        </Meta>
      ) : null}
    </View>
  );

  const empty = (
    <EmptyState
      variant="empty"
      title={t('campaignsEmptyTitle')}
      description={t('campaignsEmptyBody', { title })}
      action={<Pill label={t('emptyAction')} onPress={() => router.push('/discover')} />}
      testID="collection-empty"
    />
  );

  const footer =
    cards.length === 0 ? undefined : (
      <View style={styles.footer}>
        {nextPageFailed ? (
          <InlineAlert
            variant="danger"
            title={t('nextFailedTitle')}
            description={describe(query.error)}
            testID="next-page-error"
          />
        ) : null}
        {hasMore ? (
          <Pill
            label={query.isFetchingNextPage ? t('loading') : t('showMore')}
            accessibilityLabel={t('showMoreLabel', { title })}
            variant="outline"
            disabled={query.isFetchingNextPage}
            onPress={() => loadMore({ retry: true })}
            testID="show-more"
          />
        ) : null}
      </View>
    );

  return (
    <>
    <Stack.Screen options={{ title }} />
    <CampaignList
      cards={cards}
      header={header}
      empty={empty}
      footer={footer}
      onEndReached={() => {
        if (!nextPageFailed) loadMore();
      }}
      onRefresh={() => {
        setPulling(true);
        void query.refetch().finally(() => setPulling(false));
      }}
      refreshing={pulling}
      testID="collection-campaigns"
    />
  </>
  );

  /** The service's own sentence for a page it refused, else the catalogue's — the web's rule. */
  function describe(error: unknown): string {
    if (error instanceof ApiError) {
      return error.problem?.detail ?? error.problem?.title ?? t('refused');
    }
    return t('unreachable');
  }
}

const styles = StyleSheet.create({
  loading: { flex: 1, padding: size.cardGap, backgroundColor: colors.surface1 },
  loadingBody: { gap: spacing[10] },
  cards: { gap: spacing[4] },
  centre: { flex: 1, justifyContent: 'center', padding: size.cardGap, backgroundColor: colors.surface1 },
  header: { gap: spacing[10], paddingBottom: spacing[2] },
  count: { fontVariant: ['tabular-nums'] },
  footer: { alignItems: 'center', gap: spacing[4], paddingTop: spacing[6] },
});
