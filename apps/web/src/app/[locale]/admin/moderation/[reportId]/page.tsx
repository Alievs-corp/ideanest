import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReportDetail } from '../../../../../components/admin/ReportDetail';
import { reportDetailCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-01: one submission, its notes, and the full decision history — issue #296.
 *
 * <p><strong>The heading does not name the report.</strong> A title carrying the reason
 * or the target would mean resolving the report on the server, and the console has no
 * server-side session to resolve it with — the access token lives in the browser
 * (`lib/api/client.ts`). So the page is titled by what it is and the panel says which
 * report it is, which is also the right answer for a screen whose subject is a complaint
 * somebody made about a named person.
 *
 * <p>`privatePageMetadata` for the reason every console route gives, and one of its own:
 * this page quotes what one person wrote about another and shows the account that wrote
 * it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.moderationReportId');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ReportDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly reportId: string }>;
}) {
  const { reportId } = await params;

  const t = await getTranslations('admin.pages.moderationReportId');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <ReportDetail reportId={reportId} copy={await reportDetailCopy()} />
      </div>
    </div>
  );
}
