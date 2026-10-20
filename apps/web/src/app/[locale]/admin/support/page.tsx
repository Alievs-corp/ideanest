import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SupportConsole } from '../../../../components/admin/SupportConsole';
import { supportConsoleCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-10: tickets with user context and action history — issue #310.
 *
 * <p>A support conversation is read beside the pledge it is about and every other ticket the
 * same person has raised, which is the half a shared mailbox cannot do — and the reason the
 * platform needed a store of its own.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.support');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function SupportPage() {
  const t = await getTranslations('admin.pages.support');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <SupportConsole copy={await supportConsoleCopy()} />
      </div>
    </div>
  );
}
