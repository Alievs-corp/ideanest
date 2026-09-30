import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GetQueryParams, GetResponse } from '@ideanest/api-client';
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
export type ProjectPage = GetResponse<'/v1/projects/{creatorSlug}/{projectSlug}'>;
export type PublicRewards = GetResponse<'/v1/projects/{projectId}/rewards/public'>;
export type ProjectUpdates = GetResponse<'/v1/projects/{projectId}/updates'>;
export type SavedList = GetResponse<'/v1/me/saved'>;
export type PledgeList = GetResponse<'/v1/me/pledges'>;

/**
 * The roots in `lib/offline.ts`'s persistence list are the string literals
 * below. Changing one without changing the other is what this object exists to
 * make hard.
 */
export const queryKeys = {
  discover: (query: DiscoveryQuery) => ['discover', query] as const,
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
 * The subset of the discovery filters these screens expose.
 *
 * `category` is a LIST because the service binds a `MultiValueMap` — a campaign
 * feed can be narrowed to several categories at once, and the contract says so.
 * Declaring it as one string here would have compiled against a hand-written
 * fetch and been silently wrong; it does not compile against the generated
 * types, which is the reason `@ideanest/api-client` exists.
 */
/**
 * The subset of the discovery filters these screens expose.
 *
 * Every field is **taken from the generated contract** rather than declared as
 * `string`. Two of them would have been wrong if they had been: `category` is a
 * list, because the service binds a `MultiValueMap` and a feed can be narrowed
 * to several at once; `sort` is a closed set of eight names, and an unknown one
 * is a 400 nobody sees until a screen is empty. Deriving them means the day
 * `DiscoverySort` grows a ninth entry, this compiles against it.
 */
type DiscoveryParams = NonNullable<GetQueryParams<'/v1/discover'>>;

export interface DiscoveryQuery {
  readonly q?: DiscoveryParams['q'];
  readonly category?: DiscoveryParams['category'];
  readonly sort?: DiscoveryParams['sort'];
}

/** How many cards one page of a feed carries. */
export const FEED_PAGE_SIZE = 20;

/**
 * The discovery feed, paged.
 *
 * `getNextPageParam` returns `undefined` — not `null` — at the end, because that
 * is the value TanStack Query reads as "there is no next page". Returning `null`
 * leaves `hasNextPage` true and the list asks for the same page for ever.
 */
export function useDiscoveryFeed(query: DiscoveryQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.discover(query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api().get('/v1/discover', {
        query: { ...query, limit: FEED_PAGE_SIZE, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page: Feed) => page.nextCursor ?? undefined,
  });
}

/** Full-text search, paged the same way. */
export function useSearchResults(query: DiscoveryQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.search(query),
    enabled,
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
      api().get('/v1/search/suggest', { query: { q: term.trim(), limit: '8' }, signal }),
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
