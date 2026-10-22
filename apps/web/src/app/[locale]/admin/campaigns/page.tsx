import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CampaignDirectory } from '../../../../components/admin/CampaignDirectory';
import { campaignDirectoryCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's campaign directory — what campaigns exist.
 *
 * The console could operate a campaign and could not find one: every route to a campaign
 * started from something the campaign had done — a report filed about it, a submission
 * waiting on a decision, or an identifier a member of staff already had. A draft, or a
 * live campaign, or one cleared for launch a week ago and not launched, appeared on no
 * screen here.
 *
 * `privatePageMetadata` for the reason every console route gives — an administration
 * surface has no business in an index. THE ROUTE IS NOT A GATE: the service refuses a
 * caller without `MODERATE_CONTENT` and this screen renders that refusal, and a check
 * here would be a second, weaker copy of one the service already makes correctly.
 *
 * No `<main>` of its own: `AdminArea` owns the only one on the page, and the width comes
 * from the shell so the console's screens line up with each other.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.campaigns');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function CampaignsPage() {
  const t = await getTranslations('admin.pages.campaigns');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <CampaignDirectory copy={await campaignDirectoryCopy()} />
      </div>
    </div>
  );
}
