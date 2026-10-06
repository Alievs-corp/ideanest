import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { CardTitle, IconButton, Meta, Sheet, Tag } from '../../components/ui';
import { Glyphs } from '../../icons';
import { queryKeys } from '../../api/queries';
import { useT, type MessageKey } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { spacing } from '../../theme';
import { NavRow, RowGroup } from '../settings/settings-row';
import { AccountList, AccountRow, RowPlaceholder } from './account-list';
import { listMyProjects, type MyCampaign } from './api';
import {
  dashboardHref,
  type CampaignHref,
  editorHref,
  hasLaunched,
  isPubliclyVisible,
  myCampaignHref,
} from './campaign-routes';
import { useCursorList } from './use-cursor-list';

/**
 * My campaigns — the web's `MyCampaignsPanel` (#159): every campaign this account started.
 *
 * <p>A row opens what `myCampaignHref` names: the public page for a campaign in a public state,
 * otherwise the editor, the only address a draft has. Its state is a word in a neutral tag, never
 * a colour, with "Not published yet" under the title of one that is not public.
 *
 * <p>"More actions" opens a sheet with the editor for every campaign and, for one that has launched
 * (the web's `hasLaunched`, #141), the dashboard — the two links the web's launched row carries.
 * State names come from `admin.screens.campaignDirectory.state`, as on the web: the catalogue has
 * no neutral namespace for all sixteen yet.
 */

const keyOf = (item: MyCampaign) => item.id;

export function useMyCampaigns(enabled: boolean) {
  return useCursorList<MyCampaign>({
    queryKey: queryKeys.myProjects(),
    enabled,
    read: listMyProjects,
    keyOf,
  });
}

export function MyCampaignsList() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();
  const list = useMyCampaigns(signedIn);
  const [acting, setActing] = useState<MyCampaign | null>(null);

  const stateLabel = useCallback(
    (state: string) => {
      const key = `admin.screens.campaignDirectory.state.${state}` as MessageKey;
      return t.has(key) ? t(key) : state;
    },
    [t],
  );

  const renderRow = useCallback(
    (campaign: MyCampaign) => {
      const title = campaign.title || t('mobile.campaign.untitled');
      const state = stateLabel(campaign.state);
      const draft = !isPubliclyVisible(campaign.state);
      return (
        <AccountRow
          label={[title, draft ? t('account.pages.campaigns.draftHint') : null, state]
            .filter((part) => part !== null)
            .join(', ')}
          testID={`campaign-row-${campaign.id}`}
          onPress={() => router.push(myCampaignHref(campaign))}
          trailing={
            <IconButton
              icon={Glyphs.More}
              variant="ghost"
              label={fillPlaceholders(String(t.raw('mobile.account.moreActions')), { title })}
              onPress={() => setActing(campaign)}
              testID={`campaign-actions-${campaign.id}`}
            />
          }
        >
          <CardTitle>{title}</CardTitle>
          {draft ? <Meta>{t('account.pages.campaigns.draftHint')}</Meta> : null}
          <View style={styles.state}>
            <Tag label={state} />
          </View>
        </AccountRow>
      );
    },
    [router, stateLabel, t],
  );

  const go = (href: CampaignHref) => {
    setActing(null);
    router.push(href);
  };

  return (
    <>
      <AccountList
        list={list}
        signedIn={signedIn}
        path="/account/campaigns"
        title={t('account.pages.campaigns.title')}
        intro={t('account.pages.campaigns.intro')}
        signedOutTitle={t('mobile.account.campaigns.signedOutTitle')}
        signedOutBody={t('mobile.account.campaigns.signedOutBody')}
        loadingLabel={t('account.pages.campaigns.loadingList')}
        failedTitle={t('account.pages.campaigns.loadFailed')}
        staleNotice={t('mobile.account.campaigns.stale')}
        empty={{
          icon: Glyphs.FolderOpen,
          title: t('account.pages.campaigns.emptyTitle'),
          body: t('account.pages.campaigns.emptyBody'),
          actionLabel: t('account.pages.campaigns.startCampaign'),
          onAction: () => router.push('/campaigns/new'),
        }}
        placeholder={<RowPlaceholder />}
        keyOf={keyOf}
        renderRow={renderRow}
        testID="campaigns-list"
      />
      <Sheet
        visible={acting !== null}
        onClose={() => setActing(null)}
        title={acting === null ? '' : acting.title || t('mobile.campaign.untitled')}
        testID="campaign-actions-sheet"
      >
        {acting === null ? null : (
          <RowGroup>
            <NavRow
              label={t('account.pages.campaigns.edit')}
              icon={Glyphs.Edit2}
              onPress={() => go(editorHref(acting.id))}
              testID="campaign-action-edit"
            />
            {hasLaunched(acting.state) ? (
              <NavRow
                label={t('account.pages.campaigns.dashboard')}
                icon={Glyphs.StatusUp}
                onPress={() => go(dashboardHref(acting.id))}
                testID="campaign-action-dashboard"
              />
            ) : null}
          </RowGroup>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // Below the title on a phone, as the web has it below `sm`.
  state: { flexDirection: 'row', paddingTop: spacing[1] },
});
