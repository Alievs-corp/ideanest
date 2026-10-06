import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Stack, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { ApiError } from '@ideanest/api-client';
import { CATEGORIES } from '@ideanest/account/notifications';
import {
  categoryLabel,
  dayLabelOf,
  groupByDay,
  isUnread,
  notificationsCopyOf,
  visibleNotifications,
  type InboxFilter,
  type InboxNotification,
} from '@ideanest/account/inbox';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { CardEntry, type EntryGate } from '../../components/campaign-column';
import { FIRST_SCREENFUL } from '../../components/motion';
import {
  Body,
  Chip,
  ChipRow,
  ContentSheet,
  EdgeFade,
  EmptyState,
  Eyebrow,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  Subheading,
  SurfaceProvider,
  TONES,
  haptics,
  useAssistiveTechnology,
} from '../../components/ui';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { catalogue, useT, type Translate } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { colors, spacing } from '../../theme';
import { InlineLink } from '../settings/settings-page';
import { NotificationRow } from './notification-row';
import { useInbox } from './use-inbox';

const PATH = '/notifications';
const PLACEHOLDER_ROWS = [0, 1, 2, 3] as const;

/** `Screen`'s side gutter; the list is its own scroller, so it pads its header and rows itself. */
const GUTTER = spacing[5];

type Item =
  | { readonly kind: 'day'; readonly key: string; readonly label: string }
  | { readonly kind: 'row'; readonly notification: InboxNotification };

const InboxFlashList = Animated.createAnimatedComponent(FlashList<Item>);

/** A refusal as a sentence: the service's own words first, then the catalogue's. */
export function inboxFailureMessage(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    return cause.problem?.detail ?? cause.problem?.title ?? t('account.notifications.inbox.refused');
  }
  return t('account.notifications.inbox.unreachable');
}

function itemKey(item: Item): string {
  return item.kind === 'day' ? `day-${item.key}` : item.notification.id;
}

/** The first screenful of the first page rises in, once per row (`mobile-design` skill §6.5). */
function useRowEntryGate(items: readonly InboxNotification[]): EntryGate {
  const first = useRef<ReadonlySet<string> | null>(null);
  if (first.current === null && items.length > 0) {
    first.current = new Set(items.slice(0, FIRST_SCREENFUL).map((row) => row.id));
  }
  const [gate] = useState<EntryGate>(() => {
    const done = new Set<string>();
    return {
      rises: (key) => first.current?.has(key) === true && !done.has(key),
      risen: (key) => {
        done.add(key);
      },
    };
  });
  return gate;
}

/**
 * `notifications` — the web's `InboxPanel` (#88) as the app's inbox (#160).
 *
 * <p>The title and intro sit on the dark canvas; the panel lives in the white content sheet under
 * them, drawn by the list itself as the Pledges tab draws its sheet: the sheet's top ends the list
 * header, each day heading and row is a white band, and a white backdrop carries the sheet to the
 * bottom edge when the list is short.
 *
 * <ul>
 *   <li>Infinite paging by `before`/`beforeId`; pull to refresh reloads from the newest page.</li>
 *   <li>The unread-only toggle and the category chips filter the rows loaded so far, as on the web,
 *       and the filtered-empty state says so.</li>
 *   <li>Mark as read waits for the service, then replaces the row and lowers the count. Opening a
 *       row with a destination navigates and marks it read on the way.</li>
 *   <li>Offline: what this process read, with a notice; marking read waits for a connection.</li>
 * </ul>
 */
