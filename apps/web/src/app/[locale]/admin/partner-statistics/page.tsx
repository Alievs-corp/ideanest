import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PartnerStatisticsView } from '../../../../components/admin/PartnerStatisticsView';
import { partnerStatisticsCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * The financial statistics, for a partner and for a super admin — #206, part of #202.
 *
 * <p>Filed under AD-11 beside the revenue report: it answers the same question, what the
 * platform has taken in, at the width the reader is entitled to. A super admin reads the real
 * figures here and the revenue report for the rows behind them; a partner reads only this page,
 * and the service decides which answer each of them gets.
 *
 * <p>`privatePageMetadata`: per-person, not for a crawler, and the body is a share of the
 * platform's revenue.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.partnerStatistics');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PartnerStatisticsPage() {
  const t = await getTranslations('admin.pages.partnerStatistics');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PartnerStatisticsView copy={await partnerStatisticsCopy()} />
      </div>
    </div>
  );
}
