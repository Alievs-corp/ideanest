import type { Metadata } from 'next';
import { Link } from '../../../i18n/navigation';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { CampaignGrid } from '../../../components/browse/CampaignGrid';
import {
  HOME_RAIL,
  HOME_RAIL_ITEM,
  HOME_SPLIT_GRID,
} from '../../../components/browse/campaign-grid-layout';
import { ProjectCard as ProjectCardView } from '../../../components/discovery/ProjectCard';
import { RailControls } from '../../../components/home/RailControls';
import { FEATURED_CARD_SIZES } from '../../../lib/images/sizes';
import { ACCENT_SURFACE } from '../../../components/browse/accent-surface';
import { CategoryIcon } from '../../../components/browse/CategoryLook';
import { categoryLook } from '@ideanest/discovery/category-look';
import { FadeUpSection } from '../../../components/motion/FadeUpSection';
import { HeroPhoneScene, HeroScene } from '../../../components/home/HeroScene';
import { StructuredData } from '../../../components/seo/StructuredData';
import { fetchCategories, fetchDiscoveryFeed } from '../../../lib/api/server';
import { categoryPath } from '../../../lib/categories/api';
import { feedQuery, type ProjectCard } from '../../../lib/discovery/api';
import { localeOrDefault } from '../../../lib/i18n/locale';
import { NO_FILTERS, toHref } from '@ideanest/discovery/filters';
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

/** Twelve per rail: full rows at two, three and four columns, and never a half-empty row. */
const RAIL_SIZE = 12;

/** How many popular campaigns the first band's left half shows: two rows of one. */
const FEATURED_SIZE = 2;

/** How many ending-soon campaigns the first band's desktop half shows: two columns of three. */
const SPLIT_SIZE = 6;

/**
 * ONE CAMPAIGN PER BAND ON A PHONE, at the owner's request: every card after the first is
 * hidden below `sm`, and the band ends in a full-width button to the whole list instead.
 * Twelve full-height cards a band made the page a scroll of thirty-odd screens before the
 * categories. A tablet and a desktop are unaffected.
 */
const PHONE_FIRST_ONLY = 'max-sm:hidden';

/** The recently-launched list's id, which its arrows name in `aria-controls`. */
const LAUNCHED_RAIL = 'home-launched-rail';

/**
 * The hairline between two bands, from `lg` — Kickstarter separates its sections with a rule
 * across the column rather than with space alone. Not on a phone, which stays as it was.
 */
const DIVIDED = 'lg:border-t lg:border-white/6 lg:pt-14';

