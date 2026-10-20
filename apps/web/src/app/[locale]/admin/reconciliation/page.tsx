import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReconciliationPanel } from '../../../../components/admin/ReconciliationPanel';
import { reconciliationCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-05: the reconciliation — issue #106.
 *
 * <p>The third Finance screen, and the one that checks the other two. `/admin/payments` is
 * what a provider was asked and what it said, `/admin/ledger` is what moved — and this is
 * whether the two agree, whether the books sum to zero, and whether any account holds a
 * balance whose sign is impossible.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.reconciliation');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ReconciliationPage() {
  const t = await getTranslations('admin.pages.reconciliation');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <ReconciliationPanel copy={await reconciliationCopy()} />
      </div>
    </div>
  );
}
