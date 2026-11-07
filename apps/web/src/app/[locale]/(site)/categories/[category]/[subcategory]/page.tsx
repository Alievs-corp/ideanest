import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoryLanding } from '../../../../../../components/browse/CategoryLanding';
import { StructuredData } from '../../../../../../components/seo/StructuredData';
import { categoryPath, subcategoryPath } from '../../../../../../lib/categories/api';
import { resolveCategoryLanding } from '../../../../../../lib/categories/landing';
import { privatePageMetadata, publicPageMetadata } from '../../../../../../lib/seo/metadata';
import { categoryPageGraph } from '../../../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../../../lib/i18n/shell-copy.server';
import { localeOrDefault } from '../../../../../../lib/i18n/locale';
import { getTranslations } from 'next-intl/server';
import { MarketSeed } from '../../../../../../components/shell/MarketSeed';
import { requestMarket } from '../../../../../../lib/market/request';

/**
 * `/categories/{category}/{subcategory}` — §4.13 WS-05, issue #265.
 *
 * <h2>The subcategory is resolved inside its parent, never across the tree</h2>
 *
 * `findSubcategory` takes a category and searches only its children, which is what makes
 * `/categories/games/prints` a 404 rather than the Crafts subcategory of the same name. A
 * subcategory slug is unique within its category and not beyond it (§7's V6), so a global
 * lookup would render a page whose breadcrumb contradicts its own URL — and would give two
 * URLs to one page, which is a duplicate a canonical then has to clean up after.
 *
 * Everything else — the 404 rule, the shared resolution between `generateMetadata` and the
 * body, the reason the URL is a path rather than a filter — is the parent route's, and is
 * written out there rather than repeated here.
 */

interface RouteParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly category: string;
    readonly subcategory: string;
  }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale, category: categorySlug, subcategory: subcategorySlug } = await params;
  const [landing, t] = await Promise.all([
    resolveCategoryLanding(categorySlug, subcategorySlug),
    getTranslations('discovery.landing'),
  ]);

  if (landing.kind === 'not-found' || landing.subcategory === null) {
    return privatePageMetadata({ title: t('notFound') });
  }

  const { category, subcategory } = landing;

  return publicPageMetadata({
    /*
     * The parent is in the title, not only in the trail. "Tabletop" alone is a search result
     * that could belong to any platform; "Tabletop in Games" is one somebody can place at a
     * glance, and the site name is added after it by the template.
     */
    title: t('subMetaTitle', { subcategory: subcategory.name, category: category.name }),
    description: t('subMetaDescription', {
      subcategory: subcategory.name,
      category: category.name,
    }),
    path: subcategoryPath(category.slug, subcategory.slug),
    locale: localeOrDefault(locale),
  });
}

export default async function SubcategoryPage({ params }: RouteParams) {
  const { category: categorySlug, subcategory: subcategorySlug } = await params;
  const landing = await resolveCategoryLanding(categorySlug, subcategorySlug);

  if (landing.kind === 'not-found' || landing.subcategory === null) notFound();

  const { category, subcategory, campaigns, hasMore } = landing;

  return (
    <>
      <MarketSeed market={await requestMarket()} />
      <StructuredData
        nodes={categoryPageGraph({
          trail: [
            { name: category.name, path: categoryPath(category.slug) },
            { name: subcategory.name, path: subcategoryPath(category.slug, subcategory.slug) },
          ],
          ...(await graphContext()),
        })}
      />
      <CategoryLanding
        category={category}
        subcategory={subcategory}
        campaigns={campaigns}
        hasMore={hasMore}
      />
    </>
  );
}
