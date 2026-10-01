import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react-native';
import { ApiError } from '@ideanest/api-client';
import { fillNodes } from '@ideanest/messages/placeholders';
import { queryKeys, usePrelaunchPage, type PrelaunchPage } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { formatCount, pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { noPrelaunchPage, prelaunchFailure } from '../../lib/prelaunch';
import { useSession } from '../../lib/use-session';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { FadeUp } from '../motion';
import { Body, Eyebrow, Heading } from '../text';
import { Icon, InlineAlert, Media, Pill, Screen, Skeleton, SkeletonGroup } from '../ui';
import { PrelaunchForm } from './prelaunch-form';

/**
 * A campaign's public pre-launch page — the web's `PrelaunchView`
 * (`apps/web/src/components/prelaunch/PrelaunchView.tsx`) as a native screen, issue #155.
 *
 * <h2>The phases</h2>
 *
 * <ul>
 *   <li><strong>Loading</strong> — the web's skeleton: a 14rem block and two lines at 70% and 90%,
 *       named for a screen reader as one stop.</li>
 *   <li><strong>Unavailable</strong> — a 404, which the service answers alike for no such
 *       campaign, a draft and one already launched, deliberately, so that it never reports on
 *       what other people are preparing. One info alert says so without saying which. The same
 *       state, with `alreadyOpen`, follows a `REMINDERS_CLOSED` refusal.</li>
 *   <li><strong>Failed</strong> — anything else with nothing cached: a danger alert with the
 *       reason and a retry, never the unavailable wording, which would be untrue of a phone that
 *       is only offline.</li>
 *   <li><strong>Ready</strong>, then <strong>following</strong> once the form is sent.</li>
 *   <li><strong>Offline</strong> — the cached page (`queryKeys.prelaunch` sits under the persisted
 *       `project` root), a notice that the count may have moved, and the form disabled with the
 *       sentence a failed request would have said.</li>
 * </ul>
 *
 * <h2>Motion: one FadeUp, on the part that is read</h2>
 *
 * The route takes the project page's moderate budget (docs/motion-system.md §5), and spends it on
 * one `FadeUp` around the cover, title and count — the web's exact use. The form is outside it.
 */
export function PrelaunchScreen({ projectId }: { readonly projectId: string }) {
  const t = useT('campaign.prelaunch');
  const tAll = useT();
  const online = useOnline();
  const { signedIn } = useSession();
  const queryClient = useQueryClient();
  const query = usePrelaunchPage(projectId);
  const [closed, setClosed] = useState(false);
  const [pulling, setPulling] = useState(false);

  const refresh = () => {
    setPulling(true);
    void query.refetch().finally(() => setPulling(false));
  };

  /** Writes the service's new count into the cached page, so a restart shows it too. */
  const setFollowerCount = (followerCount: number) =>
    queryClient.setQueryData<PrelaunchPage>(queryKeys.prelaunch(projectId), (page) =>
      page === undefined ? page : { ...page, followerCount },
    );

  const fallbackTitle = tAll('mobile.fallback.prelaunch');
  const header = (title: string) => (
    <Stack.Screen options={{ title, headerBackTitle: tAll('mobile.nav.back') }} />
  );

  if (closed || noPrelaunchPage(query.error)) {
    return (
      <Screen hasContent motion="moderate" onRefresh={refresh} refreshing={pulling}>
        {header(fallbackTitle)}
        <View style={styles.page}>
          <InlineAlert
            variant="info"
            title={t('unavailableTitle')}
            description={closed ? t('alreadyOpen') : t('unavailable')}
            testID="prelaunch-unavailable"
          />
        </View>
      </Screen>
    );
  }

  const page = query.data;

  if (page === undefined) {
    if (query.isError) {
      const reason = prelaunchFailure(query.error);
      return (
        <Screen hasContent motion="moderate" onRefresh={refresh} refreshing={pulling}>
          {header(fallbackTitle)}
          <View style={styles.page}>
            <InlineAlert
              variant="danger"
              title={t('failedTitle')}
              description={
                reason.key === 'rateLimitedIn'
                  ? t('errors.rateLimitedIn', { minutes: String(reason.minutes) })
                  : t(`errors.${reason.key}`)
              }
              action={
                <Pill
                  label={tAll('common.tryAgain')}
                  onPress={() => void query.refetch()}
                  busy={query.isFetching}
                  variant="ghost"
                  size="sm"
                />
              }
              testID="prelaunch-failed"
            />
          </View>
        </Screen>
      );
    }

    return (
      <Screen hasContent motion="moderate">
        {header(fallbackTitle)}
        <View style={styles.page}>
          <SkeletonGroup label={t('loading')} testID="prelaunch-loading">
            <View style={styles.placeholder}>
              {/* The web's 14rem block, then two lines at 70% and 90% of the column. */}
              <Skeleton height={224} radius="lg" />
              <Skeleton height={20} width="70%" />
              <Skeleton height={20} width="90%" />
            </View>
          </SkeletonGroup>
        </View>
      </Screen>
    );
  }

  /*
   * Offline is either what the phone reports or a refetch that got no answer at all. A refusal
   * (a 500) over cached data is not offline: the form may still work, so it stays enabled and
   * only the notice says the page could not be refreshed.
   */
  const unreachable = query.isError && !(query.error instanceof ApiError);
  const offline = !online || unreachable;
  const stale = offline || query.isError;

  return (
    <Screen
      hasContent
      motion="moderate"
      offlineNotice={stale ? tAll('mobile.prelaunch.stale') : null}
      onRefresh={refresh}
      refreshing={pulling}
    >
      {header(page.title ?? fallbackTitle)}
      <View style={styles.page} testID="prelaunch-ready">
        <FadeUp>
          <PrelaunchSummary page={page} />
        </FadeUp>

        <PrelaunchForm
          projectId={projectId}
          signedIn={signedIn}
          offline={offline}
          onFollowerCount={setFollowerCount}
          onClosed={() => setClosed(true)}
        />
      </View>
    </Screen>
  );
}

/** The cover, the eyebrow, the title and blurb, and how many are waiting. */
function PrelaunchSummary({ page }: { readonly page: PrelaunchPage }) {
  const t = useT('campaign.prelaunch');
  const tAll = useT();
  const locale = useLocale();
  const cover = page.coverImage;
  const count = page.followerCount ?? 0;

  return (
    <View>
      {cover?.url == null || cover.url === '' ? null : (
        /*
         * Shown whole, so the box is the shape the picture really is: a creator's 4:3 photograph
         * forced into 16:9 would be a layout shift with extra steps. `aspectRatioOf` falls back to
         * 16:9 for a size that cannot be a ratio, which is what a missing measurement leaves.
         * Decorative: the title beneath it already says what the campaign is.
         */
        <Media
          src={cover.url}
          ratio={{ width: cover.width ?? 0, height: cover.height ?? 0 }}
          radius="lg"
          decorative
          style={styles.cover}
          testID="prelaunch-cover"
        />
      )}

      <Eyebrow>{t('comingSoon')}</Eyebrow>
      <Heading accessibilityRole="header" style={styles.title}>
        {page.title ?? tAll('mobile.campaign.untitled')}
      </Heading>

      {page.blurb == null || page.blurb === '' ? null : (
        <Body tone="reading" style={styles.blurb}>
          {page.blurb}
        </Body>
      )}

      <View style={styles.waiting}>
        <Icon icon={Users} size={16} color={colors.textSecondary} />
        {/* One text node, so a screen reader reads the sentence once with the number in it. */}
        <Body style={styles.waitingText} testID="prelaunch-waiting">
          {fillNodes(String(tAll.raw(`campaign.prelaunch.waiting.${pluralCategory(locale, count)}`)), {
            count: <Text style={styles.count}>{formatCount(count, locale)}</Text>,
          })}
        </Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: spacing[4], paddingBottom: spacing[10], gap: spacing[10] },
  placeholder: { gap: spacing[5] },
  // The web's `border-white/8` around the cover, and its `mb-8` under it.
  cover: { borderWidth: 1, borderColor: colors.border, marginBottom: spacing[8] },
  title: { marginTop: spacing[2] },
  // 18pt in the reading colour — the web's `text-lg text-reading`.
  blurb: { marginTop: spacing[4], fontSize: fontSize.lg, lineHeight: lineHeight.cardTitle },
  waiting: { marginTop: spacing[6], flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  waitingText: { flex: 1, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  count: { ...font.semibold, color: colors.textPrimary },
});
