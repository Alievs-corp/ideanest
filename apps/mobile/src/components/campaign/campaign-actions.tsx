import { useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Bookmark, BookmarkCheck, Check, Share2 } from 'lucide-react-native';
import type { ProjectState } from '@ideanest/campaign/states';
import { queryKeys } from '../../api/queries';
import {
  actionFailureOf,
  forgetMe,
  remindMe,
  saveCampaign,
  unsaveCampaign,
} from '../../lib/campaign-actions';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { Pill, announce, haptics } from '../ui';

/**
 * Block 8 — the web's `CampaignActions` (#155): Save, Share and, before launch, Remind me.
 *
 * <h2>Save starts off, because nothing says otherwise yet</h2>
 *
 * There is no per-campaign "have I saved this" until #137's viewer read lands, and walking the
 * paginated `/v1/me/saved` to guess would be slow and wrong for anybody with more than a page of
 * saves. So, as on the web, the control offers the action. The write is idempotent — saving a
 * saved campaign is the same success — so the worst case is being told, truly, that it is saved.
 *
 * <p>Pressed, it flips at once and asks; the service's `saved` decides what it settles on, and a
 * refusal flips it back with the reason. A success invalidates the Saved tab's list so it is
 * current the next time it is opened.
 *
 * <h2>Signed out</h2>
 *
 * Save opens sign-in, which closes back to this screen. Remind opens the campaign's pre-launch
 * page, whose form takes an address — the web's arrangement: one place collects addresses, and
 * it is the one that is rate limited per address.
 *
 * <h2>Offline</h2>
 *
 * Save and Remind are disabled, and the line under the row says why. Share still works: the
 * sheet only needs the link, and the person it is sent to has a connection of their own.
 *
 * <h2>One line says what happened</h2>
 *
 * Each control finishes somewhere the reader cannot see — a list on another tab, the system share
 * sheet, a mail that will arrive one day — so the result is a sentence under the row, kept in its
 * place with a reserved height so the page does not jump, and announced politely. A dismissed
 * share sheet says nothing: closing it is not a failure.
 */
export interface CampaignActionsProps {
  readonly projectId: string;
  readonly state: ProjectState;
  readonly title: string;
  /** The https address the share sheet sends (`shareUrlFor`). */
  readonly shareUrl: string;
  /** No connection: the two writes are disabled and the notice says why. */
  readonly offline: boolean;
}

type Busy = 'save' | 'remind' | null;

export function CampaignActions({ projectId, state, title, shareUrl, offline }: CampaignActionsProps) {
  const t = useT('campaign.actions');
  const tAll = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signedIn } = useSession();

  const [saved, setSaved] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const say = (message: string) => {
    setNotice(message);
    // Android reads the live region below; iOS has none, so it is said once here.
    if (Platform.OS === 'ios') announce(message);
  };

  const failure = (cause: unknown): string => {
    const reason = actionFailureOf(cause);
    switch (reason.kind) {
      case 'signIn':
        return t('failures.signIn');
      case 'detail':
        return reason.text;
      case 'notSaved':
        return t('failures.notSaved');
      case 'unreachable':
        return t('failures.unreachable');
    }
  };

  const toggleSave = async () => {
    if (!signedIn) {
      router.push('/sign-in');
      return;
    }
    if (busy !== null) return;
    const was = saved;
    haptics.save();
    setBusy('save');
    setSaved(!was);
    setNotice(null);
    try {
      const now = was ? await unsaveCampaign(projectId) : await saveCampaign(projectId);
      setSaved(now);
      say(
        was && !now
          ? t('notices.removed', { title })
          : now
            ? t('notices.saved', { title })
            : t('notices.notSaved', { title }),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.saved() });
    } catch (cause) {
      setSaved(was);
      say(failure(cause));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    try {
      // The https address, never `ideanest://`: the person it is sent to may not have the app.
      const result = await Share.share({ message: `${title} — ${shareUrl}`, url: shareUrl, title });
      if (result.action === Share.dismissedAction) return;
      setShared(true);
      say(t('notices.shared'));
    } catch {
      say(tAll('mobile.campaign.shareFailed'));
    }
  };

  const toggleRemind = async () => {
    if (!signedIn) {
      router.push({ pathname: '/campaigns/[id]/prelaunch', params: { id: projectId } });
      return;
    }
    if (busy !== null) return;
    const was = reminding;
    setBusy('remind');
    setReminding(!was);
    setNotice(null);
    try {
      if (was) await forgetMe(projectId);
      else await remindMe(projectId);
      say(was ? t('notices.remindOff') : t('notices.remindOn'));
    } catch (cause) {
      setReminding(was);
      say(failure(cause));
    } finally {
      setBusy(null);
    }
  };

  const offlineReason = tAll('mobile.campaign.actionsOffline');

  return (
    <View style={styles.column}>
      <View style={styles.row}>
        <Pill
          label={saved ? t('saved') : t('save')}
          accessibilityLabel={saved ? t('savedLabel', { title }) : t('saveLabel', { title })}
          accessibilityHint={offline ? offlineReason : undefined}
          selected={saved}
          iconLeft={saved ? BookmarkCheck : Bookmark}
          variant="ghost"
          size="sm"
          disabled={offline}
          busy={busy === 'save'}
          onPress={() => void toggleSave()}
          testID="action-save"
        />
        <Pill
          label={t('share')}
          accessibilityLabel={t('shareLabel', { title })}
          iconLeft={shared ? Check : Share2}
          variant="ghost"
          size="sm"
          onPress={() => void share()}
          testID="action-share"
        />
        {state === 'PRELAUNCH' ? (
          <Pill
            label={reminding ? t('reminderSet') : t('remind')}
            accessibilityLabel={
              reminding ? t('remindingLabel', { title }) : t('remindLabel', { title })
            }
            accessibilityHint={offline ? offlineReason : undefined}
            selected={reminding}
            iconLeft={reminding ? BellOff : Bell}
            variant="ghost"
            size="sm"
            disabled={offline}
            busy={busy === 'remind'}
            onPress={() => void toggleRemind()}
            testID="action-remind"
          />
        ) : null}
      </View>

      {/*
        Always mounted, so Android's live region exists before it has anything to say — a region
        mounted at the moment of the announcement is one TalkBack does not read. Offline, the
        reason the writes are disabled stands here until something else is said.
      */}
      <Text
        accessibilityLiveRegion="polite"
        style={styles.notice}
        testID="actions-notice"
      >
        {notice ?? (offline ? offlineReason : '')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  notice: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    minHeight: lineHeight.small,
    color: colors.textSecondary,
  },
});
