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
import { readCampaignPage, tiersOf, type CampaignPage } from '../../lib/campaign-page';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { shareUrlFor } from '../../lib/links';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { NotFoundState } from '../not-found-state';
import {
  AccentScopeProvider,
  InlineAlert,
  MotionBudgetProvider,
  Screen,
  Skeleton,
  SkeletonGroup,
  haptics,
} from '../ui';
import { BackCampaignCta, PersistentBackBar } from './back-campaign-cta';
import { CampaignActions } from './campaign-actions';
import { CampaignCountdown } from './campaign-countdown';
import { CampaignHeader, showsDaysLeft } from './campaign-header';
import { CampaignMedia } from './campaign-media';
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
 *    the countdown, Back this campaign, Save / Share / Remind, the trust block and the update
 *    obligation.
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
 * <h2>States</h2>
 *
 * A 404, a response the page cannot draw, or a state outside `RENDERABLE_STATES` is the not-found
 * screen, distinct from a network failure with nothing cached, which is an error with a retry. A
 * cached page whose refetch failed is drawn with the offline notice; offline there is no socket,
 * and Save and Remind are disabled and say why.
 *
 * <h2>Motion</h2>
 *
 * None that arrives: no `FadeUp` on any block, no fade on the cover, the persistent Back bar
 * appears and goes without a transition (docs/motion-system.md §5: motion decreases as money gets
 * closer). The route declares §5's moderate budget for what the kit does on a press and for the
 * progress bar's fill, which §6 keeps.
 */
export interface CampaignScreenProps {
  readonly creatorSlug: string;
  readonly projectSlug: string;
  /**
   * The instant "now" is for the page's rules — days left and whether pledges are taken. A test's
   * way to ask what the page says on a campaign's last day; the route never passes it.
   */
  readonly now?: Date;
}

export function CampaignScreen({ creatorSlug, projectSlug, now }: CampaignScreenProps) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const query = useProjectPage(creatorSlug, projectSlug);
  const campaign = useMemo(
    () => readCampaignPage(query.data, creatorSlug, now ?? new Date()),
    [query.data, creatorSlug, now],
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
        motion="moderate"
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
        <CampaignSkeleton />
      </Screen>
    );
  }

  /*
   * Offline, or the service could not be reached: the cached page, said to be old, with no socket
   * and no writes. A refusal with a status (a 500) still leaves the page readable and old.
   */
  const unreachable = query.isError && !(query.error instanceof ApiError);
  const offline = !online || unreachable;

  return (
    <CampaignView
      campaign={campaign}
      offline={offline}
      stale={offline || query.isError}
      now={now}
      refetchPage={() => query.refetch()}
    />
  );
}

interface CampaignViewProps {
  readonly campaign: CampaignPage;
  readonly offline: boolean;
  /** The figures are the cached ones: say so above the page. */
  readonly stale: boolean;
  readonly now: Date | undefined;
  readonly refetchPage: () => Promise<unknown>;
}

/** The space between the screen's edges and its content — the kit's `Screen` gutter. */
const GUTTER = spacing[5];

/** A row of the list: the tab bar, or one of the active tab's rows. */
interface ListRow {
  readonly key: string;
  readonly render: () => ReactElement;
}

