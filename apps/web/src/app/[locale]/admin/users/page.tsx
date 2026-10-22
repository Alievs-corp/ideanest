import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserDirectory } from '../../../../components/admin/UserDirectory';
import { userDirectoryCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-04 (#104): the account directory, and it is staff-only.
 *
 * `privatePageMetadata` for the reason `/admin/moderation` gives, and one of its
 * own: this screen renders other people's email addresses, so `noindex, nofollow`
 * and no social card is the least of what it needs. THE ROUTE IS NOT A GATE —
 * there is no role model in the schema or the access token until #295, so the
 * service refuses a caller who is not on the configured moderator list and the
 * panel renders that refusal. Anything gating here would be a second, weaker copy
 * of a check the service already makes correctly, and the two would eventually
 * disagree.
 *
 * <p>Inside the console shell since #294, and no longer carrying a `<main>` of its
 * own — `/admin/moderation` states the argument.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.users');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AdminUsersPage() {
  const t = await getTranslations('admin.pages.users');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <UserDirectory copy={await userDirectoryCopy()} />
      </div>
    </div>
  );
}
