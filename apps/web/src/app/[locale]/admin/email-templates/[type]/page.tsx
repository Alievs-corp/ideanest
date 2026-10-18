import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@ideanest/ui';
import { EmailTemplateEditor } from '../../../../../components/admin/EmailTemplateEditor';
import { Link } from '../../../../../i18n/navigation';
import { emailTemplateEditorCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * One template's copy, and every version of it — §12.3, issue #315.
 *
 * <p>The type is in the path rather than in a query parameter because it is what the page is
 * about: an administrator sends somebody a link to the notice they are arguing over, and a
 * query parameter would be a link to the list with a filter applied.
 *
 * <p><strong>The heading names the template in words</strong>, from the catalogue the list uses,
 * rather than printing the `NotificationType` constant. A path the catalogue has no name for is
 * not a template — `/admin/email-templates/FOO` — and the page says so instead of mounting an
 * editor whose first read would be refused in the service's English.
 *
 * <p>`privatePageMetadata` for the reason every console route gives.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  const t = await getTranslations('admin');
  const names = t.raw('screens.emailTemplates.type') as Readonly<Record<string, string>>;

  return privatePageMetadata({
    title: Object.hasOwn(names, type) ? (names[type] ?? t('pages.emailTemplatesType.metaTitle')) : t('pages.emailTemplatesType.metaTitle'),
    description: t('pages.emailTemplatesType.metaDescription'),
  });
}

export default async function EmailTemplatePage({
  params,
}: {
  readonly params: Promise<{ readonly type: string }>;
}) {
  const { type } = await params;

  const t = await getTranslations('admin');
  const names = t.raw('screens.emailTemplates.type') as Readonly<Record<string, string>>;
  const name = Object.hasOwn(names, type) ? names[type] : undefined;

  if (name === undefined) {
    return (
      <div className="max-w-[880px]">
        <EmptyState
          variant="empty"
          title={t('screens.emailTemplates.notFoundTitle')}
          description={t('screens.emailTemplates.notFoundBody')}
        />
        <Link
          href="/admin/email-templates"
          className="mt-4 inline-block rounded text-sm text-white underline decoration-white/24 underline-offset-2 hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {t('screens.emailTemplates.backToList')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[880px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{name}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('pages.emailTemplatesType.intro')}</p>

      <div className="mt-8">
        <EmailTemplateEditor type={type} copy={await emailTemplateEditorCopy()} />
      </div>
    </div>
  );
}
