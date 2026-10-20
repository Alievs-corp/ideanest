import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PaymentLogView } from '../../../../components/admin/PaymentLogView';
import { paymentLogCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-05: the payment log viewer — issue #304.
 *
 * <p>Half of Finance. The other half is the ledger at `/admin/ledger`, and the two
 * are deliberately separate screens: this is what the platform asked a provider to
 * do and what the provider said, and that is what the money meant. A declined charge
 * appears here and nowhere else, because it moved nothing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.payments');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PaymentsPage() {
  const t = await getTranslations('admin.pages.payments');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PaymentLogView copy={await paymentLogCopy()} />
      </div>
    </div>
  );
}
