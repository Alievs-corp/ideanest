import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OpenCallManager } from '../../../../../components/admin/OpenCallManager';
import { openCallManagerCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-03: the open call manager — issue #302.
 *
 * <p>§4.3's Programmes: a themed list with a window it is open in. The window is what makes
 * the kind different from the other two, and it is the one thing this screen edits.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.curationOpenCalls');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function OpenCallsPage() {
  const t = await getTranslations('admin.pages.curationOpenCalls');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <OpenCallManager copy={await openCallManagerCopy()} />
      </div>
    </div>
  );
}
