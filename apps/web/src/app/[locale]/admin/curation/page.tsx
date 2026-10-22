import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CollectionManager } from '../../../../components/admin/CollectionManager';
import { collectionManagerCopy } from '../../../../lib/i18n/admin/console.server';
import { noteDialogCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-03: the collection manager — issue #301.
 *
 * <p>Every curated list the platform has, whichever of §4.3's three kinds it is. The three
 * screens beside this one are the same manager asking a narrower question, and
 * `lib/admin/curation.ts` has the argument for why one table and one endpoint set serve all
 * four.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.curation');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function CurationPage() {
  const t = await getTranslations('admin.pages.curation');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <CollectionManager allowCreate copy={await collectionManagerCopy()} note={await noteDialogCopy()} />
      </div>
    </div>
  );
}
