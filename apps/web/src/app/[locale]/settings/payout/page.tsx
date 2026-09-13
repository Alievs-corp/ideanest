import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { PayoutDetailsPanel } from '../../../../components/settings/PayoutDetailsPanel';
import { payoutPanelCopy } from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';

/**
 * The creator's payout details — IDN-EXT-01 (#44).
 *
 * The spec's "VÖEN page": opened when a creator withdraws, and reachable from the account's settings
 * afterwards. Neither is asked for when a campaign is created or reviewed; they are asked for before
 * money is sent, and the payout waits for them. A Server Component that renders a client panel and
 * fetches nothing, like every settings page: the reads carry a bearer token.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.payout');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PayoutSettingsPage() {
  const t = await getTranslations('settings.pages.payout');

  return (
    <>
      <AccountPageHeader title={t('title')}>{t('intro')}</AccountPageHeader>

      <div className="mt-8">
        <PayoutDetailsPanel copy={await payoutPanelCopy()} />
      </div>
    </>
  );
}
