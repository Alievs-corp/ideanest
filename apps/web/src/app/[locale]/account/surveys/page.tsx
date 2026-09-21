import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { SurveyList } from '../../../../components/surveys/SurveyList';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { surveysCopy } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.surveys');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/account/surveys` — §4.8 PM-05 and PM-06, issue #289.
 *
 * A shell around a client boundary. The list is built from this account's own backings, behind
 * a bearer token, so there is nothing a server render could produce — so the words it draws are
 * resolved here and handed down, which is the arrangement `lib/i18n/shell-copy.ts` measured its
 * way to (#84).
 */
export default async function SurveysPage() {
  const t = await getTranslations('account.pages.surveys');
  const copy = await surveysCopy();

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8">
        <SurveyList copy={copy} />
      </div>
    </>
  );
}
