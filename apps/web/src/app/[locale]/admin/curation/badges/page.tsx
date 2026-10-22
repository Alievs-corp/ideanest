import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BadgeManager } from '../../../../../components/admin/BadgeManager';
import { badgeManagerCopy } from '../../../../../lib/i18n/admin/console.server';
import { noteDialogCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-03: the editorial badge manager — issue #300.
 *
 * <p>§3.2's badge is not a flag on a campaign; it is a property of being in a collection that
 * grants one. `BadgeManager` carries the argument, and the consequence for this page is that
 * it is a list of collections rather than a list of badges.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.curationBadges');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function BadgesPage() {
  const t = await getTranslations('admin.pages.curationBadges');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <BadgeManager copy={await badgeManagerCopy()} note={await noteDialogCopy()} />
      </div>
    </div>
  );
}
