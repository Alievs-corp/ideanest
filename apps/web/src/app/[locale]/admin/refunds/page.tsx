import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RefundConsole } from '../../../../components/admin/RefundConsole';
import { refundConsoleCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-06: full and partial refunds with reason codes — issues #67 and #307.
 *
 * <p>The screen opens on the refunds that are still `REQUESTED`, because a refund stuck in
 * that state is one the platform decided on and did not complete — which means somebody is
 * waiting for money and nothing else on the console would say so.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.refunds');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function RefundsPage() {
  const t = await getTranslations('admin.pages.refunds');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <RefundConsole copy={await refundConsoleCopy()} />
      </div>
    </div>
  );
}
