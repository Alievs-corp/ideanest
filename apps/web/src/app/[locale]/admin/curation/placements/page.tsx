import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlacementEditor } from '../../../../../components/admin/PlacementEditor';
import { placementEditorCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-03: the placement editor — issue #303.
 *
 * <p>§4.13's WS-04 makes the home page the one surface that is entirely editorial, and this is
 * what orders it. `PlacementEditor` states plainly that placement today is one integer per
 * collection rather than a slot editor, because an interface that implied more would stop
 * working the moment somebody built the real thing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.curationPlacements');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PlacementsPage() {
  const t = await getTranslations('admin.pages.curationPlacements');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <PlacementEditor copy={await placementEditorCopy()} />
      </div>
    </div>
  );
}
