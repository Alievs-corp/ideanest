import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { Avatar, CardTitle, InlineAlert, Meta, Pill } from '../../components/ui';
import { Glyphs } from '../../icons';
import { queryKeys } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { spacing } from '../../theme';
import { relativeTime } from '../settings/sessions/relative-time';
import { AccountList, AccountRow, RowPlaceholder } from './account-list';
import { listFollowing, unfollowCreator, type FollowedCreator } from './api';
import { useCursorList } from './use-cursor-list';

/**
 * Following — the web's `FollowingPanel` (#159).
 *
 * <p>Each row opens the creator's profile, `u/[slug]`, as the web's rows link to `/u/{slug}` since
 * #143; a hidden profile answers 404 and that screen says so. The avatar is initials: the list
 * carries a name and a slug and no picture.
 *
 * <p><strong>Unfollow</strong> is optimistic and comes back at its index when the service refuses,
 * with the web's dismissible "You are still following {name}". Offline it is disabled, with the
 * reason above the list.
 */

const keyOf = (item: FollowedCreator) => item.creatorId;

export function useFollowingList(enabled: boolean) {
  return useCursorList<FollowedCreator>({
    queryKey: queryKeys.following(),
    enabled,
    read: listFollowing,
    keyOf,
  });
}

export function FollowingList() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const { signedIn } = useSession();
  const client = useQueryClient();
  const list = useFollowingList(signedIn);
  const [failure, setFailure] = useState<string | null>(null);

  const { remove } = list;
  const drop = useCallback(
    async (creator: FollowedCreator) => {
      setFailure(null);
      const removal = remove(creator.creatorId);
      try {
        await unfollowCreator(creator.slug);
        removal?.confirm();
        // The creator's profile must not still say "Following" (`profileFollowing`, any viewer).
        void client.invalidateQueries({ queryKey: [...queryKeys.profile(creator.slug), 'following'] });
      } catch {
        removal?.restore();
        setFailure(
          fillPlaceholders(String(t.raw('account.signals.following.removalFailedBody')), {
            name: creator.name,
          }),
        );
      }
    },
    [client, remove, t],
  );

  const renderRow = useCallback(
    (creator: FollowedCreator) => {
      const meta = fillPlaceholders(String(t.raw('account.signals.following.meta')), {
        creator: creator.slug,
        // Against the clock when the row is drawn, not when the screen opened.
        time: relativeTime(creator.followedAt, new Date(), locale),
      });
      return (
        <AccountRow
          label={`${creator.name}, ${meta}`}
          testID={`following-row-${creator.creatorId}`}
          onPress={() => router.push({ pathname: '/u/[slug]', params: { slug: creator.slug } })}
          trailingPlacement="below"
          trailing={
            <Pill
              variant="ghost"
              size="sm"
              label={t('account.signals.following.remove')}
              accessibilityLabel={fillPlaceholders(String(t.raw('account.signals.following.removeLabel')), {
                name: creator.name,
              })}
              disabled={!online}
              onPress={() => void drop(creator)}
            />
          }
        >
          <View style={styles.identity}>
            {/* Decorative: the name is written beside it. */}
            <Avatar name={creator.name} size="md" decorative />
            <View style={styles.text}>
              <CardTitle>{creator.name}</CardTitle>
              <Meta>{meta}</Meta>
            </View>
          </View>
        </AccountRow>
      );
    },
    [drop, locale, online, router, t],
  );

  return (
    <AccountList
      list={list}
      signedIn={signedIn}
      path="/account/following"
      title={t('account.pages.following.title')}
      intro={t('account.pages.following.intro')}
      signedOutTitle={t('mobile.account.following.signedOutTitle')}
      signedOutBody={t('mobile.account.following.signedOutBody')}
      loadingLabel={t('account.signals.following.loading')}
      failedTitle={t('account.signals.following.failedTitle')}
      staleNotice={t('mobile.account.following.stale')}
      empty={{
        icon: Glyphs.UserAdd,
        title: t('account.signals.following.emptyTitle'),
        body: t('account.signals.following.emptyBody'),
        actionLabel: t('account.signals.following.emptyAction'),
        onAction: () => router.push('/discover'),
      }}
      notices={
        <>
          {failure === null ? null : (
            <InlineAlert
              variant="danger"
              title={t('account.signals.following.removalFailedTitle')}
              description={failure}
              onDismiss={() => setFailure(null)}
              testID="following-removal-failed"
            />
          )}
          {online ? null : (
            <InlineAlert variant="info" description={t('mobile.account.following.offline')} />
          )}
        </>
      }
      placeholder={<RowPlaceholder lead />}
      keyOf={keyOf}
      renderRow={renderRow}
      testID="following-list"
    />
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  text: { flex: 1, gap: spacing[1] },
});
