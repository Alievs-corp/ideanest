import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { PromoFilm } from '../../../../components/content/PromoFilm';
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
  const t = await getTranslations('static.howItWorks');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/how-it-works',
    locale: localeOrDefault(locale),
  });
}

/**
 * `/how-it-works` — §4.13 WS-07, issue #292.
 *
 * <h2>Two audiences on one page, in the order they arrive</h2>
 *
 * Backers first, creators second. Somebody reading this page has almost always arrived from a
 * campaign they are considering, and a page that opened with "launch your idea" would answer
 * the question they did not ask. Splitting it into two routes was the alternative and it costs
 * a decision — "which of these am I?" — at the moment somebody wants a straight answer.
 *
 * <h2>It describes what is built, and says where something is not</h2>
 *
 * The section on collection describes the retry window because §5.1 defines one; it does not
 * describe a refund path, because §9.7's is administrative rather than something a backer
 * operates. A page that describes an intention as though it were a feature is the same defect
 * as a navigation entry pointing at a 404.
 */
/** See `about/page.tsx` — the same two shapes, named for the same reason. */
const INLINE_LINK = 'text-fg underline underline-offset-4';
const BOLD = (chunks: ReactNode) => <strong className="font-medium text-fg">{chunks}</strong>;

export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('static.howItWorks');

  /*
   * The four links this page makes, as one object. `t.rich` takes a function per tag, and
   * declaring them here rather than inline in each call keeps the prose below readable as
   * prose — which is what a page of prose should look like in source.
   */
  const link = (href: string) => (chunks: ReactNode) => (
    <Link href={href} className={INLINE_LINK}>
      {chunks}
    </Link>
  );

  return (
    <>
      <StructuredData nodes={sitePageGraph({ crumb: { name: t('metaTitle'), path: '/how-it-works' }, ...(await graphContext()) })} />
      <StaticPage title={t('title')} summary={t('summary')}>
        <PromoFilm locale={localeOrDefault(locale)} />

        <h2>{t('backing.heading')}</h2>
        <p>{t.rich('backing.first', { b: BOLD })}</p>
        <p>{t('backing.second')}</p>
        <p>{t('backing.third')}</p>

        <h2>{t('surveys.heading')}</h2>
        <p>{t.rich('surveys.first', { surveys: link('/account/surveys') })}</p>
        <p>{t.rich('surveys.second', { deliveries: link('/account/deliveries') })}</p>

        <h2>{t('running.heading')}</h2>
        <ul>
          <li>{t.rich('running.draft', { b: BOLD })}</li>
          <li>{t.rich('running.rewards', { b: BOLD })}</li>
          <li>{t.rich('running.submit', { b: BOLD })}</li>
          <li>{t.rich('running.launch', { b: BOLD })}</li>
          <li>{t.rich('running.deliver', { b: BOLD })}</li>
        </ul>

        <h2>{t('agreeing.heading')}</h2>
        <p>{t('agreeing.first')}</p>
        <p>{t.rich('agreeing.second', { trustSafety: link('/trust-safety') })}</p>
      </StaticPage>
    </>
  );
}
