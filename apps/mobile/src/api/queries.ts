import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GetQueryParams, GetResponse } from '@ideanest/api-client';
import { PAGE_SIZE, type DiscoveryFacets } from '@ideanest/discovery/facets';
import { filterKey, toSearchParams, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { api } from './client';

/**
 * Every read this application makes, as a hook — and every query key, in one
 * place.
 *
 * <h2>Why the keys are here and not at the call sites</h2>
 *
 * `lib/offline.ts` decides what survives a restart by looking at the first
 * element of a query key. A key spelled at the call site is a key that can be
 * spelled two ways, and the second spelling silently stops being cached — a bug
 * that only shows up on a phone with no signal, which is the one place nobody is
 * looking. Naming them once means the persistence rule and the queries cannot
 * drift apart.
 */

export type Feed = GetResponse<'/v1/discover'>;
export type Card = NonNullable<Feed['items']>[number];
export type Suggestions = GetResponse<'/v1/search/suggest'>;
export type Suggestion = NonNullable<Suggestions['items']>[number];
export type ProjectPage = GetResponse<'/v1/projects/{creatorSlug}/{projectSlug}'>;
export type PublicRewards = GetResponse<'/v1/projects/{projectId}/rewards/public'>;
export type ProjectUpdates = GetResponse<'/v1/projects/{projectId}/updates'>;
export type SavedList = GetResponse<'/v1/me/saved'>;
export type PledgeList = GetResponse<'/v1/me/pledges'>;

/**
 * The roots in `lib/offline.ts`'s persistence list are the string literals
 * below. Changing one without changing the other is what this object exists to
 * make hard. `discover`, `discoverFacets`, `search` and `suggestions` are not on
 * that list, on purpose: a feed is only true for a moment, and one restored
 * after a restart would show campaigns that have since closed (#153).
 */
export const queryKeys = {
  /** Keyed by `filterKey`: the filters and the sort, and nothing else (no cursor). */
  discover: (key: string) => ['discover', key] as const,
  discoverFacets: (key: string) => ['discoverFacets', key] as const,
  search: (query: DiscoveryQuery) => ['search', query] as const,
  suggestions: (term: string) => ['suggestions', term] as const,
  project: (creatorSlug: string, projectSlug: string) =>
    ['project', creatorSlug, projectSlug] as const,
  projectRewards: (projectId: string) => ['project', projectId, 'rewards'] as const,
  projectUpdates: (projectId: string) => ['project', projectId, 'updates'] as const,
  saved: () => ['saved'] as const,
  pledges: () => ['pledges'] as const,
} as const;

/**
 * The query the search screen sends.
 *
 * Every field is **taken from the generated contract** rather than declared as
 * `string`: `category` is a list, because the service binds a `MultiValueMap`,
 * and `sort` is the contract's closed set. The contract's set has eight names;
 * `relevance` and `near_me` are answered `DISCOVERY_OPTION_UNSUPPORTED` (#44,
 * #47) and no screen offers them — `@ideanest/discovery/vocabulary`'s `SORTS`
 * is the list a screen draws, not this type.
 */
type DiscoveryParams = NonNullable<GetQueryParams<'/v1/discover'>>;

export interface DiscoveryQuery {
  readonly q?: DiscoveryParams['q'];
  readonly category?: DiscoveryParams['category'];
  readonly sort?: DiscoveryParams['sort'];
}

/**
 * How many cards one page of a feed carries: the web's 24 (`@ideanest/discovery/facets`), so
 * "24 projects shown, more available" means the same on both.
 */
export const FEED_PAGE_SIZE = PAGE_SIZE;

/**
 * The request's parameters for a filter set: exactly what the web writes into its address bar
 * and sends, from the shared `toSearchParams` — comma-joined lists, the default sort omitted.
 *
 * The cast is the one place the generated types are bent. The contract types each list as an
 * array, and the client would send an array as repeated parameters; the service binds both forms
 * (`DiscoveryQueryBinder`), and sending the web's form means one request on either platform is
 * the same URL.
 */
export function discoveryParams(filters: DiscoveryFilters): DiscoveryParams {
  const params: Record<string, string> = {};
  for (const [name, value] of toSearchParams(filters)) params[name] = value;
  return params as DiscoveryParams;
}

/**
 * The discovery feed for a filter set, paged by cursor.
 *
 * `getNextPageParam` returns `undefined` — not `null` — at the end, because that
 * is the value TanStack Query reads as "there is no next page". Returning `null`
 * leaves `hasNextPage` true and the list asks for the same page for ever.
 *
 * The key is `filterKey`, so changing a filter is a new query that starts from the first page,
 * and a cursor is never replayed against a filter set it was not issued for (the service would
 * answer `400 DISCOVERY_CURSOR_MISMATCH`).
 */
export function useDiscoveryFeed(filters: DiscoveryFilters, options: { limit?: number } = {}) {
  const limit = options.limit ?? FEED_PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: [...queryKeys.discover(filterKey(filters)), limit] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api().get('/v1/discover', {
        query: { ...discoveryParams(filters), limit, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page: Feed) => page.nextCursor ?? undefined,
  });
}

/**
 * The facet counts beside the filter controls, for a filter set.
 *
 * Not retried and never an error on screen: a panel without counts still filters, which is what
 * the web does when the request fails — the counts are blank and the category and tag lists are
 * empty. The previous counts stay while the next ones load, so a box does not flicker to blank
 * every time another is ticked.
 *
 * The response is normalised to the shared `DiscoveryFacets`, whose lists are never absent:
 * `blameFor` and the sheet read it without a guard on every field.
 */
export function useDiscoveryFacets(filters: DiscoveryFilters) {
  return useQuery({
    queryKey: queryKeys.discoverFacets(filterKey(filters)),
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<DiscoveryFacets> => {
      const facets = await api().get('/v1/discover/facets', {
        query: discoveryParams(filters),
        signal,
      });
      return {
        status: (facets.status ?? []).map(valueCount),
        categories: (facets.categories ?? []).map((category) => ({
          ...namedCount(category),
          subcategories: (category.subcategories ?? []).map(namedCount),
        })),
        tags: (facets.tags ?? []).map(namedCount),
        completion: (facets.completion ?? []).map(valueCount),
        goalAmount: (facets.goalAmount ?? []).map(valueCount),
        amountRaised: (facets.amountRaised ?? []).map(valueCount),
      };
    },
  });
}

function valueCount(entry: { value?: string; count?: number }) {
  return { value: entry.value ?? '', count: entry.count ?? 0 };
}

function namedCount(entry: { slug?: string; name?: string; count?: number }) {
  return { slug: entry.slug ?? '', name: entry.name ?? entry.slug ?? '', count: entry.count ?? 0 };
}

/** Full-text search, paged the same way. */
export function useSearchResults(query: DiscoveryQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.search(query),
    enabled,
    /*
     * The last query's results stay while the next one loads. Every key from the third character
     * is a new query key, and without this each one starts empty — the screen fell back to its
     * loading state at every keystroke, and the list flashed to a skeleton and back while the
     * reader typed.
     */
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api().get('/v1/search', {
        query: { ...query, limit: FEED_PAGE_SIZE, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page: Feed) => page.nextCursor ?? undefined,
  });
}

/**
 * Type-ahead suggestions.
 *
 * Not persisted and not retried. A suggestion that arrives after the person has
 * finished typing is worse than none, and a failed one costs nothing.
 */
export function useSuggestions(term: string) {
  return useQuery({
    queryKey: queryKeys.suggestions(term),
    enabled: term.trim().length >= 2,
    retry: false,
    queryFn: ({ signal }) =>
      /*
       * `limit` is declared as a string in the contract rather than as an
       * integer, so it is sent as one. Passing a number here would be a
       * type error rather than a 400 nobody notices in a suggestion box.
       */
      api().get('/v1/search/suggest', { query: { q: term.trim(), limit: '10' }, signal }),
  });
}

/** One campaign, by the pair of slugs its public URL carries. */
export function useProjectPage(creatorSlug: string, projectSlug: string) {
  return useQuery({
    queryKey: queryKeys.project(creatorSlug, projectSlug),
    queryFn: ({ signal }) =>
      api().get('/v1/projects/{creatorSlug}/{projectSlug}', {
        path: { creatorSlug, projectSlug },
        signal,
      }),
  });
}

/** The reward tiers a visitor may see. Separate from the campaign, as the contract has them. */
export function useProjectRewards(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectRewards(projectId ?? ''),
    enabled: projectId !== undefined,
    queryFn: ({ signal }) =>
      api().get('/v1/projects/{projectId}/rewards/public', {
        path: { projectId: projectId as string },
        signal,
      }),
  });
}

/** A campaign's updates, newest first, first page only on this screen. */
export function useProjectUpdates(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectUpdates(projectId ?? ''),
    enabled: projectId !== undefined,
    queryFn: ({ signal }) =>
      api().get('/v1/projects/{projectId}/updates', {
        path: { projectId: projectId as string },
        query: { limit: 5 },
        signal,
      }),
  });
}

/** What this account saved. One of the two lists §4.12 MB-04 promises offline. */
export function useSavedProjects(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.saved(),
    enabled,
    queryFn: ({ signal }) => api().get('/v1/me/saved', { signal }),
  });
}

/** What this account backed. The other one. */
export function usePledges(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.pledges(),
    enabled,
    queryFn: ({ signal }) => api().get('/v1/me/pledges', { signal }),
  });
}
