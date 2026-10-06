import { useCallback, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { FailureState } from '../../components/failure-state';
import { FIRST_SCREENFUL, FadeUp } from '../../components/motion';
import { ReportTrigger } from '../../components/campaign/report-link';
import {
  InlineAlert,
  Screen,
  Skeleton,
  SkeletonCard,
  SkeletonGroup,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import { useMe } from '../../lib/account';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { colors, radius, spacing, tint } from '../../theme';
import {
  isNotFound,
  useCreatorObligations,
  useProfileList,
  usePublicProfile,
  type ProfileList,
} from './api';
import { ProfileIdentity } from './follow-control';
import { knownTotal } from './format';
import { CreatorObligationSummary } from './obligation-summary';
import { ProfileAbout } from './profile-about';
import { ProfileCampaignList } from './profile-campaign-list';
import { PROFILE_TABS, ProfileTabs, profileTabFrom, type ProfileTabId } from './profile-tabs';
import { SheetList } from './sheet-list';
import type { PublicProfile } from './wire';

/**
 * The public profile — web `/u/{slug}` (#156): who, the late-updates card when there is one, the
 * tabs (Created · Backed · About), then the tab's panel, in the web's order; Report this account at
 * the foot.
 *
 * <h2>Reads</h2>
 *
 * The profile, the first page of both lists (the tab counts need them) and the obligations are
 * asked for at once. A 404 is the not-found screen — the same words for an unknown slug, a closed
 * account and a private profile; a profile that could not be reached is an error with a retry, a
 * different fact. The obligations failing draws nothing; a list failing says so in its own panel.
 *
 * <h2>Panels</h2>
 *
 * Each tab is its own screen-level list with the header as the list's header, mounted the first
 * time it is chosen and kept, hidden, afterwards — so each keeps its own scroll offset. The tab is
 * local state mirrored to `?tab=` for state restoration.
 *
 * <h2>Offline and refresh</h2>
 *
 * Nothing here is persisted (`profile` root). Offline, what this session already read is shown with
 * a notice under the header (and the global banner above), and Follow and Report are disabled.
 * Pull to refresh reloads the profile, the obligations and the open list from its first page.
 */
export function ProfileScreen({ slug, tab: tabParam }: { readonly slug: string; readonly tab?: string }) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const profileQuery = usePublicProfile(slug);
  const obligations = useCreatorObligations(slug);
  const created = useProfileList(slug, 'created');
  const backed = useProfileList(slug, 'backed');

  const [initial] = useState(() => profileTabFrom(tabParam));
  const [tab, setTab] = useState<ProfileTabId>(initial);
  const [visited, setVisited] = useState<ReadonlySet<ProfileTabId>>(() => new Set([initial]));
  const [refreshing, setRefreshing] = useState(false);

  const select = useCallback(
    (next: ProfileTabId) => {
      setTab(next);
      setVisited((seen) => (seen.has(next) ? seen : new Set([...seen, next])));
      router.setParams({ tab: next });
    },
    [router],
  );

  const profile = profileQuery.data;
  const { refetch: refetchProfile } = profileQuery;
  const { refetch: refetchObligations } = obligations;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const list = tab === 'created' ? created : tab === 'backed' ? backed : null;
    await Promise.allSettled([refetchProfile(), refetchObligations(), list?.refresh()]);
    setRefreshing(false);
  }, [tab, created, backed, refetchProfile, refetchObligations]);

  if (isNotFound(profileQuery.error) || profile === null) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <FailureState
          title={t('shell.failure.pages.profileNotFound.title')}
          description={t('shell.failure.pages.profileNotFound.description')}
          actionLabel={t('shell.failure.pages.profileNotFound.action')}
          onAction={() => router.replace('/discover')}
          icon={Glyphs.SearchStatus}
          testID="profile-not-found"
        />
      </>
    );
  }

  if (profile === undefined) {
    return (
      <Screen
        hasContent={!profileQuery.isError}
        error={
          profileQuery.isError
            ? {
                title: t('mobile.profile.failedTitle'),
                description: online ? t('mobile.profile.failedBody') : t('mobile.offline.nothingCached'),
                onRetry: () => void refetchProfile(),
                retrying: profileQuery.isFetching,
              }
            : null
        }
        testID={profileQuery.isError ? 'profile-error' : 'profile-loading'}
      >
        <Stack.Screen options={{ title: '', headerBackTitle: t('mobile.nav.back') }} />
        <ProfileSkeleton label={t('mobile.profile.loading')} />
      </Screen>
    );
  }

  // Cached, but the latest read failed or there is no connection: say it is old, and do not write.
  const unreachable = profileQuery.isError && !(profileQuery.error instanceof ApiError);
  const offline = !online || unreachable;
  const stale = offline || profileQuery.isError;
  const lapsed = obligations.data?.lapsedCount ?? 0;
  const counts = { created: knownTotal(created.first), backed: knownTotal(backed.first) };

  const header = (rises: boolean): ReactElement => (
    <View style={styles.header}>
      <FadeUp index={rises ? 0 : FIRST_SCREENFUL}>
        <ProfileIdentity profile={profile} offline={offline} />
      </FadeUp>
      {lapsed > 0 ? (
        <FadeUp index={rises ? 1 : FIRST_SCREENFUL}>
          <CreatorObligationSummary lapsedCount={lapsed} name={profile.name} />
        </FadeUp>
      ) : null}
      {stale ? (
        <InlineAlert
          variant="warning"
          politeness="polite"
          description={t('mobile.profile.stale')}
          testID="profile-stale"
        />
      ) : null}
      <View style={styles.tabs}>
        <ProfileTabs active={tab} onSelect={select} counts={counts} />
      </View>
    </View>
  );

  const foot = <ProfileReport profile={profile} offline={offline} />;
  const listFor = (id: 'created' | 'backed'): ProfileList => (id === 'created' ? created : backed);

  return (
    <View style={styles.page} testID="profile-screen">
      <Stack.Screen options={{ title: profile.name, headerBackTitle: t('mobile.nav.back') }} />
      {PROFILE_TABS.filter((id) => visited.has(id)).map((id) => {
        const current = id === tab;
        return (
          <View
            key={id}
            style={[StyleSheet.absoluteFill, !current && styles.hidden]}
            pointerEvents={current ? 'auto' : 'none'}
            accessibilityElementsHidden={!current}
            importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
            testID={`profile-panel-${id}`}
          >
            {id === 'about' ? (
              <SheetList
                data={[]}
                keyExtractor={() => ''}
                renderRow={() => <View />}
                header={header(id === initial)}
                footer={
                  <View style={styles.aboutFooter}>
                    <ProfileAbout profile={profile} />
                    {foot}
                  </View>
                }
                refreshing={refreshing}
                onRefresh={() => void refresh()}
                testID="profile-list-about"
              />
            ) : (
              <ProfileCampaignList
                kind={id}
                list={listFor(id)}
                name={profile.name}
                header={header(id === initial)}
                foot={foot}
                rises={id === initial}
                refreshing={refreshing}
                onRefresh={() => void refresh()}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * "Report this account", quiet, at the foot of every tab — the web's `ProfileReportControl`. Not
 * offered to the account the page is about: reporting yourself is a 400.
 */
function ProfileReport({ profile, offline }: { readonly profile: PublicProfile; readonly offline: boolean }) {
  const me = useMe();
  if (me.data?.slug === profile.slug) return null;
  return (
    <View style={styles.report} testID="profile-report">
      <ReportTrigger target={{ kind: 'account', slug: profile.slug }} name={profile.name} offline={offline} />
    </View>
  );
}

/** The profile's shape while it loads: the avatar and two lines, the tab row, three cards. */
function ProfileSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.skeleton}>
        <View style={styles.skeletonIdentity}>
          <Skeleton circle height={56} />
          <View style={styles.skeletonNames}>
            <Skeleton height={24} width="60%" />
            <Skeleton height={14} width="35%" />
          </View>
        </View>
        <View style={styles.skeletonTabs}>
          {[0, 1, 2].map((pill) => (
            <View key={pill} style={styles.skeletonPill}>
              <Skeleton height={34} />
            </View>
          ))}
        </View>
        {[0, 1, 2].map((card) => (
          <SkeletonCard key={card} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface1 },
  hidden: { opacity: 0 },
  header: { gap: spacing[6] },
  tabs: { marginTop: spacing[2] },
  aboutFooter: { gap: spacing[6] },
  report: {
    paddingTop: spacing[6],
    borderTopWidth: StyleSheet.hairlineWidth,
    // The rule sits in the white sheet.
    borderTopColor: tint(colors.black, 0.08),
  },
  skeleton: { gap: spacing[6], paddingTop: spacing[4] },
  skeletonIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  skeletonNames: { flex: 1, gap: spacing[2] },
  skeletonTabs: { flexDirection: 'row', gap: spacing[2] },
  skeletonPill: { width: spacing[20], borderRadius: radius.full, overflow: 'hidden' },
});
