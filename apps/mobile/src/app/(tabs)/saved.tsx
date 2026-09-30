import { Link, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSavedProjects } from '../../api/queries';
import { CardTitle, Meta } from '../../components/text';
import {
  EmptyState,
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * What somebody kept — one of the two lists §4.12 MB-04 promises offline.
 *
 * <h2>The stale case is the feature, not an edge case</h2>
 *
 * `lib/offline.ts` persists this query, so opening the tab on a plane shows the
 * list that was there last time. The screen's job is to be honest about which of
 * the two it is showing, which is what `isStale && isError` answers: data on
 * screen, and a refetch that failed. Without the notice the two are
 * indistinguishable, and the difference matters — the list is what somebody
 * checks before deciding whether they still have time to back something.
 *
 * <h2>No funding figures here, deliberately</h2>
 *
 * `/v1/me/saved` answers titles and slugs and no money, and that is the right
 * shape for a list that can be a week old. A cached percentage would be the one
 * number a backer acts on, shown at whatever it was last Tuesday.
 *
 * <h2>Motion: minimal</h2>
 *
 * A list of campaigns somebody goes back to browse, so it takes discovery's
 * budget from `docs/motion-system.md` §5 rather than checkout's: the placeholders
 * shimmer while the first answer is on its way, and nothing else moves.
 */

const styles = StyleSheet.create({
  content: { padding: size.cardGap, gap: spacing[3] },
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[2],
    minHeight: size.touchTarget,
  },
  pressed: { backgroundColor: colors.surface3 },
  separator: { height: spacing[3] },
  placeholders: { gap: spacing[3] },
  notice: { paddingBottom: spacing[3] },
});

/** Three rows' worth of placeholder: what a first screen of saved campaigns looks like. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/**
 * The route: its motion budget around every state it can draw — the placeholders, the failure and
 * the empty state, and the list itself — not only the ones `Screen` draws.
 */
export default function SavedScreen() {
  return (
    <MotionBudgetProvider level="minimal">
      <SavedList />
    </MotionBudgetProvider>
  );
}

function SavedList() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();
  const saved = useSavedProjects(signedIn);

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.saved.signedOutTitle')}
            description={t('mobile.saved.signedOutBody')}
            // §17.1: the invitation now has a way to accept it. Until sign-in existed
            // on this platform, this screen could only state the condition.
            action={
              <Pill label={t('shell.actions.signIn')} onPress={() => router.push('/sign-in')} />
            }
          />
        }
      />
    );
  }

  const items = saved.data?.items ?? [];

  /*
   * The web's saved-list sentences; only the offline one is the app's. With nothing to list,
   * `Screen` answers in its fixed order: placeholders while the first answer is on its way, the
   * failure with its retry, then "nothing saved yet".
   */
  if (items.length === 0) {
    return (
      <Screen
        hasContent={saved.isLoading}
        error={
          saved.isError
            ? {
                title: t('account.signals.saved.failedTitle'),
                description: t('mobile.offline.nothingCached'),
                onRetry: () => void saved.refetch(),
                retrying: saved.isFetching,
              }
            : null
        }
        empty={
          <EmptyState
            title={t('account.signals.saved.emptyTitle')}
            description={t('account.signals.saved.emptyBody')}
          />
        }
      >
        <SkeletonGroup label={t('account.signals.saved.loading')}>
          <View style={styles.placeholders}>
            {PLACEHOLDER_ROWS.map((row) => (
              <View key={row} style={styles.row}>
                <Skeleton height={18} width="70%" />
                <Skeleton height={12} width="35%" />
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
      keyExtractor={(item) => item.projectId ?? ''}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        // Shown only when a refetch actually failed. A cache being used while
        // the network is fine is not worth a banner.
        // A warning read in its place, not announced: the offline banner already said it once.
        saved.isError ? (
          <View style={styles.notice}>
            <InlineAlert
              variant="warning"
              politeness="polite"
              description={t('mobile.saved.stale')}
            />
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <Link
          href={{
            pathname: '/projects/[creatorSlug]/[projectSlug]',
            params: {
              creatorSlug: item.creatorSlug ?? '',
              projectSlug: item.projectSlug ?? '',
            },
          }}
          asChild
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={item.title ?? t('mobile.campaign.untitled')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <CardTitle numberOfLines={2}>{item.title ?? t('mobile.campaign.untitled')}</CardTitle>
            <Meta>{item.creatorSlug ?? ''}</Meta>
          </Pressable>
        </Link>
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
