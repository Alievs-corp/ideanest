import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@ideanest/api-client';
import { formatMoney } from '@ideanest/money';
import { acceptsPledges } from '@ideanest/campaign/pledgeable';
import { counterChannel, realtimeUrl } from '@ideanest/campaign/realtime';
import {
  CAMPAIGN_TAB_PARAM,
  CAMPAIGN_THREAD_PARAM,
  DEFAULT_CAMPAIGN_TAB,
  campaignTabFrom,
  type CampaignTabId,
} from '@ideanest/campaign/tabs';
import { realtimeOrigin, siteUrl } from '../../api/config';
import { useProjectPage, useProjectRewards, useUpdateObligation } from '../../api/queries';
import { useAppActive } from '../../lib/app-active';
import { useCampaignClock } from '../../lib/campaign-clock';
import { readCampaignPage, tiersOf, type CampaignPage } from '../../lib/campaign-page';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { shareUrlFor } from '../../lib/links';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import { FadeUp } from '../motion';
import { NotFoundState } from '../not-found-state';
import {
  AccentScopeProvider,
  InlineAlert,
  Screen,
  Skeleton,
  SkeletonGroup,
  SurfaceProvider,
  TONES,
  haptics,
  useSharedArrival,
} from '../ui';
import { BackCampaignCta, PersistentBackBar, persistentBarClearance } from './back-campaign-cta';
import { CampaignActions } from './campaign-actions';
import { CampaignCountdown } from './campaign-countdown';
import { CampaignHeader, showsDaysLeft } from './campaign-header';
import { CampaignMedia, coverTag } from './campaign-media';
import { CampaignRewards } from './campaign-rewards';
import { CampaignSkeleton } from './campaign-skeleton';
import { CampaignTabs } from './campaign-tabs';
import { CampaignTrustBlock } from './campaign-trust-block';
import { LiveFunding } from './live-funding';
import { ReportLink } from './report-link';
import { UpdateObligationNotice } from './update-obligation-notice';
import { useCampaignTab } from './tabs/campaign-tab';
import { useCommentsTab } from './tabs/comments-tab';
import type { CampaignTabBody, CampaignTabContext, CampaignTabRow } from './tabs/contract';
import { useCreatorTab } from './tabs/creator-tab';
import { useFaqTab } from './tabs/faq-tab';
import { useUpdatesTab } from './tabs/updates-tab';

/**
 * The campaign page — web `/projects/{creatorSlug}/{projectSlug}`, app
 * `projects/[creatorSlug]/[projectSlug]` (#155).
 *
 * <h2>One list</h2>
 *
 * The page is one virtualised `FlatList`, in the web's phone order:
 *
 * 1–10. **The list header**: the cover, the tags, the title and blurb, the byline, the funding,
 *    the countdown, Back this campaign, Save / Share / Remind on the dark canvas; then the top of
 *    the white content sheet, with the trust block and the update obligation.
 * 11. **The tab bar**, the list's first row and its sticky header, so it holds at the top once it
 *    reaches it. Native stickiness (`stickyHeaderIndices`) rather than FlashList's, because
 *    FlashList draws a sticky row as a second copy over the first, and a screen reader could meet
 *    the tab bar twice.
 * 12. **The active tab's rows** — the body. Each tab is a hook (`tabs/contract.ts`) that hands
 *    the list rows, a footer and an end-reached handler, because Updates and Comments append
 *    pages into this same list rather than scrolling one of their own.
 * 13–14. **The footer**: the rewards, under the content of every tab as the web lays them out on
 *    a phone, and the report link.
 *
 * Switching tabs does not remount the header, so the live counter keeps its socket.
 *
 * <h2>Canvas and sheet</h2>
 *
 * `mobile-design` skill §2: the campaign's face — the cover, the title, the hero figure (what has
 * been pledged, `LiveFunding`) and Back — sits on the dark canvas; everything that is read or
 * chosen from — the notices, the tabs, their rows, the rewards and the report link — sits in one
 * white content sheet (`radius.xl` top corners, a grabber) that starts at the end of the header
 * and runs to the bottom edge. The kit's `ContentSheet` cannot hold a list's rows, so the sheet is
 * drawn here in pieces — the header's last block, the sticky tab row, each row, the footer — all
 * under `SurfaceProvider surface="white"`, which is how the rows' tones follow it.
 *
 * <h2>States</h2>
 *
 * A 404, a response the page cannot draw, or a state outside `RENDERABLE_STATES` is the not-found
 * screen, distinct from a network failure with nothing cached, which is an error with a retry. A
 * cached page whose refetch failed is drawn with the offline notice; offline there is no socket,
 * and Save and Remind are disabled and say why.
 *
 * <h2>Motion</h2>
 *
 * The first screenful rises (`FadeUp`, staggered): the cover, the header, the funding, the
 * countdown, Back and the actions. The sheet does not — it is the list's own body, and a sheet
 * whose top rose while its rows stood still would come apart. The hero figure counts up on first
 * view and rolls on each live frame; the kit's press feedback and the progress bar's fill do the
 * rest. The persistent Back pill appears and goes without a transition. The card → page shared
 * transition is #279's.
 */
