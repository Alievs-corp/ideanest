import { getLocale, getTranslations } from 'next-intl/server';
import { projectCardCopyFrom } from '../../lib/i18n/card-copy';
import { localeOrDefault } from '../../lib/i18n/locale';
import { Link } from '../../i18n/navigation';
import { ArrowRight } from 'lucide-react';
import { EmptyState } from '@ideanest/ui/server';
import type { ProjectCard } from '../../lib/discovery/api';
import { NO_FILTERS, toHref } from '@ideanest/discovery/filters';
import type { Category, Subcategory } from '../../lib/categories/api';
import { subcategoryPath } from '../../lib/categories/api';
import { CampaignGrid } from './CampaignGrid';

/**
 * The body of a category or subcategory landing page — §4.13 WS-05, issue #265.
 *
 * <h2>Why these pages exist at all</h2>
 *
 * §4.13 puts it in one line: **a crawler cannot operate a filter.** `/discover?category=games`
 * has always existed and has never been indexable — `lib/seo/indexability.ts` disallows
 * `/discover?` wholesale because the filters compose into a combinatorial set of query strings
 * describing one corpus, and `lib/seo/sitemap/entries.ts` records that the taxonomy "would
 * make excellent landing pages" and had no URL that reached one. These are those URLs.
 *
 * <h2>One component, two routes</h2>
 *
 * A category page and a subcategory page differ in three things: the heading, the filter, and
 * whether there is a row of children to offer. Everything else — the grid, the count, the
 * empty state, the way into the feed — is the same, and writing it twice is writing two
 * pages that will disagree about the empty state within a month.
 *
 * <h2>The link into the feed is the point of the page's foot</h2>
 *
 * A landing page shows a slice and stops; the feed is where somebody narrows further, sorts,
 * and pages. So the last thing on every one of these is the same category with the filter
 * already applied, in `/discover`, where the rest of §4.3 lives.
 *
 * <h2>It reads the catalogue itself — issue #324</h2>
 *
 * There is no `'use client'` here or anywhere beneath it, which is what makes it an ordinary
 * async server component: it can await `getTranslations` and does, rather than being handed a
 * copy object by two routes that would then have to agree about what to resolve. That is the
 * arrangement `CampaignSummary` and `CollectionIndex` already use; the prop-threading in
 * `components/auth` and `components/checkout` exists because those subtrees are client
 * components and cannot.
 *
 * <p>The counts go through ICU rather than a ternary. "1 campaign" against "2 campaigns" is
 * the whole of English and none of Russian, which has three forms and picks between them by
 * the last digit.
 */

export interface CategoryLandingProps {
  readonly category: Category;
  /** Present on a subcategory page, absent on a category page. */
  readonly subcategory?: Subcategory;
  readonly campaigns: readonly ProjectCard[];
  /** Whether the service said there is another page behind this one. */
  readonly hasMore: boolean;
}

export async function CategoryLanding({
  category,
  subcategory,
  campaigns,
  hasMore,
}: CategoryLandingProps) {
  const t = await getTranslations('discovery.landing');
  const common = await getTranslations('common');
  const trail = await getTranslations('common.trail');
  const cardCopy = projectCardCopyFrom(await getTranslations('discovery.card'), common);
  const locale = localeOrDefault(await getLocale());

  const title = subcategory?.name ?? category.name;

  /*
   * The service takes a subcategory on its own — it implies its parent — and the category is
   * sent alongside it anyway. A URL that reads `?category=games&subcategory=tabletop` is one
   * somebody can read, edit and share, and it is what the breadcrumb above the page already
   * claims the reader came through.
   */
  const feedHref = toHref(
    subcategory === undefined
      ? { ...NO_FILTERS, categories: [category.slug] }
      : { ...NO_FILTERS, categories: [category.slug], subcategories: [subcategory.slug] },
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
      {/*
        THE TRAIL IS RENDERED AS WELL AS DECLARED. `categoryPageGraph` states it in JSON-LD for
        a crawler; this is the same trail for a reader, and a page that only had the machine
        half would be one a person lands on with no way up. `aria-label` names it because a
        second `<nav>` on the page — the header's — is otherwise indistinguishable from it.
      */}
      <nav aria-label={common('breadcrumb')} className="text-sm text-white/40">
        <ol className="flex list-none flex-wrap items-center gap-2">
          <li>
            <Link href="/categories" className="hover:text-white">
              {trail('categories')}
            </Link>
          </li>
          {subcategory !== undefined && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/categories/${encodeURIComponent(category.slug)}`} className="hover:text-white">
                  {category.name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-white/64">
            {title}
          </li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 max-w-[60ch] text-white/64">
        {subcategory === undefined
          ? t('standfirst', { category: category.name })
          : t('subStandfirst', { category: category.name, subcategory: subcategory.name })}
      </p>

      {/*
        The children, on a category page only. They are the reason a category page is more than
        a filtered feed with a nicer URL: each one is its own indexable page, and this is the
        only link to it a crawler will find.
      */}
      {subcategory === undefined && category.subcategories.length > 0 && (
        <nav aria-label={t('subcategoriesLabel', { category: category.name })} className="mt-8">
          <ul className="flex list-none flex-wrap gap-2">
            {category.subcategories.map((child) => (
              <li key={child.id}>
                <Link
                  href={subcategoryPath(category.slug, child.slug)}
                  className="inline-flex h-9 items-center rounded-full border border-white/8 bg-surface-2 px-4 text-sm text-white/64 transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p className="mt-8 text-sm text-white/64 tabular-nums">
        {t(hasMore ? 'countMore' : 'count', { count: campaigns.length })}
      </p>

      <div className="mt-6">
        {campaigns.length === 0 ? (
          /*
            `empty`, not `filtered`. `EmptyState` distinguishes the two because the recovery
            differs, and nothing here is a filter the reader chose — they followed a link to a
            category that happens to have nothing published in it. Telling them to clear a
            filter would be telling them to undo something they did not do.
          */
          <EmptyState
            variant="empty"
            headingLevel={2}
            title={t('emptyTitle', { title })}
            description={t('emptyBody')}
            action={
              <Link
                href="/discover"
                className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
              >
                {t('emptyAction')}
              </Link>
            }
          />
        ) : (
          <>
            <CampaignGrid
              campaigns={campaigns}
              priorityCount={3}
              label={t('gridLabel', { title })}
              cardCopy={cardCopy}
              locale={locale}
            />

            <div className="mt-10 flex justify-center">
              <Link
                href={feedHref}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-white/16 px-6 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
              >
                {hasMore ? t('seeEvery', { title }) : t('filterAndSort', { title })}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
