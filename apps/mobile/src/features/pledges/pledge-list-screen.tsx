import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Glyphs } from '../../icons';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import {
  Body,
  EmptyState,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../../components/ui';
import { useTabBarInset } from '../../components/tab-bar';
import { useT } from '../../lib/i18n';
import { signInHrefFor } from '../../lib/guard';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';
import { PledgeCard } from './pledge-card';
import { usePledgeList } from './use-pledge-list';

const PLACEHOLDER_ROWS = [0, 1, 2] as const;

export function PledgeListScreen() {
  return (
    <PledgeListBody />
  );
}

function PledgeListBody() {
  const router = useRouter();
  const tabInset = useTabBarInset();
  const t = useT();
  const { signedIn } = useSession();
  const list = usePledgeList(signedIn);

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
        <SkeletonGroup label={t('account.pledges.list.loading')}>
          <View style={styles.placeholders}>
            {PLACEHOLDER_ROWS.map((row) => (
              <View key={row} style={styles.placeholder}>
                <Skeleton height={18} width="70%" />
                <Skeleton height={14} width="40%" />
                <Skeleton height={22} width="30%" />
              </View>
            ))}
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  return (
    <FlashList
      data={list.items}
      keyExtractor={(item, index) => item.pledgeId ?? `row-${index}`}
      contentContainerStyle={[styles.content, { paddingBottom: tabInset + spacing[4] }]}
      ItemSeparatorComponent={Separator}
      onEndReached={() => list.loadMore()}
      onEndReachedThreshold={0.5}
      testID="pledge-list"
      refreshControl={
        <RefreshControl
          refreshing={list.refreshing}
          onRefresh={() => void list.refresh()}
          tintColor={colors.textSecondary}
          colors={[colors.textPrimary]}
          progressBackgroundColor={colors.surface3}
        />
      }
      ListHeaderComponent={
        <View style={styles.listHeader}>
          {header}
          {list.stale ? (
            <InlineAlert variant="warning" politeness="polite" description={t('mobile.pledges.stale')} />
          ) : null}
        </View>
      }
      ListFooterComponent={
        list.moreFailed ? (
          <View style={styles.footer}>
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
          </View>
        ) : list.fetchingMore ? (
          <View
            style={[styles.footer, styles.loadingMore]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('account.pledges.list.loadingMore')}
            testID="pledges-loading-more"
          >
            <ActivityIndicator color={colors.textSecondary} />
            <Meta tone="secondary">{t('account.pledges.list.loadingMore')}</Meta>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <PledgeCard
          pledge={item}
          onOpen={(id) => router.push({ pathname: '/pledges/[id]', params: { id } })}
        />
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { padding: size.cardGap },
  header: { gap: spacing[2] },
  listHeader: { gap: spacing[4], paddingBottom: spacing[4] },
  emptyWrap: { gap: spacing[6] },
  separator: { height: spacing[3] },
  placeholders: { gap: spacing[3], marginTop: spacing[4] },
  placeholder: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    padding: size.cardPaddingSmall,
    gap: spacing[2],
    minHeight: 88,
  },
  footer: { paddingTop: spacing[4] },
  loadingMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
});
