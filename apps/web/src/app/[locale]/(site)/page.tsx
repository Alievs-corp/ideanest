import type { Metadata } from 'next';
import { Link } from '../../../i18n/navigation';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { CampaignGrid } from '../../../components/browse/CampaignGrid';
import { FadeUpSection } from '../../../components/motion/FadeUpSection';
import { StructuredData } from '../../../components/seo/StructuredData';
import { fetchCategories, fetchDiscoveryFeed } from '../../../lib/api/server';
import { categoryPath } from '../../../lib/categories/api';
import { feedQuery, type ProjectCard } from '../../../lib/discovery/api';
import { localeOrDefault } from '../../../lib/i18n/locale';
import { NO_FILTERS, toHref } from '../../../lib/discovery/filters';
import { homePageMetadata } from '../../../lib/seo/metadata';
import { homePageGraph } from '../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../lib/i18n/shell-copy.server';
import { getLocale, getTranslations } from 'next-intl/server';
import { projectCardCopy } from '../../../lib/i18n/shell-copy.server';

/**
 * `/` — §4.13 WS-04, issue #264.
 *
 * <h2>The route that did not exist</h2>
 *
 * Twenty routes shipped and the application answered its own origin with a 404. The sitemap
 * listed `/`, the breadcrumb trail on every campaign page started at `/`, `robots.txt`
 * allowed `/`, and none of them pointed at a page. This is that page.
 *
 * <h2>Server-rendered, and it has to be</h2>
 *
 * Nothing here is `'use client'` except one animation wrapper. WS-04 and WS-05 are, in
 * §4.13's own words, the two surfaces §11 and the SEO epic actually have to rank, and a home
 * page that assembled its campaigns in the browser would be a home page a crawler is served
 * empty. The same requirement #119 put on the campaign page and the feed.
 *
 * <h2>Three reads, and any of them may fail</h2>
 *
 * Ending soon, recently launched, and the taxonomy. Each answers `null` when the service
 * refuses or cannot be reached (`lib/api/server.ts`), and each section is simply absent when
 * its read produced nothing. A home page missing a rail is a home page; one that threw is a
 * platform that is down, and the difference is what a visitor arriving during a deployment
 * sees.
 *
 * When all three fail there is still a hero, still a header, still a footer, and still a link
 * to the feed — so the front door is never a dead end.
 *
 * <h2>Motion: the one Full budget on the platform</h2>
 *
 * docs/motion-system.md §5 gives "marketing home" a **Full** budget and adds a note saying
 * the row was aspirational because this route did not exist. It keeps Full, and Full is spent
 * with restraint: `FadeUp` on the hero and on each section heading, which is §5's own line
 * ("first screen and section headings"), and nothing on the cards, which §5.1 forbids
 * outright. No counters — the platform publishes no aggregate figure this page could honestly
 * count up to. No marquee and no page transition, both for the same reason: they would be
 * motion added because the budget allows it rather than because it says anything.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('home');
  const shell = await getTranslations('shell');

  /*
   * See `publicPageMetadata`: the canonical and the `hreflang` cluster follow the route, and
   * so do the words (#113). The description is the site's tagline — the same sentence the
   * footer prints, so a search result and the page it leads to say the same thing.
   */
  return homePageMetadata(localeOrDefault(locale), {
    title: t('metaTitle'),
    description: shell('tagline'),
  });
}

/** Six per rail: two full rows at two columns, two at three, and never a half-empty row. */
const RAIL_SIZE = 6;

