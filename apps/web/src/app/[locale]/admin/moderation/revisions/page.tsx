import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RevisionQueue } from '../../../../../components/admin/RevisionQueue';
import { revisionQueueCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * The queue of edits to launched campaigns, waiting on a moderator — issue #560, part of
 * epic #557.
 *
 * `privatePageMetadata` for the reason every console route gives. THE ROUTE IS NOT A GATE: the
 * service refuses a caller without `MODERATE_CONTENT` and this screen renders that refusal.
 * No `<main>` of its own: `AdminArea` owns the only one on the page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.revisions');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function RevisionsPage() {
  const t = await getTranslations('admin.pages.revisions');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <RevisionQueue copy={await revisionQueueCopy()} />
      </div>
    </div>
  );
}
