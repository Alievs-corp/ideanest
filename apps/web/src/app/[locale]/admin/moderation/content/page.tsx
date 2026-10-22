import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContentReportQueue } from '../../../../../components/admin/ContentReportQueue';
import { contentReportQueueCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-09: the comment and update moderation queue — issue #297.
 *
 * <p>Half of this queue had no intake until now: §10.2 gave an update no report route, so
 * `PROJECT_UPDATE` was a value the taxonomy carried and nothing could write. #83 built the
 * table and #297 published the route, which cost a controller method and no migration.
 *
 * <p>The route is `moderation/content` rather than `moderation/comments`, because it is both
 * surfaces — and it sits beside `[reportId]`, which is safe: Next resolves a static segment
 * before a dynamic one, and a report identifier is a UUID.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.moderationContent');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ContentModerationPage() {
  const t = await getTranslations('admin.pages.moderationContent');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <ContentReportQueue copy={await contentReportQueueCopy()} />
      </div>
    </div>
  );
}
