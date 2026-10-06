import { useCallback, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Glyphs } from '../../icons';
import { ActivityIndicator, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  Body,
  ContentSheet,
  EdgeFade,
  EmptyState,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  SurfaceProvider,
  TONES,
  haptics,
} from '../../components/ui';
import { CardEntry, useRowEntryGate } from '../../components/campaign-column';
import { useTabBarInset } from '../../components/tab-bar';
import { useT } from '../../lib/i18n';
import { signInHrefFor } from '../../lib/guard';
import { useSession } from '../../lib/use-session';
import { colors, spacing } from '../../theme';
import type { BackerPledgeSummary } from './api';
import { PledgeCard } from './pledge-card';
import { usePledgeList } from './use-pledge-list';

const PLACEHOLDER_ROWS = [0, 1, 2] as const;

const PledgeFlashList = Animated.createAnimatedComponent(FlashList<BackerPledgeSummary>);

/** `Screen`'s side gutter; the list is its own scroller, so it pads its header and rows itself. */
const GUTTER = spacing[5];

/**
 * The backer's pledges — the Pledges tab (`mobile-design` skill §2).
 *
 * <p>The heading sits on the dark canvas; the rows live in the white content sheet under it. The
 * list is virtualised and paginated, so the sheet is drawn by the list itself: its top (grabber
 * and corners) ends the list header, each row and separator is a white band, and a white backdrop
 * behind the list, from the sheet's top down, carries the sheet to the bottom edge when the list
 * is short. The rows fade out under the floating tab bar (`EdgeFade`).
 */
export function PledgeListScreen() {
  return <PledgeListBody />;
}

function rowKey(item: BackerPledgeSummary, index: number): string {
  return item.pledgeId ?? `row-${index}`;
}

function PledgeListBody() {
  const router = useRouter();
  const tabInset = useTabBarInset();
  const t = useT();
  const { signedIn } = useSession();
  const list = usePledgeList(signedIn);
  const gate = useRowEntryGate(list.items, rowKey);
  const [sheetTop, setSheetTop] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  // The white run-out under short lists follows the sheet's top as the list scrolls and bounces.
  const backdropStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(sheetTop - scrollY.value, 0) }],
  }));

  const open = useCallback(
    (id: string) => router.push({ pathname: '/pledges/[id]', params: { id } }),
    [router],
  );
  const renderRow = useCallback(
    ({ item, index }: { item: BackerPledgeSummary; index: number }) => (
      <View style={styles.band}>
        <SurfaceProvider surface="white">
          <CardEntry gate={gate} entryKey={rowKey(item, index)} index={index}>
            <PledgeCard pledge={item} onOpen={open} />
          </CardEntry>
        </SurfaceProvider>
      </View>
    ),
    [gate, open],
  );

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.pledges.signedOutTitle')}
            description={t('mobile.pledges.signedOutBody')}
            action={
              <Pill label={t('shell.actions.signIn')} onPress={() => router.push(signInHrefFor('/pledges'))} />
            }
          />
        }
      />
    );
  }

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('account.pages.pledges.title')}</Heading>
      <Body>{t('account.pages.pledges.intro')}</Body>
    </View>
  );

  if (list.items.length === 0) {
    return (
      <Screen
        hasContent={list.loading}
        onRefresh={() => void list.refresh()}
        refreshing={list.refreshing}
        error={
          list.failed
            ? {
                title: t('account.pledges.list.failedTitle'),
                description: t('mobile.offline.nothingCached'),
                onRetry: list.retry,
                retrying: list.retrying,
              }
            : null
        }
        empty={
          <View style={styles.emptyWrap}>
            {header}
            <EmptyState
              icon={Glyphs.HeartTick}
              title={t('account.pledges.list.emptyTitle')}
              description={t('account.pledges.list.emptyBody')}
              action={<Pill label={t('account.pledges.list.browse')} onPress={() => router.push('/discover')} />}
            />
          </View>
        }
      >
        {header}
        <ContentSheet>
          <SkeletonGroup label={t('account.pledges.list.loading')}>
            <View style={styles.placeholders}>
              {PLACEHOLDER_ROWS.map((row) => (
                <View key={row} style={styles.placeholder}>
                  <Skeleton circle height={40} />
                  <View style={styles.placeholderText}>
                    <Skeleton height={18} width="70%" />
                    <Skeleton height={14} width="40%" />
                    <Skeleton height={22} width="30%" />
                  </View>
                </View>
              ))}
            </View>
          </SkeletonGroup>
        </ContentSheet>
      </Screen>
    );
  }

  return (
    <View style={styles.page}>
      {sheetTop > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { height: windowHeight }, backdropStyle]}
        />
      ) : null}
      <PledgeFlashList
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={list.items}
        keyExtractor={rowKey}
        contentContainerStyle={{ paddingBottom: tabInset + spacing[6] }}
        ItemSeparatorComponent={Separator}
        onEndReached={() => list.loadMore()}
        onEndReachedThreshold={0.5}
        testID="pledge-list"
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={() => {
              haptics.refresh();
              void list.refresh();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        }
        ListHeaderComponent={
          <View onLayout={(event) => setSheetTop(event.nativeEvent.layout.height)}>
            <View style={styles.listHeader}>
              {header}
              {list.stale ? (
                <InlineAlert variant="warning" politeness="polite" description={t('mobile.pledges.stale')} />
              ) : null}
            </View>
            <ContentSheet style={styles.sheetTop} />
          </View>
        }
        ListFooterComponent={
          <View style={[styles.band, styles.footer]}>
            <SurfaceProvider surface="white">
              {list.moreFailed ? (
                <InlineAlert
                  variant="danger"
                  politeness="polite"
                  title={t('account.pledges.list.nextPageFailed')}
                  action={
                    <Pill
                      size="sm"
                      variant="ghost"
                      label={t('common.tryAgain')}
                      busy={list.fetchingMore}
                      onPress={() => list.loadMore({ retry: true })}
                      testID="pledges-next-retry"
                    />
                  }
                  testID="pledges-next-failed"
                />
              ) : list.fetchingMore ? (
                <View
                  style={styles.loadingMore}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('account.pledges.list.loadingMore')}
                  testID="pledges-loading-more"
                >
                  <ActivityIndicator color={TONES.white.secondary} />
                  <Meta tone="secondary">{t('account.pledges.list.loadingMore')}</Meta>
                </View>
              ) : null}
            </SurfaceProvider>
          </View>
        }
        renderItem={renderRow}
      />
      <EdgeFade />
    </View>
  );
}

function Separator() {
  return <View style={[styles.band, styles.separator]} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface1 },
  // The sheet's continuation behind a short list; rows and separators cover it everywhere else.
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.whiteSurface },
  header: { gap: spacing[2] },
  listHeader: { gap: spacing[4], paddingHorizontal: GUTTER, paddingTop: spacing[4], paddingBottom: spacing[6] },
  // Only the sheet's top: no bleed (the list has no gutter to bleed through) and no tail.
  sheetTop: { flexGrow: 0, marginHorizontal: 0, marginBottom: 0, paddingBottom: 0 },
  band: { backgroundColor: colors.whiteSurface, paddingHorizontal: GUTTER },
  emptyWrap: { gap: spacing[6] },
  separator: { height: spacing[3] },
  placeholders: { gap: spacing[5] },
  placeholder: { flexDirection: 'row', gap: spacing[3] },
  placeholderText: { flex: 1, gap: spacing[2] },
  footer: { paddingTop: spacing[4] },
  loadingMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
});
