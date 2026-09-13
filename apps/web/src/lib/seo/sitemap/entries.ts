import type { MetadataRoute } from 'next';

import { fetchCategories, fetchCollections } from '../../api/server';
import { categoryPath, subcategoryPath } from '../../categories/api';
import { COLLECTIONS_PATH, collectionPath } from '../../collections/api';
import { isIndexableProjectState } from '../indexability';
import { localisedEntries } from './localised';
import type { SitemapProject } from './projects';

/**
 * Turning data into `<url>` entries.
 *
 * Pure, and deliberately so: everything decided here — which campaigns are
 * listed, what date is claimed for them, what is said about how often they
 * change — is a statement to a crawler, and each one is tested rather than
 * reviewed.
 */

type SitemapEntry = MetadataRoute.Sitemap[number];
type ChangeFrequency = NonNullable<SitemapEntry['changeFrequency']>;

/**
 * The static pages.
 *
 * `/` WAS LISTED BEFORE IT EXISTED, on the argument that this list is the platform's public
 * URL contract (§4.4, §10.2) rather than an inventory of the routes that happen to be built.
 * #264 built it. `/categories` joins it as WS-05's index — the page every category landing
 * page hangs from, and the one a crawler walks to find them.
 *
 * WS-07's three static pages join it with #292. They are the pages a search for "is IdeaNest
 * legitimate" should be able to reach, which is exactly the query a sitemap exists to answer;
 * they are also the only routes on the platform whose content is entirely editorial, so a
 * crawler that finds them finds something worth indexing rather than a shell around a feed.
 *
 * `/collections` joins it with #266, on exactly the terms `/categories` did: it is D-08's index
 * and the only page on the site that links to a collection landing page. It is here rather than
 * in `DISCOVERY_PATHS` for the same reason `/categories` is — the index itself is a fixed route
 * whose address never changes, and the pages hanging off it are data, listed by
 * `discoveryEntries`.
 *
 * Nothing here claims a `lastModified`: these pages are code, their content
 * changes when this application is deployed, and this module has no honest way
 * to know when that was. An invented date — `new Date()`, say — tells a crawler
 * that every page changed on every crawl, which is the fastest way to have
 * `<lastmod>` ignored altogether.
 *
 * `/search` IS DELIBERATELY ABSENT and `/maintenance` with it. Both are `noindex` and both are
 * in `PRIVATE_PATH_PREFIXES`, and a sitemap must never advertise a URL robots.txt blocks —
 * the contradiction is reported in Search Console and resolved in the crawler's favour, which
 * means the whole file is trusted less.
 */
export const PAGE_PATHS: readonly string[] = Object.freeze([
  '/',
  '/categories',
  COLLECTIONS_PATH,
  '/about',
  '/how-it-works',
  '/trust-safety',
  /*
   * §22.2's index -- #439. The eight documents themselves are deliberately not listed
   * individually: `/legal` links to every one of them and a crawler follows links, so eight
   * more entries would be eight rows saying what one row already says. What the index adds
   * over them is the state of each, which is the thing worth landing on.
   *
   * The archived versions at `/legal/{document}/v/{version}` are `noindex` by construction --
   * superseded terms must not outrank the ones in force -- so advertising them here would be
   * the contradiction this file's own header warns about.
   */
  '/legal',
]);

/**
 * Discovery.
 *
 * ONE STATIC URL, AND THEN THE TAXONOMY. This constant used to be `['/discover']` alone, with
 * a comment explaining that §4.3's fifteen categories and hundred-odd subcategories "would
 * make excellent landing pages" and that the only URL reaching one was
 * `/discover?category=games` — which robots.txt disallows, and which a sitemap therefore must
 * not advertise.
 *
 * #265 built the path-based routes. They are not in this constant because they are not
 * constant: the taxonomy is data, editable without a deployment (§4.3), so the segment reads
 * it at request time — see `discoveryEntries`.
 */
export const DISCOVERY_PATHS: readonly string[] = Object.freeze(['/discover']);

/** §10.2's canonical public project URL. */
export function projectPath(creatorSlug: string, projectSlug: string): string {
  return `/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`;
}

