import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditTrailView } from '../../../../components/admin/AuditTrailView';
import { auditTrailCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-14: the audit log viewer — issue #314.
 *
 * <p>The record has existed since #107 and nothing has ever read it except a psql
 * session. §7.2's rows were indexed for exactly the questions this screen asks, so
 * this is the missing half of a feature rather than a new one.
 *
 * <p>`privatePageMetadata` for the reason every console route gives, and one of its
 * own: these rows carry source addresses and the prose the platform wrote about
 * people's accounts.
 *
 * <p>Translated since #324: the metadata and the two sentences above the view come
 * from `admin.pages.audit`, and the view's own words are resolved here and handed
 * down rather than read from a provider.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.audit');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AuditPage() {
  const t = await getTranslations('admin.pages.audit');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <AuditTrailView copy={await auditTrailCopy()} />
      </div>
    </div>
  );
}
