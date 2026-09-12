import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RevenueReportView } from '../../../../components/admin/RevenueReportView';
import { revenueReportCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-11, third screen: what the subscriptions actually brought in — #23.
 *
 * <p>Filed under AD-11 with the plans rather than as a seventeenth module, on the argument
 * `lib/admin/navigation.ts` makes. Its own screen rather than a section of `/admin/plans`,
 * because that one is a work queue and this is read by whoever is closing a month.
 *
 * <p>`privatePageMetadata` for the reason every console route gives, and one more: this page
 * lists every paying creator beside what they paid.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.revenue');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function RevenuePage() {
  const t = await getTranslations('admin.pages.revenue');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <RevenueReportView copy={await revenueReportCopy()} />
      </div>
    </div>
  );
}
