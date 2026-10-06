import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardEntry, type EntryGate } from '../../components/campaign-column';
import { FIRST_SCREENFUL } from '../../components/motion';
import {
  Card,
  EmptyState,
  InlineAlert,
  Meta,
  Pill,
  PressableScale,
  Screen,
  Skeleton,
  SkeletonGroup,
  TONES,
  haptics,
  useAssistiveTechnology,
  useSurface,
  type IconComponent,
} from '../../components/ui';
import { BLOCK, blockSurface } from '../../components/ui/surface';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { colors, radius, size, spacing } from '../../theme';
import { ScreenHeader } from './screen-header';
import type { CursorList } from './use-cursor-list';

/**
 * One account list screen — My campaigns, Saved and Following (#159) share every state but their
 * rows: signed out, the first load (skeleton rows under the header), a failed first load with
 * retry, the empty state, and the list itself with its header, notices, pull to refresh and paging.
 *
 * <h2>Paging</h2>
 *
 * The end of the list loads the next cursor (`onEndReached`) with a labelled spinner below. Auto
 * loading on scroll is hard to find with VoiceOver or TalkBack, so with a screen reader on the
 * footer is the web's visible "Show more" instead. A next page that fails keeps the rows read and
 * says so under them, with its own retry.
 *
 * <h2>Motion</h2>
 *
 * The `mobile-design` skill §6.5: the first screenful of the first page rises in once, and rows
 * that arrive later (a page appended, a refresh, a recycled cell) never move. Reduce Motion stops
 * the rise (`FadeUp`); rows give under the thumb (`PressableScale`).
 */

export interface AccountListEmpty {
  readonly icon: IconComponent;
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

export interface AccountListProps<T> {
  readonly list: CursorList<T>;
  readonly signedIn: boolean;
  /** This screen's route, where sign-in comes back to. */
  readonly path: string;
  readonly title: string;
  readonly intro: string;
  readonly signedOutTitle: string;
  readonly signedOutBody: string;
  /** The skeleton's accessible name. */
  readonly loadingLabel: string;
  readonly failedTitle: string;
  readonly staleNotice: string;
  readonly empty: AccountListEmpty;
  /** Alerts under the header: a removal that failed, a change that needs a connection. */
  readonly notices?: ReactNode;
  /** One skeleton row, drawn three times while the first page loads. */
  readonly placeholder: ReactNode;
  readonly keyOf: (item: T) => string;
  readonly renderRow: (item: T) => ReactNode;
  readonly testID: string;
}

const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/** The first screenful of the first page the list is given may rise, each row once. */
function useRowEntryGate<T>(items: readonly T[], keyOf: (item: T) => string): EntryGate {
  const first = useRef<ReadonlySet<string> | null>(null);
  if (first.current === null && items.length > 0) {
    first.current = new Set(items.slice(0, FIRST_SCREENFUL).map(keyOf));
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

export function AccountList<T>(props: AccountListProps<T>) {
  const { list, signedIn, keyOf, renderRow, testID } = props;
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const assisted = useAssistiveTechnology();
  const gate = useRowEntryGate(list.items, keyOf);

  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => (
      <CardEntry gate={gate} entryKey={keyOf(item)} index={index}>
        {renderRow(item)}
      </CardEntry>
    ),
    [gate, keyOf, renderRow],
  );

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={props.signedOutTitle}
            description={props.signedOutBody}
            action={
              <Pill
                label={t('shell.actions.signIn')}
                onPress={() => router.push(signInHrefFor(props.path))}
              />
            }
          />
        }
      />
    );
  }

  const header = <ScreenHeader title={props.title} intro={props.intro} />;

  if (list.items.length === 0) {
    return (
      <Screen
        hasContent={list.loading}
        onRefresh={() => void list.refresh()}
        refreshing={list.refreshing}
        testID={testID}
        error={
          list.failed
            ? {
                title: props.failedTitle,
                description: t('mobile.offline.nothingCached'),
                onRetry: list.retry,
                retrying: list.retrying,
              }
            : null
        }
        empty={
          <View style={styles.emptyWrap}>
            {header}
            {props.notices}
            <EmptyState
              icon={props.empty.icon}
              title={props.empty.title}
              description={props.empty.body}
              action={<Pill label={props.empty.actionLabel} onPress={props.empty.onAction} />}
            />
          </View>
        }
      >
        {header}
        <SkeletonGroup label={props.loadingLabel}>
          <View style={styles.placeholders}>
            {PLACEHOLDER_ROWS.map((row) => (
              <View key={row}>{props.placeholder}</View>
            ))}
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  return (
    <View style={styles.page}>
      <FlashList
        data={list.items}
        keyExtractor={keyOf}
        testID={testID}
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        }}
        ItemSeparatorComponent={Separator}
        onEndReached={() => list.loadMore()}
        onEndReachedThreshold={0.5}
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
          <View style={styles.listHeader}>
            {header}
            {list.stale ? (
              // Polite: the offline banner has already said it once.
              <InlineAlert variant="warning" politeness="polite" description={props.staleNotice} />
            ) : null}
            {props.notices}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {list.moreFailed ? (
              <InlineAlert
                variant="danger"
                politeness="polite"
                title={t('common.list.nextPageFailed')}
                action={
                  <Pill
                    size="sm"
                    variant="ghost"
                    label={t('common.tryAgain')}
                    busy={list.fetchingMore}
                    onPress={() => list.loadMore({ retry: true })}
                    testID={`${testID}-next-retry`}
                  />
                }
              />
            ) : list.fetchingMore ? (
              <View
                style={styles.loadingMore}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={t('common.list.loadingMore')}
                testID={`${testID}-loading-more`}
              >
                <ActivityIndicator color={TONES.dark.secondary} />
                <Meta tone="secondary">{t('common.list.loadingMore')}</Meta>
              </View>
            ) : assisted && list.hasMore ? (
              <Pill
                variant="outline"
                label={t('common.list.showMore')}
                onPress={() => list.loadMore()}
                testID={`${testID}-show-more`}
              />
            ) : null}
          </View>
        }
        renderItem={renderItem}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/**
 * A list row: a raised block (`surface2` on the canvas) whose main part opens the row's page and
 * gives under the thumb, and an optional trailing control beside it. The control is a sibling of
 * the link rather than inside it, so a screen reader reaches each on its own.
 */
