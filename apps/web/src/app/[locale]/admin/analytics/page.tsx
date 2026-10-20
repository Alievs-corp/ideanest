import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlatformAnalyticsView } from '../../../../components/admin/PlatformAnalyticsView';
import { platformAnalyticsCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-13: volume, success rate, average pledge — issue #313.
 *
 * <p>Not the campaign dashboard, which is #95's and answers a creator about their own
 * campaign. This is the same daily rollups summed the other way, which is what made #313
 * unblockable without a new table.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.analytics');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AnalyticsPage() {
  const t = await getTranslations('admin.pages.analytics');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PlatformAnalyticsView copy={await platformAnalyticsCopy()} />
      </div>
    </div>
  );
}
