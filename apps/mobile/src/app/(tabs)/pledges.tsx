import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { useLocale } from '../../lib/locale';
import { usePledges } from '../../api/queries';
import { Body, CardTitle, Meta } from '../../components/text';
import {
  EmptyState,
  InlineAlert,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { readablePledgeState } from '../../lib/pledge-states';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * What somebody backed — the other list §4.12 MB-04 promises offline.
 *
 * <h2>Why this one matters most without a connection</h2>
 *
 * A saved campaign is a bookmark. A pledge is a commitment somebody has already
 * made, and the moment they most want to check it — at a fulfilment desk, at a
 * border, on a train — is the moment they are least likely to have signal. The
 * amount and the reward tier are what they need, and both are in the cached
 * response.
 *
 * <h2>The state is shown in words as well as in colour</h2>
 *
 * A pledge that was cancelled and one that is collected are the same shape with
 * different consequences, and CLAUDE.md §2 forbids letting colour carry that on
 * its own.
 *
 * <h2>Motion: none</h2>
 *
 * This is the account's list of money already committed. `docs/motion-system.md`
 * §5 takes motion away as money gets closer, and gives account screens none, so
 * the route declares `none`: the placeholders do not shimmer and nothing fades in.
 */

const styles = StyleSheet.create({
  content: { padding: size.cardGap },
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[2],
  },
  separator: { height: spacing[3] },
  amount: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  placeholders: { gap: spacing[3] },
  notice: { paddingBottom: spacing[3] },
});

/** Three rows' worth of placeholder: what a first screen of pledges looks like. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

export default function PledgesScreen() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();
  const pledges = usePledges(signedIn);
  // Once per render of the screen, not once per row — and above the early return, so the
  // hooks run in the same order signed in and signed out.
  const locale = useLocale();

  if (!signedIn) {
    return (
      <Screen
        motion="none"
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.pledges.signedOutTitle')}
            description={t('mobile.pledges.signedOutBody')}
            action={
              <Pill label={t('shell.actions.signIn')} onPress={() => router.push('/sign-in')} />
            }
          />
        }
      />
    );
  }

  const items = pledges.data?.pledges ?? [];

  /*
   * The web's pledge-list sentences; only the offline one is the app's. With nothing to list, the
   * scaffold decides between them in the order `Screen` fixes — the placeholders while the first
   * answer is on its way, then the failure (with its retry), then "nothing yet".
   */
  if (items.length === 0) {
    return (
      <Screen
        motion="none"
        hasContent={pledges.isLoading}
        error={
          pledges.isError
            ? {
                title: t('account.pledges.list.failedTitle'),
                description: t('mobile.offline.nothingCached'),
                onRetry: () => void pledges.refetch(),
                retrying: pledges.isFetching,
              }
            : null
        }
        empty={
          <EmptyState
            title={t('account.pledges.list.emptyTitle')}
            description={t('account.pledges.list.emptyBody')}
          />
        }
      >
        <SkeletonGroup label={t('account.pledges.list.loading')}>
          <View style={styles.placeholders}>
            {PLACEHOLDER_ROWS.map((row) => (
              <View key={row} style={styles.row}>
                <Skeleton height={18} width="70%" />
                <Skeleton height={14} width="40%" />
                <View style={styles.amount}>
                  <Skeleton height={12} width="30%" />
                  <Skeleton height={12} width="25%" />
                </View>
              </View>
            ))}
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.pledgeId ?? ''}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        /*
         * The cached list, and a refetch that failed: the list stays and says it may be old. A
         * warning to look at, read in its place rather than announced — the global offline banner
         * has already said the connection went (`Screen` explains the same choice).
         */
        pledges.isError ? (
          <View style={styles.notice}>
            <InlineAlert
              variant="warning"
              politeness="polite"
              description={t('mobile.pledges.stale')}
            />
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <CardTitle numberOfLines={2}>
            {item.project?.title ?? t('mobile.campaign.untitled')}
          </CardTitle>
          {item.rewardTitle == null ? null : <Body numberOfLines={1}>{item.rewardTitle}</Body>}
          <View style={styles.amount}>
            <Meta tone="secondary">{formatMoney(item.amounts?.total)}</Meta>
            <Meta>{readablePledgeState(item.state, locale)}</Meta>
          </View>
        </View>
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
