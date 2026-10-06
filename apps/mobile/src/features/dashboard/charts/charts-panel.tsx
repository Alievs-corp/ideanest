import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Trend } from '@ideanest/dashboard/analytics';
import { formatMoney, type Money } from '@ideanest/money';
import {
  Body,
  CardTitle,
  ContentSheet,
  EmptyState,
  Heading,
  InlineAlert,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  StatBlock,
  StatRow,
  Subheading,
} from '../../../components/ui';
import { FadeUp } from '../../../components/motion';
import { useOnline } from '../../../lib/connectivity';
import { signInHrefFor } from '../../../lib/guard';
import { formatCount, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { useSession } from '../../../lib/use-session';
import { spacing } from '../../../theme';
import { relativeTime } from '../../settings/sessions/relative-time';
import { sectionOf, usePullToRefresh, type Refusal, type SectionState } from '../shared-charts-finance';
import { useBreakdown, useTrend, type Breakdown } from './api';
import { ShareBars, type ShareRow } from './share-bars';
import { DailyFigures, TrendChart } from './trend-chart';

/** The web's 220px chart placeholder and 96px split placeholder. */
const TREND_PLACEHOLDER = 220;
const SPLIT_PLACEHOLDER = 96;

/**
 * `campaigns/[id]/dashboard/charts` — the web's `FundingCharts` (#163): the funding trend, the
 * reward mix and where the backers are.
 *
 * <p>Two reads, in parallel, and neither takes the other down: each section has its own loading,
 * refusal and empty state, because they come from different places (the daily rollup and a live
 * count of pledges) and fail for different reasons. The trend is the hero on the dark canvas; the
 * splits are a list, in the white sheet. The tab bar above is the dashboard layout's.
 */
export function FundingChartsPanel({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const router = useRouter();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        edges={EDGES}
        empty={
          <EmptyState
            title={t('dashboard.charts.heading')}
            description={t('dashboard.failures.signedOut')}
            action={
              <Pill
                label={t('shell.actions.signIn')}
                onPress={() => router.push(signInHrefFor(`/campaigns/${projectId}/dashboard/charts`))}
              />
            }
          />
        }
      />
    );
  }
  return <Panel projectId={projectId} />;
}

