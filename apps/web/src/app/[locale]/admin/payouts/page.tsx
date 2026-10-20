import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayoutQueue } from '../../../../components/admin/PayoutQueue';
import { payoutQueueCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-05: the payout queue and its approvals — issues #69 and #306.
 *
 * <p>Every figure that produced the net is on the row, because this is where somebody signs
 * off money leaving the platform and a single number with a note saying "fees deducted" is
 * not something anybody can check.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.payouts');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PayoutsPage() {
  const t = await getTranslations('admin.pages.payouts');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PayoutQueue copy={await payoutQueueCopy()} />
      </div>
    </div>
  );
}
