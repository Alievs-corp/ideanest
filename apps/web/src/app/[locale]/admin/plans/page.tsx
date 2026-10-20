import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlanManager } from '../../../../components/admin/PlanManager';
import { planManagerCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-11, second screen: what the platform charges a creator to publish.
 *
 * <p>Filed under AD-11 beside the fee editor rather than as a seventeenth module. A fee comes
 * out of a backer's pledge and a plan comes out of a creator's pocket, which is the same
 * authority over the same subject — `lib/admin/navigation.ts` has the argument, and it is the
 * one `/admin/staff` was filed under AD-04 by.
 *
 * <p>Unlike the fee editor, a plan is edited in place. What a subscriber was charged is
 * snapshotted onto their own subscription at purchase, so nothing here reaches backwards into
 * a bill — the screen's own notice says so, because somebody arriving from the fee editor
 * arrives with the opposite expectation.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.plans');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function PlansPage() {
  const t = await getTranslations('admin.pages.plans');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <PlanManager copy={await planManagerCopy()} />
      </div>
    </div>
  );
}
