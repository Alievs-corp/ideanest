import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CampaignPreview } from '../../../../../components/admin/CampaignPreview';
import { campaignPreviewCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * One campaign, as its page reads, for the moderator deciding it — issue #399.
 *
 * <p><strong>The route the submission queue was missing.</strong> That queue asks for an
 * irreversible decision about a campaign and linked to the public page, which for a campaign
 * in review is a 404 by construction — so approval happened on a title, a creator's name and
 * a goal figure. This renders the same page a backer would see, in whatever state the
 * campaign is in.
 *
 * <p><strong>The heading does not name the campaign.</strong> Resolving its title would mean
 * reading the admin endpoint on the server, and the console has no server-side session to
 * read it with — the access token lives in the browser (`lib/api/client.ts`). So the page is
 * titled by what it is and the panel says which campaign it is, which is the arrangement
 * every other console detail route uses.
 *
 * <p>`privatePageMetadata` for the reason every console route gives, and one of its own that
 * is stronger than most: this screen renders drafts, which are private working documents
 * their creators have shown nobody. THE ROUTE IS NOT A GATE — the service refuses a caller
 * without `MODERATE_CONTENT` and this screen renders that refusal, and a check here would be
 * a second, weaker copy of one the service already makes correctly.
 *
 * <p>The route is `[projectId]` beside no static siblings under `/admin/campaigns`, so
 * nothing shadows it; that is worth stating because `/admin/curation/[slug]` does have three
 * and had to say so.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.campaignPreview');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function CampaignPreviewPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;

  const t = await getTranslations('admin.pages.campaignPreview');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <CampaignPreview projectId={projectId} copy={await campaignPreviewCopy()} />
      </div>
    </div>
  );
}
