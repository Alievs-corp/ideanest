import { publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';
import { toSearchParams, type DiscoveryFilters } from './filters';
import type { AmountBand, CompletionBand, DiscoveryStatus } from './vocabulary';

/**
 * The typed client for `GET /v1/discover` and `GET /v1/discover/facets`.
 *
 * ONE MODULE, ONE PLACE, the same rule `lib/projects/api.ts` states: every
 * discovery call the web application makes belongs here. Shapes come from
 * `DiscoveryResponses`; nothing here invents a field.
 *
 * `publicFetch`, NOT `authorizedFetch`. Discovery is the front door and is
 * `permitAll` — a visitor who has not registered is exactly the audience it
 * exists for, and `authorizedFetch` throws when there is no token, which would
 * make the feed unreachable for everybody it is for.
 *
 * NULL FIELDS ARE ABSENT, NOT NULL. The service serialises with
 * `default-property-inclusion: non_null`, so a campaign with no deadline has no
 * `daysLeft` key at all and the last page has no `nextCursor` key. Every
 * optional field is typed `?: T | null` so the two readings are the same thing
 * to a caller, exactly as the project client does it.
 */

export interface DiscoveryCreator {
  name: string;
  slug: string;
  avatarUrl?: string | null;
}

export interface DiscoveryImage {
  url: string;
  width: number;
  height: number;
}

/**
 * D-05's project card.
 *
 * `completionPercent` IS A STRING, and so are both money amounts. It is a ratio
 * of two money values — the one number a backer reads as "did it make it" — and
 * a JSON number there would be parsed into an IEEE 754 double by every client
 * (§10.3). It is read with `decimal.js` and never with `Number()`.
 */
export interface ProjectCard {
  id: string;
  slug: string;
  creatorSlug: string;
  title: string;
  creator: DiscoveryCreator;
  image?: DiscoveryImage | null;
  /** Absent for a campaign that has not set one — every `PRELAUNCH` row. */
  goal?: Money | null;
  pledged: Money;
  /** To two places, rounded down. Absent when there is no goal. */
  completionPercent?: string | null;
  backersCount: number;
  /** Absent when there is no deadline; zero once it has passed. */
  daysLeft?: number | null;
  /** One of §4.3's status words, or absent — a cancelled campaign. */
  badge?: DiscoveryStatus | null;
  /** The internal state (§6.1), so a client can be specific without a sixth word. */
  state: string;
  launchedAt?: string | null;
  deadline?: string | null;
  /**
   * §4.3's "Closing soon" (IDN-EXT-01, #37): in the seven days after the first deadline, or
   * fourteen days or fewer from the end of funding. Optional so an older response still renders.
   */
  closingSoon?: boolean;
  /** §4.3's "Extended": extended once and still funding. A card can carry both. */
  extended?: boolean;
}

export interface DiscoveryFeed {
  items: readonly ProjectCard[];
  /**
   * Absent on the last page. A SHORT PAGE IS NOT THE END OF THE FEED — only the
   * absence of this is, and a client that stopped on a short page would
   * truncate a feed whose last page happened to be full.
   */
  nextCursor?: string | null;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface NamedCount {
  slug: string;
  name: string;
  count: number;
}

export interface CategoryCount extends NamedCount {
  subcategories: readonly NamedCount[];
}

/**
 * D-10's live faceted counts.
 *
 * A FACET EXCLUDES ITS OWN DIMENSION and applies every other. That is what
 * makes the panel usable: counted under the category filter already chosen,
 * every other category would read zero, and a backer who picked Games could
 * never learn there are four campaigns in Comics matching everything else they
 * chose. The fixed vocabularies answer for all of their values including the
 * empty ones; `tags` lists only tags with campaigns behind them, because the
 * vocabulary is free and unbounded.
 */
export interface DiscoveryFacets {
  status: readonly ValueCount[];
  categories: readonly CategoryCount[];
  tags: readonly NamedCount[];
  completion: readonly ValueCount[];
  goalAmount: readonly ValueCount[];
  amountRaised: readonly ValueCount[];
}

/**
 * Cards per page.
 *
 * Twenty-four, which is the service's own default and divides exactly by two,
 * three, four, and six — every column count the grid takes between a phone and
 * a wide desktop — so a page never ends in a half-filled row.
 */
export const PAGE_SIZE = 24;

/**
 * The query string for a request, filters plus paging.
 *
 * The filters serialise exactly as they do into the address bar, because the
 * parameter names ARE the service's (D-12). The cursor is added here and never
 * there — see the note on `filters.ts`.
 */
export function feedQuery(
  filters: DiscoveryFilters,
  options: { cursor?: string | null; limit?: number } = {},
): string {
  const params = toSearchParams(filters);
  params.set('limit', String(options.limit ?? PAGE_SIZE));
  if (options.cursor != null && options.cursor !== '') params.set('cursor', options.cursor);
  return params.toString();
}

export async function getDiscoveryFeed(
  filters: DiscoveryFilters,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<DiscoveryFeed> {
  const response = await publicFetch(`/v1/discover?${feedQuery(filters, options)}`, {
    signal: options.signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as DiscoveryFeed;
}

/**
 * The counts beside the filter controls.
 *
 * The paging parameters are deliberately not sent. The endpoint accepts and
 * ignores them — a count is over everything the filter matches, not over one
 * page of it — and sending a cursor the panel has no use for would make the
 * request needlessly unique to one point in one reader's scroll.
 */
export async function getDiscoveryFacets(
  filters: DiscoveryFilters,
  options: { signal?: AbortSignal } = {},
): Promise<DiscoveryFacets> {
  const query = toSearchParams(filters).toString();
  const response = await publicFetch(`/v1/discover/facets${query === '' ? '' : `?${query}`}`, {
    signal: options.signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as DiscoveryFacets;
}

/* -------------------------------------------------------------------------
 * Reading the panel
 * ---------------------------------------------------------------------- */

/** The count for one value of a fixed vocabulary, or zero when the panel has not loaded. */
export function countOf(counts: readonly ValueCount[] | undefined, value: string): number {
  return counts?.find((entry) => entry.value === value)?.count ?? 0;
}

/**
 * Slug to translated name, over every category, subcategory, and tag the panel
 * carries.
 *
 * One map rather than three: a chip holds a slug and wants a name, and which
 * dimension it came from does not change the answer. Names are localised by the
 * service against `Accept-Language`, which the browser sends on every fetch.
 */
export function slugNames(facets: DiscoveryFacets | null): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (facets === null) return names;

  for (const category of facets.categories) {
    names.set(category.slug, category.name);
    for (const subcategory of category.subcategories) names.set(subcategory.slug, subcategory.name);
  }
  for (const tag of facets.tags) names.set(tag.slug, tag.name);

  return names;
}

export type { DiscoveryStatus, CompletionBand, AmountBand };