function CampaignView({ campaign, offline, stale, now, refetchPage }: CampaignViewProps) {
  const t = useT();
  const router = useRouter();
  const rawParams = useLocalSearchParams<Record<string, string | string[]>>();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const active = focused && appActive;

  const rewards = useProjectRewards(campaign.id);
  const obligation = useUpdateObligation(campaign.id);
  const tiers = useMemo(() => tiersOf(rewards.data), [rewards.data]);
  const pledgeable = acceptsPledges(campaign.state, campaign.deadline, now ?? new Date());

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

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    placeBar();
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
    { key: 'tabs', render: () => <CampaignTabs active={tab} onSelect={selectTab} /> },
    ...body.rows.map((row: CampaignTabRow) => ({
      key: `${tab}:${row.key}`,
      render: () => <View style={styles.gutter}>{row.render()}</View>,
    })),
  ];
  if (body.loading && body.rows.length === 0) {
    rows.push({ key: `${tab}:loading`, render: () => <TabPlaceholder /> });
  }

  const header = (
    <View
      style={styles.header}
      onLayout={(event: LayoutChangeEvent) => {
        headerHeight.current = event.nativeEvent.layout.height;
      }}
    >
      {stale ? (
        <InlineAlert
          variant="warning"
          politeness="polite"
          description={t('mobile.campaign.stale')}
          testID="campaign-stale"
        />
      ) : null}

      <CampaignMedia cover={campaign.coverImage} />
      <CampaignHeader campaign={campaign} />

      {campaign.goal === null ? null : (
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
            {showsDaysLeft(campaign) && campaign.daysLeft !== null
              ? ` · ${t('campaign.daysLeft', { days: campaign.daysLeft })}`
              : ''}
          </Text>
          <Text style={styles.meta}>{t('campaign.rule')}</Text>
        </View>
      )}

      {campaign.state === 'LIVE' && campaign.deadline !== null ? (
        <CampaignCountdown deadline={campaign.deadline} active={active} />
      ) : null}

      {pledgeable ? (
        <BackCampaignCta
          projectId={campaign.id}
          title={campaign.title}
          onLayout={(event) => {
            const { y, height } = event.nativeEvent.layout;
            pill.current = { y, height };
            placeBar();
          }}
        />
      ) : null}

      <CampaignActions
        projectId={campaign.id}
        state={campaign.state}
        title={campaign.title}
        shareUrl={shareUrlFor(siteUrl(), campaign.creatorSlug, campaign.slug)}
        offline={offline}
      />

      <View style={styles.notices}>
        <CampaignTrustBlock campaign={campaign} />
        {obligation.data == null ? null : <UpdateObligationNotice obligation={obligation.data} />}
      </View>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {body.footer === null ? null : <View style={styles.gutter}>{body.footer}</View>}
      <View style={[styles.gutter, styles.rewards]}>
        <CampaignRewards projectId={campaign.id} tiers={tiers} pledgeable={pledgeable} />
        <ReportLink projectId={campaign.id} title={campaign.title} offline={offline} />
      </View>
    </View>
  );

  return (
    <AccentScopeProvider>
      <MotionBudgetProvider level="moderate">
        <View style={styles.screen} testID="campaign-screen">
          <Stack.Screen options={{ title: campaign.title, headerBackTitle: t('mobile.nav.back') }} />
          <FlatList
            ref={list}
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            // The tab bar is data[0]; with a header, the list counts the header as index 0.
            stickyHeaderIndices={[1]}
            onEndReached={body.onEndReached ?? undefined}
            onEndReachedThreshold={0.5}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onLayout={(event) => {
              viewport.current = event.nativeEvent.layout.height;
              placeBar();
            }}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
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
      </MotionBudgetProvider>
    </AccentScopeProvider>
  );
}

/** Module-level, so the list is handed the same function on every render. */
function renderRow({ item }: ListRenderItemInfo<ListRow>) {
  return item.render();
}

/** One placeholder while the active tab's first page is on its way (`CampaignTabBody.loading`). */
function TabPlaceholder() {
  return (
    <View style={[styles.gutter, styles.placeholder]}>
      <SkeletonGroup>
        <View style={styles.placeholderLines}>
          <Skeleton height={24} width="60%" />
          <Skeleton height={96} radius="lg" />
          <Skeleton height={96} radius="lg" />
        </View>
      </SkeletonGroup>
    </View>
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
  header: {
    gap: spacing[5],
    paddingHorizontal: GUTTER,
    paddingTop: spacing[4],
    paddingBottom: spacing[8],
  },
  funding: { gap: spacing[3] },
  meta: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  notices: { gap: spacing[6], marginTop: spacing[3] },
  gutter: { paddingHorizontal: GUTTER },
  footer: { paddingBottom: spacing[10] },
  rewards: { paddingTop: spacing[10], gap: spacing[10] },
  placeholder: { paddingTop: spacing[8] },
  placeholderLines: { gap: spacing[4] },
});
