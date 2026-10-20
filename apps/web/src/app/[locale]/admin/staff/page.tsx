import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffRoles } from '../../../../components/admin/StaffRoles';
import { staffRolesCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's role model, as a screen — issue #295.
 *
 * <p>The first thing it shows is what the reader may do, because the commonest question a
 * member of staff has about a console is why a screen they were told about is not on their
 * rail. The roster below it needs `ADMINISTER_STAFF`, which only an administrator holds.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.staff');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function StaffPage() {
  const t = await getTranslations('admin.pages.staff');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <StaffRoles copy={await staffRolesCopy()} />
      </div>
    </div>
  );
}
