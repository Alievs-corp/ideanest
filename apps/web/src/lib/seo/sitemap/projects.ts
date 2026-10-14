import { errorFrom } from '../../api/problem';
import type { DiscoveryFeed, ProjectCard } from '../../discovery/api';
import { isIndexableProjectState } from '../indexability';
import { apiOrigin } from './config';

/**
 * WHERE THE SITEMAP'S CAMPAIGNS COME FROM.
 *
 * `GET /v1/discover` with no filters, walked to the end of its cursor. It is the
 * only public listing endpoint the platform has (§10.2), and its unfiltered
 * result set is exactly `DiscoveryStatus.PUBLIC_STATES` — the nine states that
 * may appear on a public surface. The seven hidden ones are therefore already
 * excluded by the service, and `isIndexableProjectState` is applied here anyway:
 * this is the one surface where a leak cannot be recalled, and two independent
 * filters that must both fail before a draft is published are worth the line of
 * code.
 *
 * ## Why not `publicFetch`
 *
 * `lib/api/client.ts` is the right client for the browser and the wrong one
 * here, for three reasons that all point the same way. It issues a
 * SAME-ORIGIN RELATIVE request — `/v1/discover` — which is what makes the
 * `SameSite=Strict` refresh cookie work in a browser and what makes the request
 * unresolvable in Node, where `fetch` requires an absolute URL. There is no
 * server to be same-origin with while `next build` runs. And it reads the
 * in-memory access token, which on the server is a module variable shared by
 * every request and must never be attached to a crawl-facing read.
 *
 * So this reads the service directly at `IDEANEST_API_ORIGIN` — the same
 * variable `next.config.mjs` proxies the browser's `/v1` to, so there is still
 * one answer per environment to "where is the API". The response types are
 * imported from `lib/discovery/api.ts` rather than restated.
 */

/** What the sitemap needs from a campaign, and nothing else. */
export interface SitemapProject {
  readonly creatorSlug: string;
  readonly slug: string;
  /** One of the seventeen states of §6.1, as text. */
  readonly state: string;
  readonly launchedAt?: string | null;
  readonly deadline?: string | null;
}

/**
 * `DiscoveryQuery.MAX_LIMIT`. A larger value is clamped by the service and a
 * smaller one is more round trips for the same rows.
 */
export const DISCOVERY_PAGE_LIMIT = 100;

/**
 * The most pages one walk will read — 50,000 campaigns.
 *
 * A bound rather than a budget. A cursor that never terminates is a request
 * that never returns, and a sitemap route that hangs takes the crawl and the
 * build with it. If the platform ever passes this, the walk is the wrong shape
 * and the service needs an endpoint built for it — see the note in
 * `apps/web/README.md`.
 */
export const MAX_DISCOVERY_PAGES = 500;

/** How long one walk is reused. See `indexableProjects`. */
const CACHE_TTL_MS = 15 * 60 * 1000;

type Env = Record<string, string | undefined>;

interface FetchOptions {
  readonly env?: Env;
  readonly signal?: AbortSignal;
}

function feedUrl(base: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(DISCOVERY_PAGE_LIMIT) });
  if (cursor !== null) params.set('cursor', cursor);
  return `${base}/v1/discover?${params.toString()}`;
}

/**
 * A card is usable only if it can be turned into a URL.
 *
 * Both slugs are required fields on `ProjectCard`, so an absent one is a service
 * that has changed shape rather than a campaign in an unusual state. Dropping
 * the row is right either way: `/projects//ceramics` is not a URL that exists,
 * and publishing it would put a 404 in front of a crawler and hide the fault.
 */
function usable(card: ProjectCard): boolean {
  return (
    typeof card.creatorSlug === 'string' &&
    card.creatorSlug !== '' &&
    typeof card.slug === 'string' &&
    card.slug !== ''
  );
}

function toSitemapProject(card: ProjectCard): SitemapProject {
  return {
    creatorSlug: card.creatorSlug,
    slug: card.slug,
    state: card.state,
    launchedAt: card.launchedAt,
    deadline: card.deadline,
  };
}

/**
 * Every indexable campaign, read fresh.
 *
 * A REFUSAL IS RAISED, NOT SWALLOWED. Returning what had been collected so far
 * would publish a sitemap that says the missing campaigns no longer exist, which
 * is the one statement about them that is definitely false. A 500 on a sitemap
 * is read by a crawler as "come back later" and leaves the previous crawl's
 * understanding intact.
 */
export async function fetchIndexableProjects(
  options: FetchOptions = {},
): Promise<readonly SitemapProject[]> {
  const base = apiOrigin(options.env ?? process.env);
  const projects: SitemapProject[] = [];
  const seenCursors = new Set<string>();
  /*
   * A `<loc>` twice in one sitemap is a defect, not a duplicate vote. Two pages
   * of a cursor-paginated feed can overlap when a campaign's sort key changes
   * between them — `newest` is stable, but `pledged_amount` is not, and this
   * walk should not depend on which order the service happens to default to.
   */
  const emitted = new Set<string>();

  let cursor: string | null = null;

  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    const response = await fetch(feedUrl(base, cursor), {
      signal: options.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw await errorFrom(response);

    const feed = (await response.json()) as DiscoveryFeed;

    for (const card of feed.items ?? []) {
      if (!usable(card) || !isIndexableProjectState(card.state)) continue;

      const key = `${card.creatorSlug}/${card.slug}`;
      if (emitted.has(key)) continue;
      emitted.add(key);

      projects.push(toSitemapProject(card));
    }

    const next = feed.nextCursor;
    // ABSENCE OF A CURSOR IS THE END OF THE FEED, and a short page is not — a
    // client that stopped on a short page would truncate a feed whose last page
    // happened to be full.
    if (next == null || next === '') return projects;

    // A repeated cursor is a service bug, and following it is an infinite loop
    // rather than a slow read.
    if (seenCursors.has(next)) return projects;
    seenCursors.add(next);
    cursor = next;
  }

  return projects;
}

/**
 * The same walk, reused for a quarter of an hour.
 *
 * TWO CALLERS, ONE WALK. Next calls `generateSitemaps` and then the segment
 * handler within a single request: the first needs the count to decide how many
 * shards there are, the second needs the slice. Without this they would each
 * walk the whole feed, so a two-shard platform would read it four times per
 * crawl of one file.
 *
 * The promise is memoised rather than the result, so two concurrent requests
 * share one walk instead of racing. A REJECTION IS NOT CACHED: a failed read is
 * cleared immediately, because fifteen minutes of serving the error from a
 * blink that lasted a second is worse than the read itself.
 */
let walk: { readonly at: number; readonly projects: Promise<readonly SitemapProject[]> } | null =
  null;

export async function indexableProjects(): Promise<readonly SitemapProject[]> {
  const now = Date.now();
  if (walk !== null && now - walk.at < CACHE_TTL_MS) return walk.projects;

  const projects = fetchIndexableProjects();
  const entry = { at: now, projects };
  walk = entry;

  try {
    return await projects;
  } catch (error) {
    if (walk === entry) walk = null;
    throw error;
  }
}

/** Drops the memo. For tests, and for a deliberate refresh. */
export function clearIndexableProjectsCache(): void {
  walk = null;
}
