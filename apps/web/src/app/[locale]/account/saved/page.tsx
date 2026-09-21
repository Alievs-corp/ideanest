import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { SavedProjectsPanel } from '../../../../components/account/SavedProjectsPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { savedListCopy } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.saved');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/account/saved` — §4.9 C-10, issue #288.
 *
 * A shell around a client boundary. The list is one account's, behind a bearer token, so there
 * is nothing a server render could produce — the same arrangement every other account screen
 * uses.
 */
export default async function SavedProjectsPage() {
  const t = await getTranslations('account.pages.saved');
  const copy = await savedListCopy();

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8">
        <SavedProjectsPanel copy={copy} />
      </div>
    </>
  );
}
