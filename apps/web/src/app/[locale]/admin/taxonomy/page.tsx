import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TaxonomyManager } from '../../../../components/admin/TaxonomyManager';
import { taxonomyManagerCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-08: category and tag management with translations — §4.3, issue #309.
 *
 * <p>§4.3 requires the taxonomy be editable without a deployment. The tables have existed
 * since V6 and V11; what did not exist was any way to write to them.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.taxonomy');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function TaxonomyPage() {
  const t = await getTranslations('admin.pages.taxonomy');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <TaxonomyManager copy={await taxonomyManagerCopy()} />
      </div>
    </div>
  );
}
