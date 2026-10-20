import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FlagConsole } from '../../../../components/admin/FlagConsole';
import { flagConsoleCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §4.11's AD-12: gradual rollout and experiments — issue #312.
 *
 * <p>Off is off for everybody, including the accounts named explicitly on a flag. That is the
 * property somebody relies on when they reach for this during an incident.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.flags');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function FlagsPage() {
  const t = await getTranslations('admin.pages.flags');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <FlagConsole copy={await flagConsoleCopy()} />
      </div>
    </div>
  );
}
