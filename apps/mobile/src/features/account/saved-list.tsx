import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { CardTitle, InlineAlert, Meta, Pill } from '../../components/ui';
import { Glyphs } from '../../icons';
import { queryKeys } from '../../api/queries';
import { unsaveCampaign } from '../../lib/campaign-actions';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { relativeTime } from '../settings/sessions/relative-time';
import { AccountList, AccountRow, RowPlaceholder } from './account-list';
import { listSaved, type SavedCampaign } from './api';
import { useCursorList } from './use-cursor-list';

/**
 * Saved projects — the web's `SavedProjectsPanel` (#159), the Me hub's Saved row.
 *
 * <p>`lib/offline.ts` persists the list (`saved` root), so it opens on a plane with what was there
 * last time and says so when a refresh fails. `/v1/me/saved` answers titles, slugs and when, and
 * no money: a cached percentage would be the one number a backer acts on, a week old.
 *
 * <p><strong>Remove</strong> is optimistic: the row leaves the cache at once — the persisted copy
 * with it — and `DELETE /v1/projects/{id}/save` runs. A failure puts the row back at its index and
 * says so in a dismissible alert. Offline the button is disabled and the reason is written above
 * the list: the change is not queued.
 */

const keyOf = (item: SavedCampaign) => item.projectId;

export function useSavedList(enabled: boolean) {
  const client = useQueryClient();
  // The single-page list this replaced was cached at exactly `['saved']`; nothing reads it now.
  useEffect(() => {
    client.removeQueries({ queryKey: queryKeys.saved(), exact: true });
  }, [client]);
  return useCursorList<SavedCampaign>({
    queryKey: queryKeys.savedList(),
    enabled,
    read: listSaved,
    keyOf,
  });
}

export function SavedList() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const { signedIn } = useSession();
  const list = useSavedList(signedIn);
  const [failure, setFailure] = useState<string | null>(null);

  const { remove } = list;
  const drop = useCallback(
    async (campaign: SavedCampaign) => {
      setFailure(null);
      const removal = remove(campaign.projectId);
      try {
        await unsaveCampaign(campaign.projectId);
        removal?.confirm();
      } catch {
        removal?.restore();
        setFailure(
          fillPlaceholders(String(t.raw('account.signals.saved.removalFailedBody')), {
            name: campaign.title,
          }),
        );
      }
    },
    [remove, t],
  );

  const renderRow = useCallback(
    (campaign: SavedCampaign) => {
      const title = campaign.title || t('mobile.campaign.untitled');
      const meta = fillPlaceholders(String(t.raw('account.signals.saved.meta')), {
        // Against the clock when the row is drawn: a frozen "now" calls a later save "in 3 minutes".
        time: relativeTime(campaign.savedAt, new Date(), locale),
        creator: campaign.creatorSlug,
      });
      return (
        <AccountRow
          label={`${title}, ${meta}`}
          testID={`saved-row-${campaign.projectId}`}
          onPress={() =>
            router.push({
              pathname: '/projects/[creatorSlug]/[projectSlug]',
              params: { creatorSlug: campaign.creatorSlug, projectSlug: campaign.projectSlug },
            })
          }
          trailingPlacement="below"
          trailing={
            <Pill
              variant="ghost"
              size="sm"
              label={t('account.signals.saved.remove')}
              accessibilityLabel={fillPlaceholders(String(t.raw('account.signals.saved.removeLabel')), {
                name: title,
              })}
              disabled={!online}
              onPress={() => void drop(campaign)}
            />
          }
        >
          <CardTitle>{title}</CardTitle>
          <Meta>{meta}</Meta>
        </AccountRow>
      );
    },
    [drop, locale, online, router, t],
  );

  return (
    <AccountList
      list={list}
      signedIn={signedIn}
      path="/saved"
      title={t('account.pages.saved.title')}
      intro={t('account.pages.saved.intro')}
      signedOutTitle={t('mobile.saved.signedOutTitle')}
      signedOutBody={t('mobile.saved.signedOutBody')}
      loadingLabel={t('account.signals.saved.loading')}
      failedTitle={t('account.signals.saved.failedTitle')}
      staleNotice={t('mobile.saved.stale')}
      empty={{
        icon: Glyphs.Bookmark,
        title: t('account.signals.saved.emptyTitle'),
        body: t('account.signals.saved.emptyBody'),
        actionLabel: t('common.browseCampaigns'),
        onAction: () => router.push('/discover'),
      }}
      notices={
        <>
          {failure === null ? null : (
            <InlineAlert
              variant="danger"
              title={t('account.signals.saved.removalFailedTitle')}
              description={failure}
              onDismiss={() => setFailure(null)}
              testID="saved-removal-failed"
            />
          )}
          {online ? null : (
            <InlineAlert variant="info" description={t('mobile.account.saved.offline')} />
          )}
        </>
      }
      placeholder={<RowPlaceholder />}
      keyOf={keyOf}
      renderRow={renderRow}
      testID="saved-list"
    />
  );
}