export default async function HomePage() {
  const t = await getTranslations('home');
  const locale = localeOrDefault(await getLocale());
  const cardCopy = await projectCardCopy();

  /*
   * Concurrently. They are independent reads and the page cannot paint until the slowest has
   * answered, so serialising them would add the other two round trips to the time to first
   * byte of the platform's front door for nothing.
   */
  const [endingSoon, latest, categories] = await Promise.all([
    fetchDiscoveryFeed(
      feedQuery({ ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' }, { limit: RAIL_SIZE }),
    ),
    fetchDiscoveryFeed(
      feedQuery({ ...NO_FILTERS, statuses: ['live'], sort: 'newest' }, { limit: RAIL_SIZE }),
    ),
    fetchCategories(),
  ]);

  const closing = itemsOf(endingSoon);
  const launched = itemsOf(latest);

  return (
    <>
      {/*
        THE SITE'S IDENTITY IS CLAIMED HERE. It used to be on `/discover`, because that was
        the entry page while this one did not exist — `lib/seo/structured-data/identity.ts`
        says a home page is where it belongs and `graphs.ts` records the move.
      */}
      <StructuredData nodes={homePageGraph(await graphContext())} />

      <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-6">
        {/*
          THE HERO IS SMALL AND THE CONTENT IS IMMEDIATELY BELOW IT. §5's own table: "small
          hero, content immediately — a backer came to find a project, not to watch a film."
          It is a heading, a sentence and two actions, and the first row of campaigns is on
          screen behind it on a laptop.

          NO LIME HERE. §1.1 allows exactly one lime element among a set and this page already
          spends it where it means something: the urgency pill on a campaign that closes
          within 48 hours, inside the Ending soon rail below. A lime hero button would be the
          second, and two things saying "now" is neither of them saying it.
        */}
        <FadeUpSection>
          <section className="pt-10 pb-14 sm:pt-16 sm:pb-20">
            <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl">
              {t('hero.title')}
            </h1>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-white/64">
              {t('hero.standfirst')}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/discover"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-base font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
              >
                {t('hero.browse')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="/projects/new"
                className="inline-flex h-12 items-center rounded-full border border-white/16 px-6 text-base font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
              >
                {t('hero.start')}
              </Link>
            </div>
          </section>
        </FadeUpSection>

        {closing.length > 0 && (
          <HomeSection
            heading={t('closing.heading')}
            standfirst={t('closing.standfirst')}
            href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' })}
            linkLabel={t('closing.link')}
          >
            {/*
              The only grid on the page that fetches its covers eagerly. One of them is the
              largest contentful paint; putting the second rail in the same priority queue
              would make every image on the page later.
            */}
            <CampaignGrid
              campaigns={closing}
              priorityCount={3}
              label={t('closing.gridLabel')}
              cardCopy={cardCopy}
              locale={locale}
            />
          </HomeSection>
        )}

        {launched.length > 0 && (
          <HomeSection
            heading={t('launched.heading')}
            standfirst={t('launched.standfirst')}
            href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'newest' })}
            linkLabel={t('launched.link')}
          >
            <CampaignGrid
              campaigns={launched}
              label={t('launched.gridLabel')}
              cardCopy={cardCopy}
              locale={locale}
            />
          </HomeSection>
        )}

        {categories !== null && categories.length > 0 && (
          <HomeSection
            heading={t('categories.heading')}
            standfirst={t('categories.standfirst')}
            href="/categories"
            linkLabel={t('categories.link')}
          >
            <ul className="grid list-none grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={categoryPath(category.slug)}
                    className="flex h-full items-center justify-between gap-2 rounded-md border border-white/8 bg-surface-2 px-4 py-4 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {category.name}
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-white/40" />
                  </Link>
                </li>
              ))}
            </ul>
          </HomeSection>
        )}

        {closing.length === 0 && launched.length === 0 && (
          /*
            EVERY READ CAME BACK EMPTY. That is either a platform with no live campaigns —
            true on the day it launches — or a service that could not be reached, and this
            page cannot tell the two apart and must not pretend to. What it says is what is
            true either way, and it still offers the feed, which is where the answer is.
          */
          <section className="pb-20">
            <div className="rounded-lg border border-white/8 bg-surface-2 px-6 py-12 text-center">
              <h2 className="text-xl font-medium text-white">{t('empty.heading')}</h2>
              <p className="mx-auto mt-2 max-w-[52ch] text-white/64">
                {t('empty.body')}
              </p>
              <Link
                href="/discover"
                className="mt-6 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
              >
                {t('empty.action')}
              </Link>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** The items of a feed that answered, or none — a refused read and an empty page are one. */
function itemsOf(feed: { items: readonly ProjectCard[] } | null): readonly ProjectCard[] {
  return feed === null ? [] : feed.items;
}

/**
 * One band of the home page: a heading, a sentence, a link out, and a grid.
 *
 * The heading and the standfirst are inside the `FadeUp` and the content is not. §5's line is
 * "first screen and section headings", and animating a grid of campaigns as it comes into
 * view is the fifty-animated-cards failure §5.1 names — on the page where speed matters most,
 * because it is the one a visitor forms an opinion from.
 */
function HomeSection({
  heading,
  standfirst,
  href,
  linkLabel,
  children,
}: {
  readonly heading: string;
  readonly standfirst: string;
  readonly href: string;
  readonly linkLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="pb-20">
      <FadeUpSection>
        <div className="flex flex-col gap-3 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
              {heading}
            </h2>
            <p className="mt-2 max-w-[60ch] text-white/64">{standfirst}</p>
          </div>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-2 rounded-sm text-sm font-medium text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {linkLabel}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </FadeUpSection>

      {children}
    </section>
  );
}
