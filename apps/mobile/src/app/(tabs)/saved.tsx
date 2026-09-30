import { Link, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSavedProjects } from '../../api/queries';
import { Button } from '../../components/form';
import { EmptyState, ErrorState, Loading, OfflineNotice } from '../../components/states';
import { CardTitle, Meta } from '../../components/text';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * What somebody kept — one of the two lists issue #115 promises offline.
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
});

export default function SavedScreen() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();
  const saved = useSavedProjects(signedIn);

  if (!signedIn) {
    return (
      <EmptyState
        title={t('mobile.saved.signedOutTitle')}
        detail={t('mobile.saved.signedOutBody')}
        // #29: the invitation now has a way to accept it. Until sign-in existed
        // on this platform, this screen could only state the condition.
        action={
          <Button label={t('shell.actions.signIn')} onPress={() => router.push('/sign-in')} />
        }
      />
    );
  }

  const items = saved.data?.items ?? [];

  // The web's saved-list sentences; only the offline one is the app's.
  if (items.length === 0) {
    if (saved.isLoading) return <Loading label={t('account.signals.saved.loading')} />;
    if (saved.isError) {
      return (
        <ErrorState
          title={t('account.signals.saved.failedTitle')}
          detail={t('mobile.offline.nothingCached')}
        />
      );
    }
    return (
      <EmptyState
        title={t('account.signals.saved.emptyTitle')}
        detail={t('account.signals.saved.emptyBody')}
      />
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
        saved.isError ? (
          <OfflineNotice detail={t('mobile.saved.stale')} />
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
