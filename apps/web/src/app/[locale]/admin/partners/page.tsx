import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PartnerManager } from '../../../../components/admin/PartnerManager';
import { partnerManagerCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * Who sees a share of the financial figures, and what share — #206, part of #202.
 *
 * <p>Filed under AD-04 beside `/admin/staff`, on that page's own argument: §4.11's table has
 * sixteen rows and no row for staff, because when it was written there was no role model to
 * have a screen for. A partner is a kind of staff account with one narrow authority, and is
 * granted by the same person and recorded the same way, so it lives where roles do rather than
 * in a seventeenth module.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and this one names people and their shares.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.partners');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PartnersPage() {
  const t = await getTranslations('admin.pages.partners');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PartnerManager copy={await partnerManagerCopy()} />
      </div>
    </div>
  );
}