export default async function HomePage() {
  const t = await getTranslations('home');
  const locale = localeOrDefault(await getLocale());
  const cardCopy = await projectCardCopy();

  /*
   * Concurrently. They are independent reads and the page cannot paint until the slowest has
   * answered, so serialising them would add the other two round trips to the time to first
   * byte of the platform's front door for nothing.
   */
  const [endingSoon, latest, popular, categories, pages, pricing] = await Promise.all([
    fetchDiscoveryFeed(
      feedQuery({ ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' }, { limit: RAIL_SIZE }),
    ),
    fetchDiscoveryFeed(
      feedQuery({ ...NO_FILTERS, statuses: ['live'], sort: 'newest' }, { limit: RAIL_SIZE }),
    ),
    /*
     * Two campaigns, for the featured half of the first band on a desktop — two rows, one
     * card each, beside the 2×2 grid. Popularity is the feed's own ranking — money raised
     * against the campaign's age — so the slot claims what the sort measures and nothing more.
     */
    fetchDiscoveryFeed(
      feedQuery({ ...NO_FILTERS, statuses: ['live'], sort: 'popularity' }, { limit: FEATURED_SIZE }),
    ),
    fetchCategories(),
    getTranslations('static'),
    getTranslations('pricing'),
  ]);

  const closing = itemsOf(endingSoon);
  const launched = itemsOf(latest);
  const featured = itemsOf(popular).slice(0, FEATURED_SIZE);
  const featuredIds = new Set(featured.map((card) => card.id));

  /*
   * THE FIRST BAND ON A DESKTOP IS KICKSTARTER'S: the popular campaigns on the left, four of
   * the ending-soon campaigns in a 2×2 grid on the right. The phone and the tablet keep all
   * twelve in the grid they always had, so the four are chosen here and the rest are hidden
   * from `lg` only. A popular campaign is skipped if it is also closing, so a desktop
   * never shows one campaign twice side by side.
   */
  const splitIds = new Set(
    closing
      .filter((card) => !featuredIds.has(card.id))
      .slice(0, SPLIT_SIZE)
      .map((card) => card.id),
  );

  /*
   * The pages a creator reads before starting, in each page's own words: the title and the
   * description its `<meta>` already carries, so this band cannot promise what the page does
   * not say.
   */
  const creatorPages = [
    { href: '/how-it-works', title: pages('howItWorks.metaTitle'), body: pages('howItWorks.metaDescription') },
    { href: '/pricing', title: pricing('metaTitle'), body: pricing('metaDescription') },
    { href: '/trust-safety', title: pages('trustSafety.metaTitle'), body: pages('trustSafety.metaDescription') },
  ] as const;

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
        <section className="grid items-center gap-8 pt-10 pb-14 sm:pt-16 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-6">
          <FadeUpSection>
            <h1 className="max-w-[16ch] text-3xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl">
              {t('hero.title')}
            </h1>
            {/*
              On a phone the standfirst is read, not shown: its facts play one at a time over
              the square scene below it instead (#490), which is decoration for a screen reader.
            */}
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-white/64 max-sm:sr-only">
              {t('hero.standfirst')}
            </p>

            <div className="mt-6 sm:hidden">
              <HeroPhoneScene
                lines={[
                  t('hero.phoneLines.creator'),
                  t('hero.phoneLines.backers'),
                  t('hero.phoneLines.success'),
                  t('hero.sceneCaption'),
                ]}
              />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 sm:mt-9 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <Link
                href="/discover"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-2 text-center text-sm leading-tight font-medium sm:px-6 sm:text-base text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
              >
                {t('hero.browse')}
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 max-sm:hidden" />
              </Link>
              <Link
                href="/projects/new"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/16 px-2 text-center text-sm leading-tight font-medium sm:px-6 sm:text-base text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
              >
                {t('hero.start')}
              </Link>
            </div>
          </FadeUpSection>

          {/*
            THE RIGHT HALF IS THE IDEA THE PAGE IS ABOUT (#337): people walking in from every
            side, an orb that grows with each of them. Server-rendered CSS, no script, outside
            the `FadeUp` because it carries its own motion — `HeroScene` says how it stays on
            the compositor and what it does under reduced motion. Below the text on a tablet.
            A phone gets `HeroPhoneScene` instead, the square card above the actions.
          */}
          <HeroScene caption={t('hero.sceneCaption')} />
        </section>

        {closing.length > 0 && featured.length > 0 && (
          /*
            ONE BAND, TWO PARTS — from `lg`. The two halves share their rows through
            `subgrid`, so the popular cards and the grid beside them start on the same line
            whichever heading wraps. Below `lg` the two halves are two sections, one above
            the other.
          */
          <div className="lg:grid lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-10">
            <HomeSection
              heading={t('featured.heading')}
              standfirst={t('featured.standfirst')}
              href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'popularity' })}
              linkLabel={t('featured.link')}
              className="lg:row-span-2 lg:grid lg:grid-rows-subgrid"
            >
              {/*
                Two rows of one card from `lg`, as tall together as the two rows of the grid
                beside them; each cover takes its row's spare height. Two across on a tablet,
                one on a phone — see `PHONE_FIRST_ONLY`.
              */}
              <ul
                aria-label={t('featured.heading')}
                className="grid list-none gap-4 sm:grid-cols-2 lg:auto-rows-fr lg:grid-cols-1"
              >
                {featured.map((card, index) => (
                  <li key={card.id} className={index === 0 ? 'min-h-0' : `min-h-0 ${PHONE_FIRST_ONLY}`}>
                    <ProjectCardView
                      card={card}
                      copy={cardCopy}
                      locale={locale}
                      sizes={FEATURED_CARD_SIZES}
                      priority={index === 0}
                      coverClassName="lg:aspect-auto lg:min-h-65.5 lg:flex-[100_1_0%]"
                      coverScale={1}
                    />
                  </li>
                ))}
              </ul>
            </HomeSection>

            <HomeSection
              heading={t('closing.heading')}
              standfirst={t('closing.standfirst')}
              href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' })}
              linkLabel={t('closing.link')}
              className="lg:row-span-2 lg:grid lg:grid-rows-subgrid"
            >
              {/*
                Eager covers for the first row of the 2×2 only. The first popular cover is the
                other one fetched early: on a phone it is the first campaign under the hero.
              */}
              <CampaignGrid
                campaigns={closing}
                priorityCount={2}
                label={t('closing.gridLabel')}
                cardCopy={cardCopy}
                locale={locale}
                layout={HOME_SPLIT_GRID}
                coverClassName="lg:aspect-[16/6.72]"
                itemClassName={(card, index) =>
                  [splitIds.has(card.id) ? '' : 'lg:hidden', index === 0 ? '' : PHONE_FIRST_ONLY]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
            </HomeSection>
          </div>
        )}

        {closing.length > 0 && featured.length === 0 && (
          <HomeSection
            heading={t('closing.heading')}
            standfirst={t('closing.standfirst')}
            href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'ending_soon' })}
            linkLabel={t('closing.link')}
          >
            <CampaignGrid
              campaigns={closing}
              priorityCount={1}
              label={t('closing.gridLabel')}
              cardCopy={cardCopy}
              locale={locale}
              itemClassName={(_card, index) => (index === 0 ? undefined : PHONE_FIRST_ONLY)}
            />
          </HomeSection>
        )}

        {launched.length > 0 && (
          <HomeSection
            heading={t('launched.heading')}
            standfirst={t('launched.standfirst')}
            href={toHref({ ...NO_FILTERS, statuses: ['live'], sort: 'newest' })}
            linkLabel={t('launched.link')}
            className={DIVIDED}
            controls={
              <RailControls
                target={LAUNCHED_RAIL}
                previous={t('rail.previous')}
                next={t('rail.next')}
              />
            }
          >
            {/*
              A ROW FROM `lg`, a grid below it. Kickstarter's shape for a list that is a
              sample of something larger: one line of cards and two arrows, rather than a
              second wall of twelve straight after the first.
            */}
            <CampaignGrid
              id={LAUNCHED_RAIL}
              campaigns={launched}
              label={t('launched.gridLabel')}
              cardCopy={cardCopy}
              locale={locale}
              layout={HOME_RAIL}
              itemClassName={(_card, index) =>
                index === 0 ? HOME_RAIL_ITEM : `${HOME_RAIL_ITEM} ${PHONE_FIRST_ONLY}`
              }
            />
          </HomeSection>
        )}

        {/*
          FOR CREATORS — three pages side by side from `lg` with a rule down each one's left
          edge (Kickstarter's editorial band), one under another below it. The title is the
          link, so there is no "Learn more" button saying nothing.
        */}
        <section className={`pb-20 ${DIVIDED}`}>
          <FadeUpSection>
            <div className="pb-8">
              <SectionHeading heading={t('creators.heading')} standfirst={t('creators.standfirst')} />
            </div>
          </FadeUpSection>
          <ul
            aria-label={t('creators.label')}
            className="grid list-none grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10"
          >
            {creatorPages.map((page) => (
              <li key={page.href} className="border-l-2 border-white/16 pl-6">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-white">
                  <Link
                    href={page.href}
                    className="group inline-flex items-center gap-2 rounded-sm hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {page.title}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-white/64 transition-transform duration-150 ease-in-out motion-safe:group-hover:translate-x-1"
                    />
                  </Link>
                </h3>
                <p className="mt-3 max-w-[44ch] leading-relaxed text-white/64">{page.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {categories !== null && categories.length > 0 && (
          <HomeSection
            heading={t('categories.heading')}
            standfirst={t('categories.standfirst')}
            href="/categories"
            linkLabel={t('categories.link')}
            className={DIVIDED}
          >
            {/*
              ACCENT TILES, AS THE APP DRAWS THEM (#335). Each category wears its accent and its
              icon from `@ideanest/discovery/category-look`; the name says what the tile is, never
              the hue. Two, four, then five columns: the seeded taxonomy cycles three accents, so
              a column count that is not a multiple of three is what keeps neighbours apart.
            */}
            {/*
              On hover a tile rises, its icon tilts and grows and its arrow steps forward (#341):
              `transform` transitions behind `motion-safe:`, nothing that runs at rest.
            */}
            <ul className="grid list-none grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={categoryPath(category.slug)}
                    data-on-accent=""
                    className={`group flex h-full min-h-[120px] flex-col justify-between gap-4 rounded-xl p-5 text-on-accent transition-transform duration-300 ease-in-out motion-safe:hover:-translate-y-1 motion-safe:focus-visible:-translate-y-1 ${ACCENT_SURFACE[categoryLook(category.slug).accent]}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <CategoryIcon
                        slug={category.slug}
                        className="size-[26px] transition-transform duration-300 ease-in-out motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-115"
                      />
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-on-accent/72 transition-transform duration-300 ease-in-out motion-safe:group-hover:translate-x-1"
                      />
                    </span>
                    <span className="text-base font-medium tracking-[-0.02em] group-hover:underline group-hover:underline-offset-4">
                      {category.name}
                    </span>
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
  className,
  controls,
  children,
}: {
  readonly heading: string;
  readonly standfirst: string;
  readonly href: string;
  readonly linkLabel: string;
  /** Layout from `lg`: a divider, or the subgrid that lines it up with its neighbour. */
  readonly className?: string;
  /** Drawn beside the link — the rail arrows. */
  readonly controls?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className={className === undefined ? 'pb-20' : `pb-20 ${className}`}>
      <FadeUpSection>
        <div className="flex flex-col gap-3 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading heading={heading} standfirst={standfirst} />
          <div className="flex shrink-0 items-center gap-6 max-sm:hidden">
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-2 rounded-sm text-sm font-medium text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
            >
              {linkLabel}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            {controls}
          </div>
        </div>
      </FadeUpSection>

      {children}

      {/*
        ON A PHONE THE WAY ON IS A BUTTON UNDER THE CARD, not a link above it: the band shows
        one campaign (`PHONE_FIRST_ONLY`), and the reader decides whether to see the rest
        after looking at it. Same words and address as the header link it replaces, white
        rather than lime — §1.1 keeps the page's one lime element for urgency.
      */}
      <Link
        href={href}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/16 px-5 text-center text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] sm:hidden"
      >
        {linkLabel}
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </section>
  );
}

/** A band's heading and its one sentence — shared by every band, the featured half included. */
function SectionHeading({
  heading,
  standfirst,
}: {
  readonly heading: string;
  readonly standfirst: string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{heading}</h2>
      <p className="mt-2 max-w-[60ch] text-white/64">{standfirst}</p>
    </div>
  );
}
