import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EmailTemplateIndex } from '../../../../components/admin/EmailTemplateIndex';
import { emailTemplateIndexCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-15: edit, preview, test send — §12.3, issue #315.
 *
 * <p>Two of the three arrived with #86 and this epic adds the third. What #86 said was
 * missing was exactly this: "editing means storing a template, versioning it, and deciding
 * who may change what a payment-failure notice says; that is a screen and a schema".
 *
 * <p>`privatePageMetadata` for the reason every console route gives.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.emailTemplates');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function EmailTemplatesPage() {
  const t = await getTranslations('admin.pages.emailTemplates');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <EmailTemplateIndex copy={await emailTemplateIndexCopy()} />
      </div>
    </div>
  );
}
