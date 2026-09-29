import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { StaticPage } from '../../../../components/content/StaticPage';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('static.about');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/about',
    locale: localeOrDefault(locale),
  });
}

/**
 * `/about` — §4.13 WS-07, issue #292.
 *
 * <h2>Indexable, and the one page on the platform that is entirely editorial</h2>
 *
 * Along with `/how-it-works` and `/trust-safety` it is a fully static route: no fetch, no
 * session, no client boundary. It renders identically for every visitor, which is what makes
 * it cacheable at the edge and what keeps it out of the account area's shell.
 *
 * <h2>Every claim here is checkable against the specification</h2>
 *
 * The rule this page is written under: nothing is said that `docs/architecture.md` does not
 * say. §5.1 is where all-or-nothing comes from, §5.2 the fees, §17.4 the retention. A marketing
 * page that describes a platform slightly better than the platform is a page somebody quotes
 * back during a dispute.
 *
 * **No figures.** There is no honest aggregate to publish — no number of campaigns funded, no
 * total raised — and a page that invented one would be inventing the only thing on it a reader
 * could not verify.
 *
 * <h2>No fee rate either, and that is issue #145</h2>
 *
 * The cost section used to print "15%… the creator receives 85%" from the message catalogue,
 * while `/pricing` and every fee disclosure read the rate in force from `fee_schedules`. The day
 * the rate changed, this page would have contradicted Pricing, and nothing checks a catalogue
 * against a table. So the section names the two fees and links to Pricing for the numbers
 * rather than reading the disclosure here: this page stays a route with no fetch, and a page
 * that states no rate cannot state a different one. `about.test.tsx` pins the absence of a
 * percentage in all four languages.
 */
/**
 * The two shapes a sentence on a static page takes besides plain text.
 *
 * Named rather than repeated because `t.rich` takes each tag as a function, and a class
 * typed twice in two of them is a difference nobody sees until one link is underlined and
 * the other is not. `BOLD` is `font-medium text-white` rather than a bare `<strong>`: these
 * pages set body text in `text-reading`, so an unstyled strong is heavier but not brighter,
 * which reads as a rendering fault rather than as emphasis.
 */
const INLINE_LINK = 'text-white underline underline-offset-4';
const BOLD = (chunks: ReactNode) => <strong className="font-medium text-white">{chunks}</strong>;

export default async function AboutPage() {
  const t = await getTranslations('static.about');

  return (
    <StaticPage title={t('title')} summary={t('summary')}>
      <p>{t('intro')}</p>

      <h2>{t('allOrNothing.heading')}</h2>
      <p>{t('allOrNothing.first')}</p>
      <p>{t('allOrNothing.second')}</p>

      <h2>{t('cost.heading')}</h2>
      <ul>
        <li>
          {t.rich('cost.successful', {
            b: BOLD,
            pricing: (chunks) => (
              <Link href="/pricing" className={INLINE_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </li>
        <li>{t.rich('cost.unsuccessful', { b: BOLD })}</li>
      </ul>
      <p>{t('cost.note')}</p>

      <h2>{t('notAPurchase.heading')}</h2>
      <p>{t('notAPurchase.body')}</p>

      <h2>{t('next.heading')}</h2>
      <p>
        {t.rich('next.body', {
          howItWorks: (chunks) => (
            <Link href="/how-it-works" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
          trustSafety: (chunks) => (
            <Link href="/trust-safety" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </StaticPage>
  );
}
