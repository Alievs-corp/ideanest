import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  NO_FILTER,
  REPORTED_STATES,
  SEGMENT_NAME_MAX,
  filterBody,
  isNarrowed,
  toggleState,
  type Backer,
  type BackerExport,
  type BackerFilter,
  type BackerPage,
  type BackerSegment,
} from '@ideanest/dashboard/backers';
import { queryKeys } from '../../../api/queries';
import { CardEntry, useRowEntryGate } from '../../../components/campaign-column';
import {
  Body,
  Caption,
  Chip,
  ChipRow,
  ContentSheet,
  EmptyState,
  Field,
  Heading,
  IconButton,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  Subheading,
  SurfaceProvider,
  TONES,
  TextInput,
  announce,
  haptics,
  useAssistiveTechnology,
} from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { useOnline } from '../../../lib/connectivity';
import { signInHrefFor } from '../../../lib/guard';
import { formatCount, pluralCategory, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { useSession } from '../../../lib/use-session';
import { colors, spacing } from '../../../theme';
import {
  backerFailure,
  deleteSegment,
  exportBackers,
  listBackers,
  listSegments,
  saveFailure,
  saveSegment,
} from './api';
import { BackerCard } from './backer-card';
import { BackerShareError, shareBackerExport, sweepBackerExports } from './share-csv';

/** `Screen`'s side gutter; the list is its own scroller, so it pads its header and rows itself. */
const GUTTER = spacing[5];
const PLACEHOLDER_CARDS = [0, 1, 2] as const;

/** The write in flight, so its own button shows the spinner and every write waits for it. */
type Work = 'export' | 'save' | 'delete';

type Cursor = string | undefined;
type Pages = InfiniteData<BackerPage, Cursor>;

/** Which list a filter or a segment names: one cache entry each. */
function scopeOf(filter: BackerFilter, segmentId: string | undefined): string {
  return segmentId !== undefined ? `segment:${segmentId}` : `filter:${JSON.stringify(filterBody(filter))}`;
}

function rowKey(backer: Backer): string {
  return backer.pledgeId;
}

/**
 * `campaigns/[id]/dashboard/backers` — the web's `BackerReport` (#163, §4.7's CD-10 and CD-11).
 *
 * <h2>The filter is state, the segment is an identifier</h2>
 *
 * Choosing a chip or searching clears the segment, and choosing a segment clears the chips and
 * the search: the two are alternatives, and only one of them is ever run. A segment is sent as
 * `?segment=` for the service to resolve, so one edited elsewhere is read as it is now.
 *
 * <h2>A card list, paged</h2>
 *
 * The web's 720px table is a card per backer here, in the white sheet, and the web's "showing
 * the most recent N" becomes cursor paging at the end of the list. The sentence comes back only
 * when the next page cannot be asked for — offline. With a screen reader on, the next page is a
 * "Show more" button rather than a scroll position.
 *
 * <h2>Nothing of it is written to the phone</h2>
 *
 * The list is a campaign's mailing list, so its query root is one `lib/offline.ts` does not
 * persist: offline, the first page read this session is what shows, and the export and the
 * segment writes are disabled. The exported file lives only as long as the share sheet needs it
 * (`share-csv.ts`).
 */
export function BackerReport({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.dashboardBackers.signedOutTitle')}
            description={t('mobile.dashboardBackers.signedOutBody')}
            action={
              <Pill
                label={t('shell.actions.signIn')}
                onPress={() => router.push(signInHrefFor(`/campaigns/${projectId}/dashboard/backers`))}
              />
            }
          />
        }
      />
    );
  }
  return <Report projectId={projectId} />;
}

