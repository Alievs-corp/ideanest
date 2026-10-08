import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { fetchCategories } from '../../../../lib/api/server';
import { categoryPath, subcategoryPath } from '../../../../lib/categories/api';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { categoryPageGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { CategoryBadge } from '../../../../components/browse/CategoryLook';
import { getTranslations } from 'next-intl/server';

/**
 * `/categories` — the taxonomy's own page, and the index every category landing page hangs
 * from. §4.13 WS-05, issue #265.
 *
 * <h2>It is the crawl path</h2>
 *
 * A hundred subcategory pages are worth building only if something links to them. The header
 * points here, the footer points here, the home page points here, and this page is the one
 * place that lists every category AND every subcategory as an ordinary link. Without it the
 * landing pages would exist in the sitemap and nowhere in the site, which is the arrangement
 * that makes a crawler treat them as orphans.
 *
 * <h2>The list is data, not code</h2>
 *
 * §4.3 requires the taxonomy to be editable without a deployment, so this page renders
 * whatever `GET /v1/categories` answers and holds no list of its own. A category an
 * administrator adds has a page and a link the moment the read revalidates — an hour, for the
 * reason `fetchCategories` gives.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('discovery.categories');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/categories',
    locale: localeOrDefault(locale),
  });
}

export default async function CategoriesPage() {
  const t = await getTranslations('discovery.categories');

  const categories = await fetchCategories();

  return (
    <>
      <StructuredData nodes={categoryPageGraph({ trail: [], ...(await graphContext()) })} />

      <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-[60ch] text-white/64">
          {t('intro')}
        </p>

        {categories === null || categories.length === 0 ? (
          /*
            A REFUSED READ AND AN EMPTY TAXONOMY LOOK THE SAME HERE, and the page does not
            pretend to tell them apart. Either way the feed is reachable and carries
            everything, which is the one useful thing to say.
          */
          <p className="mt-10 max-w-[60ch] text-white/64">
            {t.rich('unavailable', {
              feed: (chunks) => (
                <Link
                  href="/discover"
                  className="text-white underline underline-offset-4 hover:text-white/80"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : (
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <section key={category.id}>
                {/*
                  The category's icon on its accent, beside the name — the mark the app draws on
                  the same list (#335). Decorative: the name is the link and says it all.
                */}
                <h2 className="group flex items-center gap-3 text-xl font-medium tracking-[-0.02em] text-white">
                  <CategoryBadge
                    slug={category.slug}
                    className="transition-transform duration-300 ease-in-out motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110"
                  />
                  <Link
                    href={categoryPath(category.slug)}
                    className="rounded-sm hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {category.name}
                  </Link>
                </h2>

                {category.subcategories.length > 0 && (
                  <ul className="mt-4 flex list-none flex-col gap-2 pl-[52px]">
                    {category.subcategories.map((subcategory) => (
                      <li key={subcategory.id}>
                        <Link
                          href={subcategoryPath(category.slug, subcategory.slug)}
                          className="rounded-sm text-[15px] text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                        >
                          {subcategory.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