function Panel({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const online = useOnline();
  const trendQuery = useTrend(projectId);
  const breakdownQuery = useBreakdown(projectId);
  const trend = sectionOf(trendQuery, online);
  const split = sectionOf(breakdownQuery, online);
  const pull = usePullToRefresh([trendQuery.refetch, breakdownQuery.refetch]);
  const stale = (trend.kind === 'ready' && trend.stale) || (split.kind === 'ready' && split.stale);

  return (
    <Screen
      hasContent
      edges={EDGES}
      onRefresh={pull.onRefresh}
      refreshing={pull.refreshing}
      offlineNotice={stale ? t('mobile.dashboardFigures.stale') : null}
      testID="dashboard-charts"
    >
      <FadeUp index={0}>
        <View style={styles.header}>
          <Heading accessibilityRole="header">{t('dashboard.charts.heading')}</Heading>
          <Body>{t('dashboard.charts.intro')}</Body>
        </View>
      </FadeUp>
      <FadeUp index={1}>
        <View style={styles.section}>
          <Subheading accessibilityRole="header">{t('dashboard.charts.trendHeading')}</Subheading>
          <TrendSection state={trend} onRetry={() => void trendQuery.refetch()} retrying={trendQuery.isFetching} />
        </View>
      </FadeUp>
      <ContentSheet title={t('dashboard.charts.splitHeading')} testID="split-sheet">
        <SplitSection state={split} onRetry={() => void breakdownQuery.refetch()} retrying={breakdownQuery.isFetching} />
      </ContentSheet>
    </Screen>
  );
}

const EDGES = ['left', 'right', 'bottom'] as const;

/** The words for a section that could not be read. */
function useFailure(notGranted: string, unavailable: string) {
  const t = useT();
  return (state: { readonly kind: 'unreachable' } | { readonly kind: 'failed'; readonly refusal: Refusal }) => {
    if (state.kind === 'unreachable') return t('mobile.offline.nothingCached');
    const words: Record<Refusal, string> = {
      signedOut: t('dashboard.failures.signedOut'),
      notGranted,
      noCampaign: t('dashboard.failures.noCampaign'),
      unavailable,
    };
    return words[state.refusal];
  };
}

interface SectionProps<T> {
  readonly state: SectionState<T>;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}

function Failure({ description, onRetry, retrying, testID }: {
  readonly description: string;
  readonly onRetry: () => void;
  readonly retrying: boolean;
  readonly testID: string;
}) {
  const t = useT();
  return (
    <InlineAlert
      variant="danger"
      description={description}
      action={<Pill size="sm" variant="ghost" label={t('common.tryAgain')} busy={retrying} onPress={onRetry} />}
      testID={testID}
    />
  );
}

function TrendSection({ state, onRetry, retrying }: SectionProps<Trend>) {
  const t = useT();
  const locale = useLocale();
  const failure = useFailure(t('dashboard.charts.trendNotGranted'), t('dashboard.charts.trendUnavailable'));

  if (state.kind === 'loading') {
    return (
      <SkeletonGroup label={t('dashboard.charts.trendLoading')} testID="trend-loading">
        <Skeleton height={TREND_PLACEHOLDER} radius="lg" />
      </SkeletonGroup>
    );
  }
  if (state.kind !== 'ready') {
    return <Failure description={failure(state)} onRetry={onRetry} retrying={retrying} testID="trend-failed" />;
  }

  const trend = state.data;
  if (trend.days.length === 0) {
    return <Body testID="trend-empty">{t('dashboard.charts.trendEmpty', { from: trend.from, to: trend.to })}</Body>;
  }
  return (
    <View style={styles.section}>
      <TrendChart trend={trend} />
      {trend.computedAt === undefined ? null : (
        <Body>{t('dashboard.charts.aggregated', { when: relativeTime(trend.computedAt, new Date(), locale) })}</Body>
      )}
      <DailyFigures days={trend.days} />
    </View>
  );
}

function SplitSection({ state, onRetry, retrying }: SectionProps<Breakdown>) {
  const t = useT();
  const locale = useLocale();
  const failure = useFailure(t('dashboard.charts.splitNotGranted'), t('dashboard.charts.splitUnavailable'));

  if (state.kind === 'loading') {
    return (
      <SkeletonGroup label={t('dashboard.charts.splitLoading')} testID="split-loading">
        <Skeleton height={SPLIT_PLACEHOLDER} radius="lg" />
      </SkeletonGroup>
    );
  }
  if (state.kind !== 'ready') {
    return <Failure description={failure(state)} onRetry={onRetry} retrying={retrying} testID="split-failed" />;
  }

  const breakdown = state.data;
  const backerCount = breakdown.backerCount ?? 0;
  if (backerCount === 0) return <Body testID="split-empty">{t('dashboard.charts.splitEmpty')}</Body>;

  const currency = breakdown.currency ?? breakdown.total?.currency ?? '';
  const rewards: ShareRow[] = (breakdown.rewards ?? []).map((slice, index) => ({
    key: slice.rewardTierId ?? `tier-${index}`,
    // A tier the campaign has since removed keeps its pledges and loses its name.
    label: slice.title ?? t('dashboard.charts.removedTier'),
    backerCount: slice.backerCount ?? 0,
    amount: moneyOf(slice.amount, currency),
  }));
  const countries: ShareRow[] = (breakdown.countries ?? []).map((slice, index) => ({
    key: slice.country ?? `none-${index}`,
    // The code as it stands: the platform has no country vocabulary to translate it with.
    label: slice.country ?? t('dashboard.charts.noDestination'),
    backerCount: slice.backerCount ?? 0,
    amount: moneyOf(slice.amount, currency),
  }));

  return (
    <View style={styles.split}>
      <StatRow>
        <StatBlock size="md" label={t('dashboard.charts.backers')} value={formatCount(backerCount, locale)} />
        <StatBlock
          size="md"
          label={t('dashboard.charts.pledged')}
          value={breakdown.total === undefined ? t('dashboard.charts.nothingYet') : formatMoney(breakdown.total)}
        />
      </StatRow>

      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('dashboard.charts.rewardHeading')}</CardTitle>
        {rewards.length === 0 ? (
          <Body>{t('dashboard.charts.rewardEmpty')}</Body>
        ) : (
          <>
            <ShareBars rows={rewards} label={t('dashboard.charts.rewardLabel')} testID="rewards" />
            <Body>{t('dashboard.charts.rewardNote')}</Body>
          </>
        )}
      </View>

      <View style={styles.section}>
        <CardTitle accessibilityRole="header">{t('dashboard.charts.destinationHeading')}</CardTitle>
        <ShareBars rows={countries} label={t('dashboard.charts.destinationLabel')} testID="destinations" />
        <Body>{t('dashboard.charts.destinationNote')}</Body>
      </View>
    </View>
  );
}

/** A slice's amount, or a zero in the campaign's currency when the service sent none. */
function moneyOf(amount: Money | undefined, currency: string): Money {
  return amount ?? { amount: '0.00', currency };
}

const styles = StyleSheet.create({
  header: { gap: spacing[2], paddingTop: spacing[4] },
  section: { gap: spacing[3] },
  split: { gap: spacing[6] },
});
