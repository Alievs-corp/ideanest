import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FeeEditor } from '../../../../components/admin/FeeEditor';
import { feeEditorCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-11: platform and processing rates with exceptions — §9, issue #311.
 *
 * <p>There is no edit. A rate is a term rather than a setting, so a change closes the
 * schedule in force and opens a new one — otherwise every past payout would silently become
 * a figure nobody can reproduce.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.fees');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function FeesPage() {
  const t = await getTranslations('admin.pages.fees');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <FeeEditor copy={await feeEditorCopy()} />
      </div>
    </div>
  );
}
