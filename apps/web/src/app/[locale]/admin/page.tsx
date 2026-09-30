import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConsoleDashboard } from '../../../components/admin/ConsoleDashboard';
import { consoleDashboardCopy } from '../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../lib/seo/metadata';

/**
 * The console's front page: the platform's key figures — §4.11, issue #222.
 *
 * <p>The console's logo leads here. It was the list of sixteen modules (issue #294), which answers
 * "what exists" and not the question a member of staff opens the console with, "how is the
 * platform doing". That list moved to `/admin/modules` and is one link away.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: an administration surface
 * has no business in an index, so this emits `noindex, nofollow` and no social card.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.dashboard');
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AdminConsolePage() {
  return <ConsoleDashboard copy={await consoleDashboardCopy()} />;
}
