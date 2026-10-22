import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LedgerExplorer } from '../../../../components/admin/LedgerExplorer';
import { ledgerExplorerCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-05: the ledger explorer — issue #305.
 *
 * <p>The other half of Finance. `/admin/payments` is what a provider was asked and
 * what it said; this is what moved, in the double-entry form §7.2 requires — and only
 * ever when something actually did, which is why a declined charge has a row there
 * and nothing here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.ledger');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function LedgerPage() {
  const t = await getTranslations('admin.pages.ledger');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <LedgerExplorer copy={await ledgerExplorerCopy()} />
      </div>
    </div>
  );
}
