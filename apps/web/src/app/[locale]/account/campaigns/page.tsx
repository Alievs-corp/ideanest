import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import {
  MyCampaignsPanel,
  type MyCampaignsPanelCopy,
} from '../../../../components/account/MyCampaignsPanel';
import { DIRECTORY_STATES } from '../../../../lib/admin/campaigns';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.campaigns');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/account/campaigns` — the campaigns this account has started, drafts included.
 *
 * <p>A shell around a client boundary, like every other account screen: the list is behind a
 * bearer token that lives in memory in the browser, so there is nothing a server render could
 * produce.
 *
 * <p><strong>Copy is resolved here and handed down as props.</strong> Wrapping the panel in
 * `NextIntlClientProvider` would put the catalogue into this route's first load — the
 * regression `lib/i18n` exists to avoid — and this screen is reached from the account
 * navigation, which is on every screen under `/account`.
 */
export default async function MyCampaignsPage() {
  const t = await getTranslations('account.pages.campaigns');
  const states = await getTranslations('admin.screens.campaignDirectory');

  /*
   * The state names are borrowed from the console's campaign directory rather than written
   * again here, for the reason `CampaignPreviewCopy` gives: sixteen state names under a
   * second key is a second set of translations for `CHANGES_REQUESTED` that nothing keeps in
   * step with the first. Built from `DIRECTORY_STATES` so that a state added to §6.1 is a
   * missing key at build time rather than a wire spelling in front of a creator.
   */
  const copy: MyCampaignsPanelCopy = {
    emptyTitle: t('emptyTitle'),
    emptyBody: t('emptyBody'),
    startCampaign: t('startCampaign'),
    loadFailed: t('loadFailed'),
    loadingList: t('loadingList'),
    loadMore: t('loadMore'),
    loadingMore: t('loadingMore'),
    draftHint: t('draftHint'),
    view: t('view'),
    edit: t('edit'),
    dashboard: t('dashboard'),
    actionsLabel: String(t.raw('actionsLabel')),
    states: Object.fromEntries(DIRECTORY_STATES.map((state) => [state, states(`state.${state}`)])),
  };

  return (
    <>
      <AccountPageHeader title={t('title')}>{t('intro')}</AccountPageHeader>

      <div className="mt-8">
        <MyCampaignsPanel copy={copy} />
      </div>
    </>
  );
}
