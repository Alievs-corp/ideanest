import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubmissionQueue } from '../../../../../components/moderation/SubmissionQueue';
import { submissionQueueCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * AD-01's campaign review queue — what the three moderation outcomes apply to.
 *
 * The console had a queue of complaints and no queue of submissions, so the only route
 * to a campaign awaiting review was a report somebody had filed about it. A campaign
 * nobody complained about therefore waited in `SUBMITTED` indefinitely, invisible to
 * every screen here, while its creator was told it was under review.
 *
 * `privatePageMetadata` for the reason the queue beside it gives — an administration
 * surface has no business in an index. THE ROUTE IS NOT A GATE: the service refuses a
 * caller without `MODERATE_CONTENT` and this screen renders that refusal, and a check
 * here would be a second, weaker copy of one the service already makes correctly.
 *
 * No `<main>` of its own: `AdminArea` owns the only one on the page, and the width comes
 * from the shell so the console's screens line up with each other.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.submissions');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function SubmissionsPage() {
  const t = await getTranslations('admin.pages.submissions');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <SubmissionQueue copy={await submissionQueueCopy()} />
      </div>
    </div>
  );
}