export function InboxScreen() {
  const t = useT('account.notifications.inbox');
  const tPage = useT('account.pages.inbox');
  const tAll = useT();
  const router = useRouter();
  const locale = useLocale();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const assisted = useAssistiveTechnology();
  const { signedIn } = useSession();
  const inbox = useInbox(signedIn);
  const gate = useRowEntryGate(inbox.items);
  const copy = useMemo(() => notificationsCopyOf(catalogue(locale).account.notifications), [locale]);

  const [filter, setFilter] = useState<InboxFilter>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const [sheetTop, setSheetTop] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const backdropStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(sheetTop - scrollY.value, 0) }],
  }));

  // Pinned per load, so every row's "ago" is measured from one instant.
  const { updatedAt } = inbox;
  const now = useMemo(() => new Date(Math.max(Date.now(), updatedAt)), [updatedAt]);

  const items = useMemo<readonly Item[]>(() => {
    const shown = visibleNotifications(inbox.items, filter, unreadOnly);
    return groupByDay(shown).flatMap(([key, rows]) => [
      { kind: 'day' as const, key, label: dayLabelOf(rows[0]?.occurredAt ?? '', now, locale) },
      ...rows.map((notification) => ({ kind: 'row' as const, notification })),
    ]);
  }, [inbox.items, filter, unreadOnly, now, locale]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const { markRead } = inbox;

  const onMarkRead = useCallback(
    async (notification: InboxNotification) => {
      if (!online) return;
      markBusy(notification.id, true);
      setError(null);
      try {
        await markRead(notification.id);
      } catch (cause) {
        setError(inboxFailureMessage(cause, tAll));
      } finally {
        markBusy(notification.id, false);
      }
    },
    [markBusy, markRead, online, tAll],
  );

  /*
   * The reader has left for the destination by the time the read lands, so a failure is silent:
   * the row stays unread and the next visit shows it so — the web's choice, and the honest one.
   */
  const onOpen = useCallback(
    (notification: InboxNotification, href: string) => {
      router.push(href as Href);
      if (isUnread(notification) && online) void markRead(notification.id).catch(() => undefined);
    },
    [markRead, online, router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Item; index: number }) => (
      <View style={styles.band}>
        <SurfaceProvider surface="white">
          {item.kind === 'day' ? (
            <Eyebrow accessibilityRole="header" style={styles.day}>
              {item.label}
            </Eyebrow>
          ) : (
            <CardEntry gate={gate} entryKey={item.notification.id} index={index}>
              <NotificationRow
                notification={item.notification}
                now={now}
                locale={locale}
                copy={copy}
                busy={busyIds.has(item.notification.id)}
                online={online}
                onOpen={onOpen}
                onMarkRead={(row) => void onMarkRead(row)}
              />
            </CardEntry>
          )}
        </SurfaceProvider>
      </View>
    ),
    [busyIds, copy, gate, locale, now, onMarkRead, onOpen, online],
  );

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{tPage('title')}</Heading>
      <Body>
        {tPage.rich('intro', {
          settings: (chunks) => (
            <InlineLink href="/settings/notifications" testID="inbox-settings-link">
              {chunks}
            </InlineLink>
          ),
        })}
      </Body>
    </View>
  );

  const title = <Stack.Screen options={{ title: tPage('title') }} />;

  if (!signedIn) {
    return (
      <>
        {title}
        <Screen
          hasContent={false}
          testID="inbox-signed-out"
          empty={
            <EmptyState
              title={t('signedOut')}
              description={tAll('mobile.notifications.signedOutBody')}
              action={
                <Pill label={tAll('shell.actions.signIn')} onPress={() => router.push(signInHrefFor(PATH))} />
              }
            />
          }
        />
      </>
    );
  }

  if (inbox.loading || inbox.failed) {
    return (
      <>
        {title}
        <Screen
          hasContent={inbox.loading}
          testID="inbox"
          error={
            inbox.failed
              ? {
                  title: t('errorTitle'),
                  description: online
                    ? inboxFailureMessage(inbox.error, tAll)
                    : tAll('mobile.offline.nothingCached'),
                  onRetry: inbox.retry,
                  retrying: inbox.retrying,
                }
              : null
          }
        >
          {header}
          <ContentSheet>
            <SkeletonGroup label={t('loadingList')} testID="inbox-loading">
              <View>
                {PLACEHOLDER_ROWS.map((row) => (
                  <View key={row} style={styles.placeholder}>
                    <Skeleton circle height={spacing[2]} />
                    <View style={styles.placeholderText}>
                      <Skeleton height={16} width="75%" />
                      <Skeleton height={12} width="40%" />
                    </View>
                  </View>
                ))}
              </View>
            </SkeletonGroup>
          </ContentSheet>
        </Screen>
      </>
    );
  }

  const unread = inbox.unreadCount ?? 0;
  const empty = inbox.items.length === 0;

  return (
    <View style={styles.page}>
      {title}
      {sheetTop > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { height: windowHeight }, backdropStyle]}
        />
      ) : null}
      <InboxFlashList
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={items}
        keyExtractor={itemKey}
        getItemType={(item) => item.kind}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing[6] }}
        onEndReached={() => inbox.loadMore()}
        onEndReachedThreshold={0.5}
        testID="inbox"
        refreshControl={
          <RefreshControl
            refreshing={inbox.refreshing}
            onRefresh={() => {
              haptics.refresh();
              void inbox.refresh();
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
              {inbox.stale ? (
                // Polite: the offline banner has already said it once.
                <InlineAlert
                  variant="warning"
                  politeness="polite"
                  description={tAll('mobile.notifications.stale')}
                  testID="inbox-stale"
                />
              ) : null}
            </View>
            <ContentSheet style={styles.sheetTop}>
              <View style={styles.panelHeader}>
                <View accessible accessibilityRole="header" style={styles.panelTitle}>
                  <Subheading>{t('heading')}</Subheading>
                  {unread > 0 ? (
                    <Meta testID="inbox-unread">
                      {fillPlaceholders(String(t.raw('unread')), { count: String(unread) })}
                    </Meta>
                  ) : null}
                </View>
                <Pill
                  label={t('unreadOnly')}
                  variant={unreadOnly ? 'primary' : 'ghost'}
                  size="sm"
                  selected={unreadOnly}
                  onPress={() => setUnreadOnly((previous) => !previous)}
                  testID="inbox-unread-only"
                />
              </View>
              <View accessibilityRole="toolbar" accessibilityLabel={t('filterLabel')} testID="inbox-filters">
                <ChipRow>
                  <Chip
                    label={t('all')}
                    selected={filter === 'ALL'}
                    onPress={() => setFilter('ALL')}
                    testID="inbox-filter-ALL"
                  />
                  {CATEGORIES.map((category) => (
                    <Chip
                      key={category}
                      label={categoryLabel(category, copy)}
                      selected={filter === category}
                      onPress={() => setFilter(category)}
                      testID={`inbox-filter-${category}`}
                    />
                  ))}
                </ChipRow>
              </View>
              {error === null ? null : (
                <InlineAlert
                  variant="danger"
                  politeness="assertive"
                  title={t('errorTitle')}
                  description={error}
                  testID="inbox-error"
                />
              )}
            </ContentSheet>
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.band, styles.emptyBand]}>
            <SurfaceProvider surface="white">
              {empty ? (
                <EmptyState title={t('emptyTitle')} description={t('emptyBody')} testID="inbox-empty" />
              ) : (
                <EmptyState
                  variant="filtered"
                  title={t('filteredTitle')}
                  description={t('filteredBody')}
                  action={
                    inbox.hasMore ? (
                      <Pill
                        variant="outline"
                        label={inbox.fetchingMore ? t('loading') : t('loadMore')}
                        busy={inbox.fetchingMore}
                        onPress={() => inbox.loadMore()}
                        testID="inbox-filtered-more"
                      />
                    ) : undefined
                  }
                  testID="inbox-filtered"
                />
              )}
            </SurfaceProvider>
          </View>
        }
        ListFooterComponent={
          <View style={[styles.band, styles.footer]}>
            <SurfaceProvider surface="white">
              {inbox.moreFailed ? (
                <InlineAlert
                  variant="danger"
                  politeness="polite"
                  title={tAll('common.list.nextPageFailed')}
                  action={
                    <Pill
                      size="sm"
                      variant="ghost"
                      label={tAll('common.tryAgain')}
                      busy={inbox.fetchingMore}
                      onPress={() => inbox.loadMore({ retry: true })}
                      testID="inbox-next-retry"
                    />
                  }
                  testID="inbox-next-failed"
                />
              ) : inbox.fetchingMore ? (
                <View
                  style={styles.loadingMore}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('loading')}
                  testID="inbox-loading-more"
                >
                  <ActivityIndicator color={TONES.white.secondary} />
                  <Meta tone="secondary">{t('loading')}</Meta>
                </View>
              ) : assisted && inbox.hasMore && items.length > 0 ? (
                <Pill
                  variant="outline"
                  label={t('loadMore')}
                  onPress={() => inbox.loadMore()}
                  testID="inbox-show-more"
                />
              ) : null}
            </SurfaceProvider>
          </View>
        }
        renderItem={renderItem}
      />
      <EdgeFade />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface1 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.whiteSurface },
  header: { gap: spacing[2] },
  listHeader: { gap: spacing[4], paddingHorizontal: GUTTER, paddingTop: spacing[4], paddingBottom: spacing[6] },
  sheetTop: { flexGrow: 0, marginHorizontal: 0, marginBottom: 0, paddingBottom: spacing[2] },
  panelHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  panelTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing[2] },
  band: { backgroundColor: colors.whiteSurface, paddingHorizontal: GUTTER },
  day: { paddingTop: spacing[4], paddingBottom: spacing[1] },
  emptyBand: { paddingVertical: spacing[6] },
  placeholder: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingVertical: spacing[3] },
  placeholderText: { flex: 1, gap: spacing[2] },
  footer: { paddingTop: spacing[4] },
  loadingMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
});
