import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AudienceView } from '../../../../components/admin/AudienceView';
import { audienceCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * Who came to the platform, from where, on what, and which campaigns they looked at — issue
 * #635, epic #632.
 *
 * <p>AD-13's second screen, beside the pledge figures: the same platform-wide question asked of
 * people rather than of money, and gated by `VIEW_AUDIENCE` rather than `VIEW_FINANCE` so a
 * curator can read it without being handed the books.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are per-person
 * and not for a crawler.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.audience');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AudiencePage() {
  const t = await getTranslations('admin.pages.audience');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <AudienceView copy={await audienceCopy()} />
      </div>
    </div>
  );
}