export interface CampaignScreenProps {
  readonly creatorSlug: string;
  readonly projectSlug: string;
  /**
   * The instant the page's clock starts at — a test's way to ask what the page says on a campaign's
   * last day. The clock moves on from the device's time either way (`lib/campaign-clock.ts`); the
   * route never passes it.
   */
  readonly now?: Date;
}

export function CampaignScreen({ creatorSlug, projectSlug, now }: CampaignScreenProps) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const query = useProjectPage(creatorSlug, projectSlug);
  /*
   * The page's clock: moved on at the deadline and at each day boundary before it while the
   * campaign is LIVE, so days left, the chip and every Back control follow the time rather than
   * the moment the screen opened.
   */
  const clock = useCampaignClock(query.data?.deadline, query.data?.state === 'LIVE', now);
  const campaign = useMemo(
    () => readCampaignPage(query.data, creatorSlug, clock),
    [query.data, creatorSlug, clock],
  );

  const missing = query.error instanceof ApiError && query.error.status === 404;
  if (missing || (query.data !== undefined && campaign === null)) {
    return (
      <NotFoundState
        action={{
          label: t('shell.failure.links.browse'),
          onPress: () => router.replace('/discover'),
        }}
        testID="campaign-not-found"
      />
    );
  }

  if (campaign === null) {
    // Nothing cached and nothing yet: the page's shape while the first answer is on its way, and
    // otherwise the failure with a retry — never the not-found screen, which is a different fact.
    return (
      <Screen
        hasContent={!query.isError}
        error={
          query.isError
            ? {
                title: t('mobile.campaign.failedTitle'),
                description: t('mobile.campaign.failedDetail'),
                onRetry: () => void query.refetch(),
                retrying: query.isFetching,
              }
            : null
        }
        testID={query.isError ? 'campaign-error' : undefined}
      >
        <Stack.Screen options={{ title: '', headerBackTitle: t('mobile.nav.back') }} />
        <CampaignSkeleton coverTag={coverTag(creatorSlug, projectSlug)} />
      </Screen>
    );
  }

  /*
   * Offline, or the service could not be reached: the cached page, said to be old, with no socket
   * and no writes. A refusal with a status (a 500) still leaves the page readable and old.
   */
  const unreachable = query.isError && !(query.error instanceof ApiError);
  const offline = !online || unreachable;

  /*
   * Keyed by the campaign, so a screen instance reused for another campaign (a link from one
   * campaign's page to another's) starts again: its tab, its Save state, its realtime frames and
   * its Back bar measurements are the last campaign's otherwise.
   */
  return (
    <CampaignView
      key={campaign.id}
      campaign={campaign}
      offline={offline}
      stale={offline || query.isError}
      now={clock}
      refetchPage={() => query.refetch()}
    />
  );
}

interface CampaignViewProps {
  readonly campaign: CampaignPage;
  readonly offline: boolean;
  /** The figures are the cached ones: say so above the page. */
  readonly stale: boolean;
  /** The page's clock (`lib/campaign-clock.ts`). */
  readonly now: Date;
  readonly refetchPage: () => Promise<unknown>;
}

/** The space between the screen's edges and its content — the kit's `Screen` gutter. */
const GUTTER = spacing[5];

/** How far the sheet runs on past the list's end: more than any overscroll or bottom inset. */
const SHEET_RUNOUT = 1000;

/** A row of the list: the tab bar, or one of the active tab's rows. */
interface ListRow {
  readonly key: string;
  readonly render: () => ReactElement;
}

