import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayoutDestinationQueue } from '../../../../components/admin/PayoutDestinationQueue';
import { payoutDestinationQueueCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * Where creators are paid, waiting on a reviewer — issue #396, part of epic #392.
 *
 * <p>COMPLIANCE's screen and not FINANCE's: the person who confirms that an account belongs to
 * its creator is not the person who sends money to it, which is V66's split and §4.11's. The
 * rail offers it to `VERIFY_PAYOUT_DESTINATION`, and the service refuses everybody else.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and this one names people and their bank accounts.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.payoutDestinations');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PayoutDestinationsPage() {
  const t = await getTranslations('admin.pages.payoutDestinations');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <PayoutDestinationQueue copy={await payoutDestinationQueueCopy()} />
      </div>
    </div>
  );
}
