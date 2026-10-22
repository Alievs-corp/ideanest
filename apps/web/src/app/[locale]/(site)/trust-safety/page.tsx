import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { StaticPage } from '../../../../components/content/StaticPage';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { sitePageGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('static.trustSafety');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/trust-safety',
    locale: localeOrDefault(locale),
  });
}

/**
 * `/trust-safety` — §4.13 WS-07, issue #292.
 *
 * <h2>The page most likely to be quoted back at us</h2>
 *
 * Somebody reads this when they are already worried, and every sentence on it is a commitment.
 * So it says what the platform does and — where it matters — what it does not: it reviews
 * campaigns, it does not verify that a creator can build what they described; it holds
 * addresses encrypted, it does not promise delivery. §5.4, §9, §17.3 and §17.4 are the
 * sections behind each claim.
 *
 * **It is not the legal pages.** Terms, privacy and cookies are WS-08 and #293, which is
 * blocked on a legal deliverable that §22 owns. Nothing here is written as though it were a
 * contract, and nothing links to a document that does not exist.
 */
/** See `about/page.tsx` — the same two shapes, named for the same reason. */
const INLINE_LINK = 'text-fg underline underline-offset-4';
const BOLD = (chunks: ReactNode) => <strong className="font-medium text-fg">{chunks}</strong>;

export default async function TrustSafetyPage() {
  const t = await getTranslations('static.trustSafety');

  const link = (href: string) => (chunks: ReactNode) => (
    <Link href={href} className={INLINE_LINK}>
      {chunks}
    </Link>
  );

  return (
    <>
      <StructuredData nodes={sitePageGraph({ crumb: { name: t('metaTitle'), path: '/trust-safety' }, ...(await graphContext()) })} />
      <StaticPage title={t('title')} summary={t('summary')}>
        <h2>{t('review.heading')}</h2>
        <p>{t('review.first')}</p>
        <p>{t('review.second')}</p>

        <h2>{t('notAllowed.heading')}</h2>
        <ul>
          <li>{t('notAllowed.prohibited')}</li>
          <li>{t('notAllowed.misrepresentation')}</li>
          <li>{t('notAllowed.notOwn')}</li>
          <li>{t('notAllowed.offensive')}</li>
          <li>{t('notAllowed.spam')}</li>
          <li>{t('notAllowed.fraud')}</li>
        </ul>

        <h2>{t('reporting.heading')}</h2>
        <p>{t('reporting.first')}</p>
        <p>{t('reporting.second')}</p>

        <h2>{t('money.heading')}</h2>
        <p>{t('money.first')}</p>
        <p>{t('money.second')}</p>

        <h2>{t('account.heading')}</h2>
        <ul>
          <li>{t.rich('account.twoFactor', { b: BOLD, security: link('/settings/security') })}</li>
          <li>{t.rich('account.devices', { b: BOLD, sessions: link('/settings/sessions') })}</li>
          <li>{t.rich('account.addresses', { b: BOLD })}</li>
          <li>{t.rich('account.data', { b: BOLD, privacy: link('/settings/privacy') })}</li>
        </ul>

        <h2>{t('limits.heading')}</h2>
        <p>{t('limits.first')}</p>
        <p>{t('limits.second')}</p>
      </StaticPage>
    </>
  );
}
