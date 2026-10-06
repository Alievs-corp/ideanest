import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { pluralise } from '@ideanest/messages/plurals';
import { formatMoney } from '@ideanest/money';
import {
  Body,
  Card,
  CardTitle,
  Heading,
  Icon,
  Meta,
  ProgressBar,
  Screen,
  Skeleton,
  SkeletonGroup,
  StatBlock,
  StatRow,
} from '../../../components/ui';
import { traceIdOfError } from '../../../api/client';
import { queryKeys } from '../../../api/queries';
import { Glyphs } from '../../../icons';
import { useAppActive } from '../../../lib/app-active';
import { useOnline } from '../../../lib/connectivity';
import { catalogue, formatCount, formatDateTime, useT, type MessageKey, type Translate } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, font, fontSize, spacing } from '../../../theme';
import { readOverview, type OverviewRead } from './api';
import { CampaignClock } from './campaign-clock';
import { CampaignControls } from './campaign-controls';

/**
 * The dashboard's Overview — the web's `DashboardOverview` (#163): the campaign's title, its clock,
 * what it has raised from how many backers against what goal, the creator's two decisions, and
 * the outcome once the deadline has decided it.
 *
 * <p>Read through the query cache and persisted, so a creator offline sees the last figures with
 * the time they were fetched; the controls are disabled until the connection is back. Success and
 * lime are kept apart: the bar and "Goal reached" use `success`, and lime is only the clock's
 * "Closing soon" and a confirmation's button.
 */
export interface OverviewScreenProps {
  readonly projectId: string;
  /** Injected by tests, for the clock and the skew measurement. */
  readonly now?: () => number;
}

/** A refusal as a sentence: by status, never by the service's prose. */
export function overviewFailure(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return t('dashboard.failures.signedOut');
    if (cause.status === 403) return t('dashboard.overview.notGranted');
    if (cause.status === 404) return t('dashboard.failures.noCampaign');
  }
  return t('dashboard.overview.unavailable');
}

export function OverviewScreen({ projectId, now }: OverviewScreenProps) {
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const active = useAppActive();
  const [pulling, setPulling] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.dashboardOverview(projectId),
    queryFn: ({ signal }) => readOverview(projectId, signal, now),
    // The figures move while the creator watches; a cached copy is shown, never trusted as fresh.
    staleTime: 0,
  });
  const { refetch } = query;
  const read = query.data;

  const reread = useCallback(async (): Promise<OverviewRead | null> => {
    const result = await refetch();
    return result.status === 'success' ? result.data : null;
  }, [refetch]);

  const stateLabel = useCallback(
    (state: string) => {
      const key = `admin.screens.campaignDirectory.state.${state}` as MessageKey;
      return t.has(key) ? t(key) : state;
    },
    [t],
  );

  if (read === undefined) {
    const failed = query.isError;
    return (
      <Screen
        hasContent={!failed}
        error={
          failed
            ? {
                title: online ? overviewFailure(query.error, t) : t('mobile.offline.nothingCached'),
                onRetry: () => void refetch(),
                retrying: query.isFetching,
                traceId: traceIdOfError(query.error),
              }
            : null
        }
        testID="overview-screen"
      >
        <SkeletonGroup label={t('dashboard.overview.loading')} testID="overview-loading">
          <View style={styles.top}>
            <Skeleton width="66%" height={32} />
            <Skeleton height={96} />
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  const { dashboard, skewMs, receivedAt } = read;
  const percent =
    dashboard.percentFunded === undefined || dashboard.percentFunded === null ? null : String(dashboard.percentFunded);
  const stale = !online || query.isError;
  const outcome = dashboard.outcome;

  return (
    <Screen
      hasContent
      offlineNotice={online ? null : t('mobile.offline.banner')}
      error={
        online && query.isError
          ? {
              title: overviewFailure(query.error, t),
              onRetry: () => void refetch(),
              retrying: query.isFetching,
            }
          : null
      }
      onRefresh={() => {
        setPulling(true);
        void refetch().finally(() => setPulling(false));
      }}
      refreshing={pulling}
      testID="overview-screen"
    >
      <View style={styles.top}>
        <Heading accessibilityRole="header" testID="overview-title">
          {dashboard.title ?? ''}
        </Heading>
        {stale ? (
          <Meta tone="tertiary" testID="overview-as-of">
            {t('mobile.dashboard.asOf', { time: formatDateTime(new Date(receivedAt).toISOString(), locale) })}
          </Meta>
        ) : null}
        <CampaignClock deadline={dashboard.deadline} skewMs={skewMs} active={active} now={now} />
      </View>

      <StatRow testID="overview-stats">
        {dashboard.raised === undefined ? null : (
          <StatBlock
            label={t('dashboard.overview.raised')}
            money={dashboard.raised}
            motion="count"
            testID="overview-raised"
          />
        )}
        <StatBlock
          label={t('dashboard.overview.backers')}
          value={formatCount(dashboard.backersCount ?? 0, locale)}
          icon={Glyphs.People}
          size="md"
          testID="overview-backers"
        />
        {dashboard.goal === undefined ? (
          <StatBlock
            label={t('dashboard.overview.goal')}
            value={t('dashboard.overview.goalUnset')}
            size="md"
            testID="overview-goal"
          />
        ) : (
          <StatBlock label={t('dashboard.overview.goal')} money={dashboard.goal} size="md" testID="overview-goal" />
        )}
      </StatRow>

      {percent === null ? (
        // Not a bar at zero: a campaign with no goal has not raised none of it.
        <Body testID="overview-no-goal">{t('dashboard.overview.noGoal')}</Body>
      ) : (
        <View style={styles.progress}>
          <ProgressBar
            completionPercent={percent}
            label={t('dashboard.overview.progressLabel', { percent })}
            showLabel={false}
            testID="overview-progress"
          />
          <View style={styles.funded}>
            <Meta tone="primary" style={styles.figure}>
              {t('dashboard.overview.percentFunded', { percent })}
            </Meta>
            {dashboard.goalReached === true ? (
              <View style={styles.reached} testID="overview-goal-reached">
                <Icon icon={Glyphs.TickCircle} size={16} color={colors.success} />
                <Meta style={styles.reachedText}>{t('dashboard.overview.goalReached')}</Meta>
              </View>
            ) : null}
          </View>
        </View>
      )}

      <CampaignControls
        projectId={projectId}
        dashboard={dashboard}
        online={online}
        reread={reread}
        stateLabel={stateLabel}
      />

      {outcome === undefined ? null : (
        <Card size="md" testID="overview-outcome">
          <View style={styles.outcome}>
            <CardTitle accessibilityRole="header">{t('dashboard.overview.outcomeHeading')}</CardTitle>
            <Body>
              {t('dashboard.overview.outcome', {
                pledged: outcome.pledged === undefined ? '' : formatMoney(outcome.pledged),
                backers: pluralise(
                  locale,
                  catalogue(locale).dashboard.overview.outcomeBackers,
                  outcome.backersCount ?? 0,
                ),
                goal: outcome.goal === undefined ? '' : formatMoney(outcome.goal),
              })}
            </Body>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { gap: spacing[3], paddingTop: spacing[4] },
  progress: { gap: spacing[2] },
  funded: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  figure: { fontVariant: ['tabular-nums'] },
  reached: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  reachedText: { ...font.medium, fontSize: fontSize.sm, color: colors.success },
  outcome: { gap: spacing[2] },
});