export function AccountRow({
  label,
  onPress,
  trailing,
  children,
  testID,
}: {
  /** The link's accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const block = blockSurface(useSurface());
  return (
    <View style={[styles.row, { backgroundColor: BLOCK[block].rest }]} testID={testID}>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.rowMain}
        contentStyle={({ pressed }) => [
          styles.rowLink,
          pressed && { backgroundColor: BLOCK[block].pressed },
        ]}
      >
        {children}
      </PressableScale>
      {trailing === undefined ? null : <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

/** A row's shape while the first page loads: a title and the line under it. */
export function RowPlaceholder({ lead = false }: { readonly lead?: boolean }) {
  return (
    <Card size="sm">
      <View style={styles.placeholder}>
        {lead ? <Skeleton circle height={size.avatarInCard} /> : null}
        <View style={styles.placeholderText}>
          <Skeleton height={18} width="70%" />
          <Skeleton height={12} width="45%" />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  placeholder: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  placeholderText: { flex: 1, gap: spacing[2] },
  page: { flex: 1, backgroundColor: colors.surface1 },
  listHeader: { gap: spacing[4], paddingBottom: spacing[6] },
  // Fills the centred slot, so the page header stays at the top as on the populated list.
  emptyWrap: { flexGrow: 1, gap: spacing[6] },
  placeholders: { gap: spacing[3] },
  separator: { height: spacing[3] },
  footer: { paddingTop: spacing[4], alignItems: 'stretch' },
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: size.touchTarget,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  rowMain: { flex: 1 },
  rowLink: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    gap: spacing[1],
    padding: spacing[4],
  },
  trailing: { paddingRight: spacing[3] },
});