function parsed(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When the campaign's page last actually changed, as far as the public listing
 * can say.
 *
 * `GET /v1/discover` carries two timestamps and no `updatedAt`, so these two are
 * what there is:
 *
 *   - `launchedAt` — the campaign became a public page.
 *   - `deadline`, ONCE IT HAS PASSED — the page changed at that moment, from a
 *     campaign taking pledges to one that succeeded or did not. A deadline in
 *     the future is not a modification; it is a promise, and claiming it as
 *     `<lastmod>` would date every live campaign months ahead.
 *
 * ABSENT RATHER THAN INVENTED. A campaign with neither gets no `<lastmod>` at
 * all. `<lastmod>` is the one field a crawler uses to decide whether to spend a
 * request, and a field that always says "now" is a field that gets ignored — for
 * this campaign and for every other one in the file.
 */
export function lastModifiedOf(project: SitemapProject, now: Date): Date | undefined {
  const launched = parsed(project.launchedAt);
  const deadline = parsed(project.deadline);
  const passed = deadline !== null && deadline.getTime() <= now.getTime() ? deadline : null;

  const candidates = [launched, passed].filter((date): date is Date => date !== null);
  if (candidates.length === 0) return undefined;

  return new Date(Math.max(...candidates.map((date) => date.getTime())));
}

/**
 * How often the page changes. A statement about the content, and true.
 *
 * A live campaign's page carries an amount raised, a backer count and a
 * countdown, and all three move daily. A campaign in fulfilment posts updates
 * over weeks. A completed or unsuccessful one is finished — its page will not
 * change again, and `yearly` is as close as the vocabulary gets to saying so
 * without `never`, which sitemaps.org reserves for archived URLs.
 *
 * There is no `priority` anywhere in this file, and that is the considered
 * answer rather than an omission. `<priority>` asks for the relative importance
 * of a URL *within this site*, on a scale with no defined meaning; Google states
 * plainly that it ignores the field, and there is no number here that would be
 * true if it did not. A field invented to fill a column is a field a reviewer
 * has to pretend to check.
 */
function changeFrequencyFor(state: string): ChangeFrequency {
  switch (state) {
    case 'LIVE':
    case 'CLOSING_WINDOW':
    case 'EXTENDED':
    case 'LATE_PLEDGE':
      return 'daily';
    case 'SUCCESSFUL':
    case 'WITHDRAWN':
    case 'COLLECTING':
    case 'FULFILLING':
      return 'monthly';
    default:
      return 'yearly';
  }
}

/**
 * The project entries for a set of campaigns.
 *
 * THE PREDICATE IS APPLIED HERE TOO. `fetchIndexableProjects` already filtered,
 * and the service filtered before that. This is the last gate before a URL is
 * written into a file a search engine reads, and it costs one call.
 */
export function projectEntries(
  projects: readonly SitemapProject[],
  baseUrl: string,
  now: Date,
): MetadataRoute.Sitemap {
  return projects
    .filter((project) => isIndexableProjectState(project.state))
    .map((project) => {
      const lastModified = lastModifiedOf(project, now);

      return localisedEntries(projectPath(project.creatorSlug, project.slug), baseUrl, {
        // Written conditionally rather than as `undefined`, so that the object a
        // test compares is the object the XML is built from.
        ...(lastModified === undefined ? {} : { lastModified }),
        changeFrequency: changeFrequencyFor(project.state),
      });
    })
    .flat();
}

function pathEntries(paths: readonly string[], baseUrl: string): MetadataRoute.Sitemap {
  /*
   * One path in, four entries out — `localised.ts` explains why the `hreflang` map on each
   * of them repeats the whole set rather than naming only the others.
   */
  return paths.flatMap((path) => localisedEntries(path, baseUrl, { changeFrequency: 'daily' }));
}

/** The `pages` segment. */
export function pageEntries(baseUrl: string): MetadataRoute.Sitemap {
  return pathEntries(PAGE_PATHS, baseUrl);
}

/**
 * The `discovery` segment: the feed, one entry per category and subcategory, and one per
 * curated collection.
 *
 * <h2>Why the taxonomy is read here rather than listed above</h2>
 *
 * §4.3 requires the taxonomy to be editable without a deployment, so a frozen array of a
 * hundred paths would be a sitemap that is wrong the first time an administrator renames
 * anything. The segment is already `force-dynamic` (`app/sitemap.ts` explains why), and
 * `fetchCategories` caches the read for an hour, so a crawl of several segments costs one
 * request to the service.
 *
 * <h2>The collections are read on exactly the same terms — #266</h2>
 *
 * A collection is created, published, and withdrawn by a curator through the admin console
 * (§4.11 AD-08's sibling), so the set of collection URLs is data in precisely the way the
 * taxonomy is. They are listed here rather than in `PAGE_PATHS` because they are not code, and
 * they belong in the `discovery` segment rather than a segment of their own because a
 * collection page is a list of campaigns — the same kind of URL as a category page, with the
 * same reason for existing.
 *
 * **AND ONLY THE ONES THE SERVICE ACTUALLY LISTS.** `GET /v1/collections` answers with the
 * published, in-window collections and nothing else, so an unpublished one cannot reach this
 * file. That matters more than it looks: a sitemap entry for a URL that answers 404 is a
 * reported error against the whole file, and here it would additionally be an announcement of
 * a collection the platform has not published — which is exactly what
 * `CollectionController`'s 404-not-403 rule exists to prevent.
 *
 * The two reads are concurrent, because they are independent and a sitemap segment that
 * serialised them would take two round trips to answer one request.
 *
 * <h2>A failed read is the feed alone, never an exception</h2>
 *
 * Both readers answer `null` when the service refuses or cannot be reached. A sitemap that
 * 500s is a sitemap Search Console reports as an error against the whole site; one that is
 * briefly shorter is a sitemap. `/discover` is always in it, so the segment is never empty.
 *
 * <h2>`daily`, like the feed</h2>
 *
 * `pathEntries` claims `daily` for every path it writes, and that is as true of a category or
 * collection landing page as of the feed: what changes on one is which campaigns are listed
 * and how far along they are, and both move every day. No `lastModified`, for the reason
 * `PAGE_PATHS` gives — nothing here knows when the page last actually changed.
 */
export async function discoveryEntries(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  const [categories, collections] = await Promise.all([fetchCategories(), fetchCollections()]);

  const taxonomyPaths = (categories ?? []).flatMap((category) => [
    categoryPath(category.slug),
    ...category.subcategories.map((subcategory) => subcategoryPath(category.slug, subcategory.slug)),
  ]);

  const collectionPaths = (collections ?? []).map((collection) => collectionPath(collection.slug));

  return pathEntries([...DISCOVERY_PATHS, ...taxonomyPaths, ...collectionPaths], baseUrl);
}