function Report({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const assisted = useAssistiveTechnology();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<BackerFilter>(NO_FILTER);
  const [term, setTerm] = useState('');
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const [segmentName, setSegmentName] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState<Work | null>(null);
  // Taken synchronously by the first press: a second tap in the same frame still sees `working` as null.
  const latch = useRef(false);
  const [pending, setPending] = useState<BackerExport | null>(null);
  const [pulling, setPulling] = useState(false);

  const key = queryKeys.dashboardBackers(projectId, scopeOf(filter, segmentId));
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as Cursor,
    queryFn: ({ pageParam, signal }) =>
      listBackers(
        projectId,
        segmentId !== undefined ? { segmentId, cursor: pageParam } : { filter, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (page: BackerPage) => page.nextCursor,
  });
  const segments = useQuery({
    queryKey: queryKeys.dashboardSegments(projectId),
    queryFn: ({ signal }) => listSegments(projectId, signal),
  });

  // A copy an Android share sheet left behind is not kept past the panel's next visit.
  useEffect(() => sweepBackerExports(), []);

  useEffect(() => {
    if (notice !== '' && Platform.OS === 'ios') announce(notice);
  }, [notice]);

  const pages = list.data?.pages;
  const rows = (pages ?? []).flatMap((page) => page.backers);
  const matched = pages?.[0]?.matched;
  const gate = useRowEntryGate(rows, rowKey);
  const narrowed = isNarrowed(filter) || segmentId !== undefined;
  const busy = working !== null;
  const writable = online && !busy;

  /** Starts one write, or answers false while another is out. */
  function begin(work: Work): boolean {
    if (latch.current || !online) return false;
    latch.current = true;
    setWorking(work);
    setNotice('');
    return true;
  }

  function finish() {
    latch.current = false;
    setWorking(null);
  }

  const applyFilter = (next: BackerFilter) => {
    setSegmentId(undefined);
    setFilter(next);
  };

  const chooseSegment = (segment: BackerSegment) => {
    setFilter(NO_FILTER);
    setTerm('');
    setSegmentId(segmentId === segment.id ? undefined : segment.id);
  };

  const search = () => applyFilter({ ...filter, term });

  async function onSave() {
    if (segmentName.trim() === '' || !begin('save')) return;
    try {
      const saved = await saveSegment(projectId, segmentName, filter);
      queryClient.setQueryData<readonly BackerSegment[]>(queryKeys.dashboardSegments(projectId), (now) => [
        saved,
        ...(now ?? []),
      ]);
      setSegmentName('');
      setNotice(t('dashboard.backers.saved', { name: saved.name }));
    } catch (cause) {
      setNotice(saveFailure(cause, t));
    } finally {
      finish();
    }
  }

  async function onDelete(segment: BackerSegment) {
    if (!begin('delete')) return;
    try {
      await deleteSegment(projectId, segment.id);
      queryClient.setQueryData<readonly BackerSegment[]>(queryKeys.dashboardSegments(projectId), (now) =>
        (now ?? []).filter((each) => each.id !== segment.id),
      );
      if (segmentId === segment.id) setSegmentId(undefined);
      setNotice(t('dashboard.backers.deleted', { name: segment.name }));
    } catch {
      setNotice(t('dashboard.backers.deleteFailed'));
    } finally {
      finish();
    }
  }

  async function share(file: BackerExport) {
    try {
      await shareBackerExport(file);
      setNotice(
        file.truncated
          ? t('dashboard.backers.exportedTruncated', { count: formatCount(file.rows, locale) })
          : t(`dashboard.backers.exported.${pluralCategory(locale, file.rows)}`, {
              count: formatCount(file.rows, locale),
            }),
      );
    } catch (cause) {
      setNotice(cause instanceof BackerShareError ? t('mobile.dashboardBackers.shareFailed') : backerFailure(cause, t));
    } finally {
      finish();
    }
  }

  async function onExport() {
    if (!begin('export')) return;
    try {
      const file = await exportBackers(projectId, segmentId !== undefined ? { segmentId } : { filter });
      if (file.truncated) {
        // Warned before the sheet opens: a creator about to mail everyone must know the file is short.
        setPending(file);
        return;
      }
      await share(file);
    } catch (cause) {
      setNotice(backerFailure(cause, t));
      finish();
    }
  }

  const loadMore = useCallback(() => {
    if (!online || !list.hasNextPage || list.isFetching || list.isFetchNextPageError) return;
    void list.fetchNextPage({ cancelRefetch: false });
  }, [online, list]);

  async function refresh() {
    setPulling(true);
    // The top of the list again, rather than every page read: a pull asks for what is new.
    queryClient.setQueryData<Pages>(key, (now) =>
      now === undefined ? now : { pages: now.pages.slice(0, 1), pageParams: now.pageParams.slice(0, 1) },
    );
    await Promise.all([list.refetch(), segments.refetch()]);
    setPulling(false);
  }

  const renderRow = useCallback(
    ({ item, index }: { item: Backer; index: number }) => (
      <View style={styles.band}>
        <SurfaceProvider surface="white">
          <CardEntry gate={gate} entryKey={rowKey(item)} index={index}>
            <BackerCard backer={item} />
          </CardEntry>
        </SurfaceProvider>
      </View>
    ),
    [gate],
  );

  const failure = list.error;
  const header = (
    <View>
      <View style={styles.header}>
        <Heading accessibilityRole="header">{t('dashboard.backers.heading')}</Heading>
        <Body>{t('dashboard.backers.intro')}</Body>
        {online ? null : (
          <InlineAlert
            variant="warning"
            politeness="polite"
            description={t('mobile.dashboardBackers.offline')}
            testID="backers-offline"
          />
        )}
      </View>
      <ContentSheet style={styles.sheetTop}>
        <Field label={t('dashboard.backers.searchLabel')} hint={t('dashboard.backers.searchHint')}>
          <TextInput
            value={term}
            onChangeText={setTerm}
            returnKeyType="search"
            onSubmitEditing={search}
            autoCapitalize="none"
            autoCorrect={false}
            testID="backers-search"
          />
        </Field>
        <View style={styles.actions}>
          <Pill
            variant="outline"
            iconLeft={Glyphs.SearchNormal1}
            label={t('dashboard.backers.search')}
            onPress={search}
            testID="backers-search-submit"
          />
          <Pill
            variant="outline"
            iconLeft={Glyphs.Import}
            label={t('dashboard.backers.export')}
            onPress={() => void onExport()}
            disabled={!writable}
            busy={working === 'export' && pending === null}
            testID="backers-export"
          />
        </View>

        {pending === null ? null : (
          <InlineAlert
            variant="warning"
            title={t('mobile.dashboardBackers.truncatedTitle')}
            description={t('dashboard.backers.exportedTruncated', { count: formatCount(pending.rows, locale) })}
            action={
              <View style={styles.actions}>
                <Pill
                  label={t('mobile.dashboardBackers.shareAnyway')}
                  onPress={() => {
                    const file = pending;
                    setPending(null);
                    void share(file);
                  }}
                  testID="backers-share-truncated"
                />
                <Pill
                  variant="ghost"
                  label={t('common.cancel')}
                  onPress={() => {
                    setPending(null);
                    finish();
                  }}
                  testID="backers-share-cancel"
                />
              </View>
            }
            testID="backers-truncated"
          />
        )}

        <View style={styles.group}>
          <Subheading accessibilityRole="header">{t('dashboard.backers.stateLegend')}</Subheading>
          <ChipRow testID="backers-states">
            {REPORTED_STATES.map((state) => (
              <Chip
                key={state}
                label={t(`dashboard.states.${state}`)}
                icon={state === 'CHARGE_FAILED' ? Glyphs.Danger : undefined}
                selected={filter.states.includes(state)}
                onPress={() => applyFilter(toggleState(filter, state))}
                testID={`backers-state-${state}`}
              />
            ))}
          </ChipRow>
        </View>

        {(segments.data ?? []).length > 0 ? (
          <View style={styles.group}>
            <Subheading accessibilityRole="header">{t('dashboard.backers.segmentsLegend')}</Subheading>
            <ChipRow testID="backers-segments">
              {(segments.data ?? []).map((segment) => (
                <View key={segment.id} style={styles.segment}>
                  <Chip
                    label={segment.name}
                    selected={segmentId === segment.id}
                    onPress={() => chooseSegment(segment)}
                    testID={`backers-segment-${segment.id}`}
                  />
                  <IconButton
                    icon={Glyphs.Close}
                    size="sm"
                    variant="ghost"
                    label={t('dashboard.backers.deleteSegment', { name: segment.name })}
                    onPress={() => void onDelete(segment)}
                    disabled={!writable}
                    testID={`backers-segment-delete-${segment.id}`}
                  />
                </View>
              ))}
            </ChipRow>
          </View>
        ) : null}

        {isNarrowed(filter) ? (
          <View style={styles.group}>
            <Field label={t('dashboard.backers.saveLabel')} hint={t('dashboard.backers.saveHint')}>
              <TextInput
                value={segmentName}
                onChangeText={setSegmentName}
                placeholder={t('dashboard.backers.savePlaceholder')}
                maxLength={SEGMENT_NAME_MAX}
                returnKeyType="done"
                onSubmitEditing={() => void onSave()}
                testID="backers-segment-name"
              />
            </Field>
            <View style={styles.actions}>
              <Pill
                variant="accent"
                label={t('dashboard.backers.saveSegment')}
                onPress={() => void onSave()}
                disabled={!writable || segmentName.trim() === ''}
                busy={working === 'save'}
                testID="backers-segment-save"
              />
            </View>
          </View>
        ) : null}

        <Caption accessibilityLiveRegion="polite" testID="backers-notice">
          {notice}
        </Caption>

        {pages === undefined ? (
          list.isError || (!online && !list.isFetching) ? (
            <InlineAlert
              variant="danger"
              title={t('mobile.dashboardBackers.failedTitle')}
              description={online ? backerFailure(failure, t) : t('mobile.offline.nothingCached')}
              action={
                <Pill
                  size="sm"
                  variant="ghost"
                  label={t('common.tryAgain')}
                  busy={list.isFetching}
                  onPress={() => void list.refetch()}
                />
              }
              testID="backers-failed"
            />
          ) : (
            <SkeletonGroup label={t('dashboard.backers.loading')} testID="backers-loading">
              <View style={styles.placeholders}>
                {PLACEHOLDER_CARDS.map((card) => (
                  <View key={card} style={styles.placeholder}>
                    <View style={styles.placeholderText}>
                      <Skeleton height={18} width="60%" />
                      <Skeleton height={14} width="75%" />
                      <Skeleton height={12} width="90%" />
                    </View>
                    <Skeleton height={18} width={72} />
                  </View>
                ))}
              </View>
            </SkeletonGroup>
          )
        ) : (
          <>
            {list.isRefetchError && online ? (
              <InlineAlert
                variant="danger"
                description={backerFailure(failure, t)}
                action={
                  <Pill
                    size="sm"
                    variant="ghost"
                    label={t('common.tryAgain')}
                    busy={list.isFetching}
                    onPress={() => void list.refetch()}
                  />
                }
                testID="backers-refresh-failed"
              />
            ) : null}
            <Body style={styles.figures} testID="backers-matched">
              {t(`dashboard.backers.matched.${pluralCategory(locale, matched ?? 0)}`, {
                count: formatCount(matched ?? 0, locale),
              })}
            </Body>
            {rows.length === 0 ? (
              <Body testID="backers-empty">
                {narrowed ? t('dashboard.backers.emptyFiltered') : t('dashboard.backers.emptyNone')}
              </Body>
            ) : null}
          </>
        )}
      </ContentSheet>
    </View>
  );

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.backdrop} />
      <FlashList
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        ItemSeparatorComponent={Separator}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        testID="backers-list"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => {
              haptics.refresh();
              void refresh();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        }
        ListHeaderComponent={header}
        ListFooterComponent={
          <View style={[styles.band, styles.footer]}>
            <SurfaceProvider surface="white">
              {list.isFetchNextPageError ? (
                <InlineAlert
                  variant="danger"
                  politeness="polite"
                  title={t('common.list.nextPageFailed')}
                  action={
                    <Pill
                      size="sm"
                      variant="ghost"
                      label={t('common.tryAgain')}
                      busy={list.isFetchingNextPage}
                      onPress={() => void list.fetchNextPage()}
                      testID="backers-next-retry"
                    />
                  }
                  testID="backers-next-failed"
                />
              ) : list.isFetchingNextPage ? (
                <View
                  style={styles.loadingMore}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('common.list.loadingMore')}
                  testID="backers-loading-more"
                >
                  <ActivityIndicator color={TONES.white.secondary} />
                  <Meta>{t('common.list.loadingMore')}</Meta>
                </View>
              ) : list.hasNextPage && !online ? (
                <Meta testID="backers-more">
                  {t('dashboard.backers.more', { count: formatCount(rows.length, locale) })}
                </Meta>
              ) : list.hasNextPage && assisted ? (
                <Pill
                  variant="outline"
                  label={t('common.list.showMore')}
                  onPress={loadMore}
                  testID="backers-show-more"
                />
              ) : null}
            </SurfaceProvider>
          </View>
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={[styles.band, styles.separator]} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface1 },
  // The white sheet's run-out under a short list; the header covers its top, the rows the rest.
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
    backgroundColor: colors.whiteSurface,
  },
  header: { gap: spacing[3], backgroundColor: colors.surface1, paddingHorizontal: GUTTER, paddingTop: spacing[4], paddingBottom: spacing[6] },
  // The sheet's top, holding the controls; the rows continue it as white bands.
  sheetTop: { flexGrow: 0, marginHorizontal: 0, marginBottom: 0, paddingBottom: spacing[4] },
  band: { backgroundColor: colors.whiteSurface, paddingHorizontal: GUTTER },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  group: { gap: spacing[3] },
  segment: { flexDirection: 'row', alignItems: 'center' },
  figures: { fontVariant: ['tabular-nums'] },
  placeholders: { gap: spacing[3] },
  placeholder: { flexDirection: 'row', gap: spacing[3] },
  placeholderText: { flex: 1, gap: spacing[2] },
  separator: { height: spacing[3] },
  footer: { paddingTop: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  loadingMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
});
