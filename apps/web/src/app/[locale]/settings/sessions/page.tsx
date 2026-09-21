import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { SessionsPanel } from '../../../../components/sessions/SessionsPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import { sessionsPanelCopy } from '../../../../lib/i18n/shell-copy.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.sessions');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * The list is per-account and authenticated with a bearer token held in memory,
 * so there is nothing here a server render could produce — the page is a shell
 * and `SessionsPanel` is the client boundary.
 *
 * **It lost its own `<main>` and its own page padding in #275.** Both belong to the account
 * area's layout now: `SiteShell` owns the single `<main>` on the page, and a second one would
 * leave assistive technology with two answers to "jump to main".
 */
export default async function SessionsPage() {
  const [t, panel] = await Promise.all([
    getTranslations('settings.pages.sessions'),
    sessionsPanelCopy(),
  ]);

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8">
        <SessionsPanel copy={panel} />
      </div>
    </>
  );
}