function CampaignView({ campaign, offline, stale, now, refetchPage }: CampaignViewProps) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<Record<string, string | string[]>>();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const active = focused && appActive;

  const tag = coverTag(campaign.creatorSlug, campaign.slug);
  const arriving = useSharedArrival(tag);
  const rewards = useProjectRewards(campaign.id);
  const obligation = useUpdateObligation(campaign.id);
  const tiers = useMemo(() => tiersOf(rewards.data), [rewards.data]);
  const pledgeable = acceptsPledges(campaign.state, campaign.deadline, now);

  /* ---- Tabs: local state, mirrored to `?tab=` ------------------------------------------ */

  const params = useMemo(() => flatten(rawParams), [rawParams]);
  const tabParam = params[CAMPAIGN_TAB_PARAM];
  const [tab, setTab] = useState<CampaignTabId>(() => campaignTabFrom(tabParam));
  // A deep link that arrives while the screen is open (`?tab=comments` from a notification).
  useEffect(() => setTab(campaignTabFrom(tabParam)), [tabParam]);

  const list = useRef<FlatList<ListRow>>(null);
  const offset = useRef(0);
  const headerHeight = useRef(0);

  /** Brings the tab bar back to the top when the reader is below it; above it, nothing moves. */
  const scrollToTabs = useCallback(() => {
    if (offset.current > headerHeight.current) {
      list.current?.scrollToOffset({ offset: headerHeight.current, animated: false });
    }
  }, []);

  const setParam = useCallback(
    (name: string, value: string | null) => router.setParams({ [name]: value ?? undefined }),
    [router],
  );

  const selectTab = (next: CampaignTabId) => {
    if (next === tab) return;
    setTab(next);
    // `campaign` is the default and is left out of the address; a thread belongs to Comments.
    router.setParams({
      [CAMPAIGN_TAB_PARAM]: next === DEFAULT_CAMPAIGN_TAB ? undefined : next,
      [CAMPAIGN_THREAD_PARAM]: undefined,
    });
    scrollToTabs();
  };

  const contextFor = (id: CampaignTabId): CampaignTabContext => ({
    campaign,
    active: tab === id,
    offline,
    params,
    setParam,
    scrollToTabs,
  });
  // Every tab's hook, every render — the rules of hooks; each reads only while it is `active`.
  const bodies: Record<CampaignTabId, CampaignTabBody> = {
    campaign: useCampaignTab(contextFor('campaign')),
    creator: useCreatorTab(contextFor('creator')),
    faq: useFaqTab(contextFor('faq')),
    updates: useUpdatesTab(contextFor('updates')),
    comments: useCommentsTab(contextFor('comments')),
  };
  const body = bodies[tab];

  /* ---- The persistent Back bar -------------------------------------------------------- */

  const pill = useRef<{ y: number; height: number } | null>(null);
  const viewport = useRef(0);
  const [barShown, setBarShown] = useState(false);

  /** Shown exactly while the header's pill is wholly out of view and pledges are taken. */
  const placeBar = useCallback(() => {
    const at = pill.current;
    if (!pledgeable || at === null || viewport.current === 0) {
      setBarShown(false);
      return;
    }
    const top = at.y - offset.current;
    const visible = top + at.height > 0 && top < viewport.current;
    setBarShown(!visible);
  }, [pledgeable]);

  useEffect(placeBar, [placeBar]);

  /* ---- The next page: measured against the end of the body, not of the list ---------------- */

  /*
   * FlatList's own `onEndReached` measures to the end of the list, which here is the rewards and
   * the report link: Updates and Comments would ask for their next page only once the reader had
   * scrolled through every reward, and the page would then arrive above them, pushing what they
   * were reading down. So the screen asks the active tab itself, when the bottom of the viewport
   * comes within half a screen of the end of the tab's rows — the list's height less the footer's.
   * Once per list height per tab: a new page grows the list, which is what re-arms it.
   *
   * `maintainVisibleContentPosition` is not used. With this trigger a page is appended while the
   * reader is still in the body, so nothing above the viewport moves; and the property anchors on
   * whatever child is first on screen — the sticky tab bar among them — which would also act on
   * every tab switch, in ways no test here can see.
   */
  const contentHeight = useRef(0);
  const footerHeight = useRef(0);
  const askedAt = useRef<string | null>(null);
  const endReached = useRef(body.onEndReached);
  endReached.current = body.rows.length === 0 ? null : body.onEndReached;

  const askForMore = () => {
    const ask = endReached.current;
    if (ask === null || viewport.current === 0 || contentHeight.current === 0) return;
    const bodyEnd = contentHeight.current - footerHeight.current;
    if (offset.current + viewport.current < bodyEnd - viewport.current / 2) return;
    const at = `${tab}:${bodyEnd}`;
    if (askedAt.current === at) return;
    askedAt.current = at;
    ask();
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    placeBar();
    askForMore();
  };

  /* ---- Pull to refresh ---------------------------------------------------------------- */

  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    haptics.refresh();
    setRefreshing(true);
    void Promise.allSettled([
      refetchPage(),
      rewards.refetch(),
      obligation.refetch(),
      body.refresh(),
    ]).finally(() => setRefreshing(false));
  };

  /* ---- The list ----------------------------------------------------------------------- */

  const socketUrl = offline ? null : realtimeUrl(realtimeOrigin(), counterChannel(campaign.id));

  const rows: ListRow[] = [
    {
      key: 'tabs',
      render: () => (
        <SurfaceProvider surface="white">
          <CampaignTabs active={tab} onSelect={selectTab} />
        </SurfaceProvider>
      ),
    },
    ...body.rows.map((row: CampaignTabRow) => ({
      key: `${tab}:${row.key}`,
      render: () => <SheetRow>{row.render()}</SheetRow>,
    })),
  ];
  if (body.loading && body.rows.length === 0) {
    rows.push({ key: `${tab}:loading`, render: () => <TabPlaceholder /> });
  }

  const header = (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        headerHeight.current = event.nativeEvent.layout.height;
      }}
    >
      {/* The canvas: the campaign's face, its first screenful rising in (`FadeUp`, index < 8). */}
      <View style={styles.canvas}>
        {stale ? (
          <InlineAlert
            variant="warning"
            politeness="polite"
            description={t('mobile.campaign.stale')}
            testID="campaign-stale"
          />
        ) : null}

        {/*
          Arriving from a card, the cover is the shared element and lands where it is; a rise on top
          of the flight would be the same motion twice (`SharedTransition`).
        */}
        {arriving ? (
          <CampaignMedia cover={campaign.coverImage} tag={tag} />
        ) : (
          <FadeUp index={0}>
            <CampaignMedia cover={campaign.coverImage} tag={tag} />
          </FadeUp>
        )}
        <FadeUp index={1}>
          <CampaignHeader campaign={campaign} now={now} />
        </FadeUp>

        {campaign.goal === null ? null : (
          <FadeUp index={2}>
            <View style={styles.funding}>
              <LiveFunding
                goal={campaign.goal}
                pledged={campaign.pledged}
                backersCount={campaign.backersCount}
                socketUrl={socketUrl}
                active={active}
              />
              <Text style={styles.meta} testID="funding-of-goal">
                {t('common.card.ofGoal', { amount: formatMoney(campaign.goal) })}
                {showsDaysLeft(campaign, now) && campaign.daysLeft !== null
                  ? ` · ${t('campaign.daysLeft', { days: campaign.daysLeft })}`
                  : ''}
              </Text>
              <Text style={styles.meta}>{t('campaign.rule')}</Text>
            </View>
          </FadeUp>
        )}

        {campaign.deadline !== null && showsDaysLeft(campaign, now) ? (
          <FadeUp index={3}>
            <CampaignCountdown deadline={campaign.deadline} active={active} />
          </FadeUp>
        ) : null}

        {pledgeable ? (
          <BackCampaignCta
            projectId={campaign.id}
            title={campaign.title}
            entryIndex={4}
            onLayout={(event) => {
              // Measured outside its rise, so this is where the pill rests in the header.
              const { y, height } = event.nativeEvent.layout;
              pill.current = { y, height };
              placeBar();
            }}
          />
        ) : null}

        <FadeUp index={5}>
          <CampaignActions
            projectId={campaign.id}
            state={campaign.state}
            title={campaign.title}
            shareUrl={shareUrlFor(siteUrl(), campaign.creatorSlug, campaign.slug)}
            offline={offline}
          />
        </FadeUp>
      </View>

      {/* The top of the white sheet: its corners, its grabber, and the page's two notices. */}
      <SurfaceProvider surface="white">
        <View style={styles.sheetTop}>
          <View style={styles.grabber} accessible={false} importantForAccessibility="no" />
          <CampaignTrustBlock campaign={campaign} />
          {obligation.data == null ? null : (
            <UpdateObligationNotice obligation={obligation.data} />
          )}
        </View>
      </SurfaceProvider>
    </View>
  );

  /*
   * The foot of the sheet. It clears the home indicator — a stack route, so the inset is this
   * screen's to read — and, where pledges are taken, the floating Back pill, so neither ever covers
   * the report link.
   */
  const tail = pledgeable ? persistentBarClearance(insets.bottom) : insets.bottom;
  const footer = (
    <SurfaceProvider surface="white">
      <View
        style={[styles.footer, { paddingBottom: spacing[10] + tail }]}
        onLayout={(event: LayoutChangeEvent) => {
          footerHeight.current = event.nativeEvent.layout.height;
          askForMore();
        }}
        testID="campaign-footer"
      >
        {body.footer === null ? null : <View style={styles.gutter}>{body.footer}</View>}
        <View style={[styles.gutter, styles.rewards]}>
          <CampaignRewards projectId={campaign.id} tiers={tiers} pledgeable={pledgeable} />
          <ReportLink projectId={campaign.id} title={campaign.title} offline={offline} />
        </View>
        {/*
          The sheet goes on past the end of the list, so an overscroll bounce or the bottom content
          inset shows more sheet rather than the dark canvas under it.
        */}
        <View style={styles.sheetRunout} pointerEvents="none" />
      </View>
    </SurfaceProvider>
  );

  return (
    <AccentScopeProvider>
      <View style={styles.screen} testID="campaign-screen">
        <Stack.Screen options={{ title: campaign.title, headerBackTitle: t('mobile.nav.back') }} />
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          // A short tab still ends in sheet, not canvas: the footer takes the rest of the height.
          contentContainerStyle={styles.content}
          ListFooterComponentStyle={styles.footerSlot}
          // The tab bar is data[0]; with a header, the list counts the header as index 0.
          stickyHeaderIndices={[1]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_width, height) => {
            contentHeight.current = height;
            askForMore();
          }}
          onLayout={(event) => {
            viewport.current = event.nativeEvent.layout.height;
            placeBar();
            askForMore();
          }}
          keyboardShouldPersistTaps="handled"
          // The comment composers (the Comments tab) sit in this list; iOS lifts it over the
          // keyboard rather than covering the field being typed in.
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.textSecondary}
              colors={[colors.textPrimary]}
              progressBackgroundColor={colors.surface3}
            />
          }
          testID="campaign-list"
        />
        {barShown ? <PersistentBackBar projectId={campaign.id} title={campaign.title} /> : null}
      </View>
    </AccentScopeProvider>
  );
}

