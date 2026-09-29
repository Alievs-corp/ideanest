import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '../../../../i18n/navigation';
import { StaticPage } from '../../../../components/content/StaticPage';
import { LegalUnavailable } from '../../../../components/content/LegalUnavailable';
import { formatInstant, SERVER_TIME_ZONE } from '../../../../lib/projects/deadline';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { LEGAL_DOCUMENTS, kindOf, legalPath } from '../../../../lib/legal/api';
import { fetchLegalCatalogue } from '../../../../lib/legal/server';
import { publicPageMetadata } from '../../../../lib/seo/metadata';

/**
 * `/legal` — §22.2's eight, listed. Issue #439.
 *
 * <h2>Why an index rather than eight footer links</h2>
 *
 * §22.2 requires eight documents, and a footer column with eight entries is a footer nobody
 * reads. More importantly, this is the page a regulator lands on: one address that says what the
 * platform is required to have, which of those it has published, and since when. Eight scattered
 * links answer none of those questions in one place.
 *
 * <h2>It lists all eight, including the ones with nothing behind them</h2>
 *
 * <strong>This is the point of the page.</strong> The list is drawn from §22.2's closed set and
 * not from what the service returns, so a document that has never been published appears with
 * "not published yet" beside it rather than being silently absent. A platform that has not
 * published its creator agreement is a platform whose list is short, and hiding the gap would
 * make the page a claim that there are only six documents.
 *
 * That is this repository's actual state: the words are #423's adviser's and none of them exist
 * yet. The page says so rather than looking finished.
 *
 * <h2>Static in the sense this application means it</h2>
 *
 * The same conditions the document route lists, and its comment has the full argument: `params`
 * and no `searchParams`, a credential-free `fetch` with `next.revalidate`, and copy resolved on
 * the server through `getTranslations` rather than through a client provider. Nothing here
 * varies by reader, so one render serves everybody in a language.
 */

const PATH = '/legal';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('legal.index');

  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: PATH,
    locale: localeOrDefault(locale),
  });
}

export default async function LegalIndexRoute({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  const locale = localeOrDefault(requested);

  const [t, catalogue] = await Promise.all([
    getTranslations('legal'),
    fetchLegalCatalogue(locale),
  ]);

  /*
   * `null` is a failed read, and it is drawn as one — #147. This used to become an empty map, so
   * every row said "not published yet": during an outage the index told a regulator that IdeaNest
   * had published none of the eight documents §22.2 requires. Neither "in force" nor "not
   * published" can be said without the answer, so the page says it could not load.
   */
  if (catalogue === null) return <LegalUnavailable retryHref={PATH} scope="index" />;

  /*
   * Indexed by kind so the eight rows below can be built from §22.2's list rather than from the
   * answer: a document missing from it is one with nothing published.
   */
  const inForce = new Map(catalogue.map((summary) => [summary.kind, summary]));

  return (
    <StaticPage title={t('index.title')} summary={t('index.summary')}>
      <p>{t('index.intro')}</p>

      <ul>
        {LEGAL_DOCUMENTS.map((slug) => {
          const summary = inForce.get(kindOf(slug));
          const effective =
            summary?.effectiveFrom === undefined || summary.effectiveFrom === null
              ? null
              : formatInstant(summary.effectiveFrom, SERVER_TIME_ZONE, locale);

          return (
            <li key={slug}>
              <Link href={legalPath(slug)} className="text-white underline underline-offset-4">
                {t(`documents.${slug}.title`)}
              </Link>{' '}
              <span className="text-white/64">
                {summary === undefined
                  ? t('index.notPublished')
                  : effective === null
                    ? t('meta.version', { version: summary.version })
                    : t('index.inForce', { version: summary.version, date: effective })}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-white/64">{t('index.archiveNote')}</p>
    </StaticPage>
  );
}
