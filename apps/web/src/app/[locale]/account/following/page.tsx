import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { FollowingPanel } from '../../../../components/account/FollowingPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { followingListCopy } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.following');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/account/following` — §4.9 C-10, issue #288.
 *
 * The other half of the same endpoint pair as `/account/saved`, and a separate screen rather
 * than a tab beside it: a saved campaign and a followed creator are different objects with
 * different actions on them, and a tab strip would suggest they are two views of one list.
 */
export default async function FollowingPage() {
  const t = await getTranslations('account.pages.following');
  const copy = await followingListCopy();

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8">
        <FollowingPanel copy={copy} />
      </div>
    </>
  );
}