/** Module-level, so the list is handed the same function on every render. */
function renderRow({ item }: ListRenderItemInfo<ListRow>) {
  return item.render();
}

/** A row of the active tab: the page's gutter, on the white sheet, in the sheet's tones. */
function SheetRow({ children }: { readonly children: ReactElement }) {
  return (
    <SurfaceProvider surface="white">
      <View style={[styles.gutter, styles.sheet]}>{children}</View>
    </SurfaceProvider>
  );
}

/** One placeholder while the active tab's first page is on its way (`CampaignTabBody.loading`). */
function TabPlaceholder() {
  return (
    <SheetRow>
      <View style={styles.placeholder}>
        <SkeletonGroup>
          <View style={styles.placeholderLines}>
            <Skeleton height={24} width="60%" />
            <Skeleton height={96} radius="lg" />
            <Skeleton height={96} radius="lg" />
          </View>
        </SkeletonGroup>
      </View>
    </SheetRow>
  );
}

/** Expo Router's params, first value of each, as the tab contract hands them on. */
function flatten(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const flat: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(params)) {
    flat[name] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface1 },
  content: { flexGrow: 1 },
  canvas: {
    gap: spacing[5],
    paddingHorizontal: GUTTER,
    paddingTop: spacing[4],
    paddingBottom: spacing[8],
  },
  // The white content sheet's top (`mobile-design` skill §2), as `ContentSheet` draws its own.
  sheetTop: {
    gap: spacing[6],
    paddingHorizontal: GUTTER,
    paddingTop: spacing[3],
    backgroundColor: colors.whiteSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: spacing[8] + spacing[1],
    height: spacing[1],
    borderRadius: radius.full,
    backgroundColor: TONES.white.tertiary,
    marginBottom: -spacing[2],
  },
  sheet: { backgroundColor: colors.whiteSurface },
  funding: { gap: spacing[3] },
  meta: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  gutter: { paddingHorizontal: GUTTER },
  footerSlot: { flexGrow: 1 },
  footer: { flexGrow: 1, backgroundColor: colors.whiteSurface },
  sheetRunout: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    height: SHEET_RUNOUT,
    backgroundColor: colors.whiteSurface,
  },
  rewards: { paddingTop: spacing[10], gap: spacing[10] },
  placeholder: { paddingTop: spacing[8] },
  placeholderLines: { gap: spacing[4] },
});
