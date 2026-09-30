import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConsoleIndex } from '../../../../components/admin/ConsoleIndex';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { consoleIndexCopy } from '../../../../lib/i18n/shell-copy.server';

/**
 * §4.11's sixteen modules, and the state of each — issues #294 and #222.
 *
 * <p>This was the console's front door until #222 gave the front door to the platform's figures.
 * It is kept whole and moved here because it is epic #259's definition of done rendered: every
 * module either has a screen or names what it is waiting on, and the dashboard has nowhere to say
 * that. It is one link from the dashboard.
 *
 * <p>`privatePageMetadata` for the reason the console's routes give: an administration surface has
 * no business in an index, so this emits `noindex, nofollow` and no social card.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.index');
  return privatePageMetadata({ title: t('title'), description: t('metaDescription') });
}

export default async function AdminModulesPage() {
  return <ConsoleIndex copy={await consoleIndexCopy()} />;
}
