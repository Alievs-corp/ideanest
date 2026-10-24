import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RevisionReview } from '../../../../../../components/admin/RevisionReview';
import { revisionReviewCopy } from '../../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

/**
 * One edit to a launched campaign, live beside proposed — issue #560, part of epic #557.
 *
 * Titled by what it is, not by the campaign: resolving the title would mean reading the admin
 * endpoint on the server, and the console has no server-side session (`lib/api/client.ts`).
 * The panel names the campaign. `privatePageMetadata`, and THE ROUTE IS NOT A GATE, for the
 * reasons the queue beside it gives.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.revisionReview');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function RevisionReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly revisionId: string }>;
}) {
  const { revisionId } = await params;

  const t = await getTranslations('admin.pages.revisionReview');

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <RevisionReview revisionId={revisionId} copy={await revisionReviewCopy()} />
      </div>
    </div>
  );
}
