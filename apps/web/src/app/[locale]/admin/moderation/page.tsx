import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ModerationQueue } from '../../../../components/moderation/ModerationQueue';
import { moderationQueueCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * AD-01 and AD-02's queue, inside the console shell since #294.
 *
 * `privatePageMetadata` because an administration surface has no business in an
 * index — it emits `noindex, nofollow` and no social card. THE ROUTE IS NOT A
 * GATE: there is no role model in the schema or the access token until #295, so
 * the service refuses a caller who is not on the configured moderator list and
 * the panel renders that refusal. Anything gating here would be a second, weaker
 * copy of a check the service already makes correctly, and the two would
 * eventually disagree.
 *
 * <p><strong>It no longer declares a `<main>` of its own.</strong> It did while
 * `/admin` had no shell to be inside; `AdminArea` owns the only one on the page
 * now, and two of them is not a duplicated landmark so much as an ambiguous one —
 * assistive technology offers "jump to main" and there is more than one answer.
 * The width also comes from the shell, so the console's screens line up with each
 * other instead of each choosing a column.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.moderation');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ModerationPage() {
  const t = await getTranslations('admin.pages.moderation');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <ModerationQueue detailHrefBase="/admin/moderation" copy={await moderationQueueCopy()} />
      </div>
    </div>
  );
}
