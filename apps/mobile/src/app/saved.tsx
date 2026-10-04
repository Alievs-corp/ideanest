import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSavedProjects } from '../api/queries';
import { FIRST_SCREENFUL, FadeUp } from '../components/motion';
import { CardTitle, Meta } from '../components/text';
import {
  Card,
  EmptyState,
  Icon,
  InlineAlert,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  TONES,
} from '../components/ui';
import { Glyphs } from '../icons';
import { useT } from '../lib/i18n';
import { useSession } from '../lib/use-session';
import { spacing } from '../theme';

/**
 * What somebody kept — one of the two lists §4.12 MB-04 promises offline.
 *
 * A row of the Me hub since #276, not a tab: the floating bar has five slots and Saved is the
 * destination the `mobile-design` skill's overflow rule moves into Me. `/saved` and the web's
 * `/account/saved` both still land here.
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
 * <h2>Motion</h2>
 *
 * The `mobile-design` skill §6: the placeholders shimmer while the first answer
 * is on its way, the first screenful of rows rises in once on mount (§6.5) — rows the list
 * draws later, as it scrolls or refetches, never do — and each row, a raised `Card` on the
 * canvas, gives under the thumb.
 */

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rowText: { flex: 1, gap: spacing[1] },
  placeholder: { gap: spacing[2] },
  separator: { height: spacing[3] },
  placeholders: { gap: spacing[3] },
  notice: { paddingBottom: spacing[3] },
});

/** Three rows' worth of placeholder: what a first screen of saved campaigns looks like. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/**
 * The route: every state it can draw — the placeholders, the failure and the empty state, and the
 * list itself — not only the ones `Screen` draws.
 */
export default function SavedScreen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('account.links.saved.label') }} />
      <SavedList />
    </>
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
              <Card key={row} size="sm">
                <View style={styles.placeholder}>
                  <Skeleton height={18} width="70%" />
                  <Skeleton height={12} width="35%" />
                </View>
              </Card>
            ))}
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  return <SavedRows items={items} stale={saved.isError} />;
}

type SavedItem = NonNullable<NonNullable<ReturnType<typeof useSavedProjects>['data']>['items']>[number];

/**
 * The list, mounted once there is something in it. The projects in it on that first draw are the
 * ones that may rise in (`mobile-design` §6.5), each once: a row FlashList draws later — scrolled
 * to, appended by a refetch, or a recycled cell coming back into view — renders still.
 */
function SavedRows({ items, stale }: { readonly items: readonly SavedItem[]; readonly stale: boolean }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [first] = useState<ReadonlySet<string>>(
    () => new Set(items.map((item) => item.projectId ?? '')),
  );
  const played = useRef(new Set<string>());

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.projectId ?? ''}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing[6] }]}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        // Shown only when a refetch actually failed. A cache being used while
        // the network is fine is not worth a banner.
        // A warning read in its place, not announced: the offline banner already said it once.
        stale ? (
          <View style={styles.notice}>
            <InlineAlert
              variant="warning"
              politeness="polite"
              description={t('mobile.saved.stale')}
            />
          </View>
        ) : undefined
      }
      renderItem={({ item, index }) => (
        <SavedRow item={item} index={index} first={first} played={played.current} />
      )}
    />
  );
}

function SavedRow({
  item,
  index,
  first,
  played,
}: {
  readonly item: SavedItem;
  readonly index: number;
  readonly first: ReadonlySet<string>;
  readonly played: Set<string>;
}) {
  const router = useRouter();
  const t = useT();
  const key = item.projectId ?? '';
  // Frozen when this cell mounts: a recycled cell keeps its wrapper and never rises again.
  const [entry] = useState(() => (first.has(key) && !played.has(key) ? index : FIRST_SCREENFUL));
  useEffect(() => {
    played.add(key);
  }, [key, played]);

  const title = item.title ?? t('mobile.campaign.untitled');
  const row = (
    <Card
      size="sm"
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() =>
        router.push({
          pathname: '/projects/[creatorSlug]/[projectSlug]',
          params: {
            creatorSlug: item.creatorSlug ?? '',
            projectSlug: item.projectSlug ?? '',
          },
        })
      }
    >
      <View style={styles.row}>
        <View style={styles.rowText}>
          <CardTitle numberOfLines={2}>{title}</CardTitle>
          <Meta>{item.creatorSlug ?? ''}</Meta>
        </View>
        <Icon icon={Glyphs.ArrowRight2} size={18} color={TONES.dark.tertiary} />
      </View>
    </Card>
  );
  return <FadeUp index={entry}>{row}</FadeUp>;
}

function Separator() {
  return <View style={styles.separator} />;
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
