import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useCollections } from '../../api/queries';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { FadeUp } from '../motion';
import { Body, Heading } from '../text';
import { EmptyState, Pill, Screen, SkeletonCard, SkeletonGroup } from '../ui';
import { CollectionCard } from './collection-card';

/**
 * The collections index — the web's `/collections` (`components/collections/CollectionIndex.tsx`),
 * issue #154.
 *
 * A heading and an intro, then every visible collection in one column, in the curator's order —
 * the kinds are not regrouped, because the order is a decision somebody made about what the
 * platform wants read first. The whole index arrives in one read; nothing pages.
 *
 * <h2>Empty and failed</h2>
 *
 * The web shows both the same way, and its copy says so honestly ("nothing is curated … or the
 * list could not be loaded"): the feed is reachable either way. The app keeps that card and adds
 * a "Try again" pill beside "Browse the feed" when the read failed, since it can tell.
 *
 * <h2>Motion</h2>
 *
 * The heading and the intro fade up once, then the first screenful of cards, staggered
 * (`mobile-design` skill §6.5) — the index is one read and never pages, so nothing is appended
 * later that could replay it. The page is the kit's `Screen` on a stack route, so its foot clears
 * the home indicator.
 */
export function CollectionIndex() {
  const t = useT('discovery.collections');
  const tAll = useT();
  const router = useRouter();
  const collections = useCollections();
  const [pulling, setPulling] = useState(false);
  const items = collections.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('title') }} />
      <Screen
        hasContent
        edges={EDGES}
        onRefresh={() => {
          setPulling(true);
          void collections.refetch().finally(() => setPulling(false));
        }}
        refreshing={pulling}
        testID="collection-index"
      >
        <View style={styles.page}>
          <FadeUp>
            <View style={styles.titles}>
              <Heading accessibilityRole="header">{t('title')}</Heading>
              <Body>{t('intro')}</Body>
            </View>
          </FadeUp>

          {collections.isPending ? (
            <SkeletonGroup label={tAll('mobile.browse.loadingCollections')}>
              <View style={styles.list}>
                {[0, 1, 2].map((index) => (
                  <SkeletonCard key={index} />
                ))}
              </View>
            </SkeletonGroup>
          ) : items.length === 0 ? (
            <EmptyState
              variant="empty"
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={
                <View style={styles.actions}>
                  <Pill label={t('emptyAction')} onPress={() => router.push('/discover')} />
                  {collections.isError ? (
                    <Pill
                      label={tAll('discovery.feed.tryAgain')}
                      variant="ghost"
                      busy={collections.isFetching}
                      onPress={() => void collections.refetch()}
                      testID="collections-retry"
                    />
                  ) : null}
                </View>
              }
              testID="collections-empty"
            />
          ) : (
            <View style={styles.list} accessibilityLabel={t('listLabel')} testID="collection-list">
              {items.map((collection, index) => (
                <FadeUp key={collection.id} index={index + 1}>
                  <CollectionCard collection={collection} priority={index < 3} />
                </FadeUp>
              ))}
            </View>
          )}
        </View>
      </Screen>
    </>
  );
}

/** A stack route: no tab bar under it, so the page owns the bottom inset. */
const EDGES = ['left', 'right', 'bottom'] as const;

const styles = StyleSheet.create({
  page: { gap: spacing[10] },
  titles: { gap: spacing[2], paddingTop: spacing[4] },
  list: { gap: spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing[2] },
});
