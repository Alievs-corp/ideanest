import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BackerDisputeQueue } from '../../../../components/admin/BackerDisputeQueue';
import { DisputeConsole } from '../../../../components/admin/DisputeConsole';
import { backerDisputeQueueCopy, disputeConsoleCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-07: notification, evidence, outcome — issues #68 and #308.
 *
 * <p>Nothing here opens a dispute. A chargeback is somebody else's decision arriving through
 * a provider webhook, and this screen answers cases rather than making them.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.disputes');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function DisputesPage() {
  const t = await getTranslations('admin.pages.disputes');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <DisputeConsole copy={await disputeConsoleCopy()} />
      </div>

      {/* IDN-EXT-01 (#44): disputes backers opened while a payout was held, below the chargebacks. */}
      <div className="mt-12">
        <BackerDisputeQueue copy={await backerDisputeQueueCopy()} />
      </div>
    </div>
  );
}
