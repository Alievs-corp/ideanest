import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { queryKeys } from '../../api/queries';
import { Glyphs } from '../../icons';
import { canReadAccount, useMe } from '../../lib/account';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, font, fontSize, lineHeight } from '../../theme';
import { Pill, announce, haptics } from '../../components/ui';
import { ProfileHeader } from './profile-header';
import { setFollowing, useFollowing } from './api';
import type { PublicProfile } from './wire';

/**
 * The profile's header with Follow beside the name — the web's `FollowControl` (#143, #156).
 *
 * <h2>Three readers, three shapes</h2>
 *
 * <ul>
 *   <li><strong>Signed out</strong> — the Follow pill opens sign-in, which returns here.
 *   <li><strong>The account the page is about</strong> — nothing: following yourself is a 400.
 *   <li><strong>Anybody else</strong> — the toggle, starting from what `GET /v1/me/following`
 *       says. While that (or who is signed in) is still being read it is drawn disabled, reading
 *       "Follow". With the app lock armed and nothing unlocked, it is offered as Follow: pressing it
 *       is what unlocks, and the write is idempotent.
 * </ul>
 *
 * <p>The word on the pill is inside its name ("Follow Aysel", `profile.follow.accessibleName`), the
 * state is `selected` and a changed icon and word, and what happened is a sentence under the row,
 * in a live region that is always mounted (iOS is told once with `announce`). Offline the pill is
 * disabled and the sentence says why. The result is written to the shared query, so the header of
 * every tab (each tab's list draws its own) shows the same state.
 */
export function ProfileIdentity({
  profile,
  offline,
}: {
  readonly profile: PublicProfile;
  readonly offline: boolean;
}) {
  const session = useSession();
  const me = useMe();
  const viewer = typeof me.data?.slug === 'string' && me.data.slug !== '' ? me.data.slug : null;

  // Keyed by the person and the reader, so neither one's state is carried onto the other.
  return (
    <FollowingHeader
      key={`${profile.slug}:${viewer ?? ''}`}
      profile={profile}
      offline={offline}
      signedOut={!session.signedIn || me.data === null}
      lockedOut={session.signedIn && !canReadAccount(session)}
      viewer={viewer}
    />
  );
}

function FollowingHeader({
  profile,
  offline,
  signedOut,
  lockedOut,
  viewer,
}: {
  readonly profile: PublicProfile;
  readonly offline: boolean;
  readonly signedOut: boolean;
  readonly lockedOut: boolean;
  readonly viewer: string | null;
}) {
  const t = useT('profile.follow');
  const tAll = useT();
  const router = useRouter();
  const client = useQueryClient();
  const { slug, name } = profile;
  const self = viewer !== null && viewer === slug;
  const known = useFollowing(slug, viewer, !signedOut && !self && !offline);

  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const following = lockedOut ? false : (known.data ?? null);
  const offlineReason = tAll('mobile.profile.followOffline');
  const named = (word: string) => t('accessibleName', { action: word, name });

  const say = (message: string) => {
    setNotice(message);
    if (Platform.OS === 'ios') announce(message);
  };

  const toggle = async () => {
    if (inFlight.current || following === null) return;
    inFlight.current = true;
    const was = following;
    haptics.save();
    setBusy(true);
    setNotice(null);
    try {
      const now = await setFollowing(slug, !was);
      if (viewer !== null) client.setQueryData(queryKeys.profileFollowing(slug, viewer), now);
      void client.invalidateQueries({ queryKey: queryKeys.following() });
      say(now ? t('followed', { name }) : t('unfollowed', { name }));
    } catch (cause) {
      say(failureOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const failureOf = (cause: unknown): string => {
    if (cause instanceof ApiError) {
      if (cause.status === 401) return t('signIn');
      const text = cause.problem?.detail ?? cause.problem?.title;
      return text === undefined || text === '' ? t('refused') : text;
    }
    return t('unreachable');
  };

  let control = null;
  if (signedOut) {
    control = (
      <Pill
        label={t('follow')}
        accessibilityLabel={named(t('follow'))}
        iconLeft={Glyphs.UserAdd}
        variant="outline"
        size="sm"
        onPress={() => router.push(signInHrefFor(`/u/${encodeURIComponent(slug)}`))}
        testID="profile-follow"
      />
    );
  } else if (!self) {
    const on = following === true;
    const word = on ? t('following') : t('follow');
    control = (
      <Pill
        label={word}
        accessibilityLabel={named(word)}
        accessibilityHint={offline ? offlineReason : undefined}
        selected={on}
        iconLeft={on ? Glyphs.UserTick : Glyphs.UserAdd}
        variant={on ? 'ghost' : 'outline'}
        size="sm"
        disabled={offline || following === null || (viewer === null && !lockedOut)}
        busy={busy}
        onPress={() => void toggle()}
        testID="profile-follow"
      />
    );
  }

  return (
    <ProfileHeader
      profile={profile}
      actions={control ?? undefined}
      notice={
        control === null ? undefined : (
          <Text accessibilityLiveRegion="polite" style={styles.notice} testID="profile-follow-notice">
            {notice ?? (offline && !signedOut ? offlineReason : '')}
          </Text>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  notice: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
    textAlign: 'right',
  },
});
