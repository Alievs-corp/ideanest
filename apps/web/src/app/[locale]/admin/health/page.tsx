import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HealthDashboard } from '../../../../components/admin/HealthDashboard';
import { healthDashboardCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-16: queue depth, failed jobs, provider status — §18, issue #316.
 *
 * <p>#316 was labelled blocked on #138 and was not quite: every number here is a count the
 * service can already take. What it does not do is alert, and the page says so — a dashboard
 * presented as monitoring is worse than an honest gap.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.health');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function HealthPage() {
  const t = await getTranslations('admin.pages.health');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <HealthDashboard copy={await healthDashboardCopy()} />
      </div>
    </div>
  );
}
