import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoryLanding } from '../../../../../components/browse/CategoryLanding';
import { StructuredData } from '../../../../../components/seo/StructuredData';
import { categoryPath } from '../../../../../lib/categories/api';
import { resolveCategoryLanding } from '../../../../../lib/categories/landing';
import { privatePageMetadata, publicPageMetadata } from '../../../../../lib/seo/metadata';
import { categoryPageGraph } from '../../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../../lib/i18n/shell-copy.server';
import { localeOrDefault } from '../../../../../lib/i18n/locale';
import { getTranslations } from 'next-intl/server';
import { MarketSeed } from '../../../../../components/shell/MarketSeed';
import { requestMarket } from '../../../../../lib/market/request';

/**
 * `/categories/{category}` — §4.13 WS-05, issue #265.
 *
 * <h2>An indexable page per category</h2>
 *
 * The URL is a path, not a query string, and that is the entire point: robots.txt disallows
 * `/discover?` wholesale (`lib/seo/indexability.ts`) because the filters compose into a
 * combinatorial set of URLs over one corpus, so until this route existed the fifteen
 * categories were reachable only through a URL crawlers are asked not to fetch.
 *
 * <h2>A slug that names nothing is a 404, not an empty page</h2>
 *
 * `notFound()` rather than a "no campaigns here" page, and the difference is what the two say
 * to a crawler: an empty landing page for `/categories/gmaes` is a 200 that will be indexed,
 * linked to and re-crawled forever. `resolveCategoryLanding` explains why a taxonomy that
 * could not be read is the same answer.
 *
 * <h2>The metadata resolves the same category the body does</h2>
 *
 * `generateMetadata` calls the same function the page does. Next dedupes the underlying
 * `fetch` within one request, so it is one round trip — and the two cannot disagree, which is
 * how a 404 body ends up under a real `<title>`.
 */

interface RouteParams {
  readonly params: Promise<{ readonly locale: string; readonly category: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale, category: slug } = await params;
  const [landing, t] = await Promise.all([
    resolveCategoryLanding(slug),
    getTranslations('discovery.landing'),
  ]);

  /*
   * A category that does not resolve gets the private shape — `noindex, nofollow`, no
   * canonical, no card. The page below answers 404 in the same case, and metadata that
   * described a page that is about to not exist would be a social card for a URL nobody can
   * open.
   */
  if (landing.kind === 'not-found') {
    return privatePageMetadata({ title: t('notFound') });
  }

  const { category } = landing;

  return publicPageMetadata({
    title: category.name,
    description: t('metaDescription', { category: category.name }),
    path: categoryPath(category.slug),
    locale: localeOrDefault(locale),
  });
}

export default async function CategoryPage({ params }: RouteParams) {
  const { category: slug } = await params;
  const landing = await resolveCategoryLanding(slug);

  if (landing.kind === 'not-found') notFound();

  const { category, campaigns, hasMore } = landing;

  return (
    <>
      <MarketSeed market={await requestMarket()} />
      <StructuredData
        nodes={categoryPageGraph({
          trail: [{ name: category.name, path: categoryPath(category.slug) }],
          ...(await graphContext()),
        })}
      />
      <CategoryLanding category={category} campaigns={campaigns} hasMore={hasMore} />
    </>
  );
}
