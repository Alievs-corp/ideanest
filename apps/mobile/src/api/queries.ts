import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GetQueryParams, GetResponse } from '@ideanest/api-client';
import { PAGE_SIZE, type DiscoveryFacets } from '@ideanest/discovery/facets';
import {
  collectionFrom,
  collectionQueryParams,
  collectionsFrom,
  type Collection,
} from '@ideanest/discovery/collections';
import { filterKey, toSearchParams, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { readUpdateObligation, type UpdateObligation } from '@ideanest/campaign/obligation';
import { taxonomyFrom } from '@ideanest/discovery/taxonomy';
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
export type { Category, Subcategory } from '@ideanest/discovery/taxonomy';
export type { Collection } from '@ideanest/discovery/collections';
export type CollectionPage = GetResponse<'/v1/collections/{slug}'>;
export type ProjectPage = GetResponse<'/v1/projects/{creatorSlug}/{projectSlug}'>;
export type PublicRewards = GetResponse<'/v1/projects/{projectId}/rewards/public'>;
export type ProjectUpdates = GetResponse<'/v1/projects/{projectId}/updates'>;
export type PrelaunchPage = GetResponse<'/v1/projects/{id}/prelaunch'>;
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
  search: (query: string) => ['search', query] as const,
  categories: () => ['categories'] as const,
  collections: () => ['collections'] as const,
  /** The collection and its pages, by slug. Not under `project`, which is persisted. */
  collection: (slug: string) => ['collection', slug] as const,
  suggestions: (term: string) => ['suggestions', term] as const,
  project: (creatorSlug: string, projectSlug: string) =>
    ['project', creatorSlug, projectSlug] as const,
  projectRewards: (projectId: string) => ['project', projectId, 'rewards'] as const,
  checkoutRewards: (projectId: string, tokens: readonly string[]) =>
    ['project', projectId, 'rewards', 'checkout', ...tokens] as const,
  feeDisclosure: (projectId: string) => ['project', projectId, 'fee-disclosure'] as const,
  legalDocument: (kind: string) => ['legal', kind] as const,
  /**
   * The legal pages (#164): the catalogue, a document in force, an archived version — each in the
   * language asked for. `legalDocs` rather than `legal`, so the checkout's agreement version above
   * is not persisted with them: these are versioned, hash-stamped texts that stay honest on disk,
   * and that number is what a pledge is accepted against.
   */
  legalCatalogue: (locale: string) => ['legalDocs', 'catalogue', locale] as const,
  legalText: (kind: string, locale: string) => ['legalDocs', kind, locale, 'current'] as const,
  legalArchived: (kind: string, locale: string, version: number) =>
    ['legalDocs', kind, locale, version] as const,
  /**
   * Pricing (#164): the plans, what this account holds, and the platform's fee terms. None is
   * persisted: a stale price or entitlement restored after a restart would mislead somebody about
   * to pay. `plans` and `fees` are public; `subscription` is this account's.
   */
  plans: () => ['plans'] as const,
  mySubscription: () => ['subscription'] as const,
  platformFeeDisclosure: () => ['fees', 'platform'] as const,
  pledge: (id: string) => ['pledges', id] as const,
  /** The Updates tab's pages (#155), under `project` so they survive a restart with the page. */
  projectUpdates: (projectId: string) => ['project', projectId, 'updates'] as const,
  /**
   * The public pre-launch page (#155). Under `project`, so it survives a restart like the campaign
   * page: it is public — a title, a blurb, a cover and a count — and nothing in it is anybody's.
   */
  prelaunch: (projectId: string) => ['project', projectId, 'prelaunch'] as const,
  saved: () => ['saved'] as const,
  /** The saved list's pages (#159), under `saved`: invalidating `saved()` refreshes it. */
  savedList: () => ['saved', 'list'] as const,
  /** The campaigns this account started (#159), drafts included. Persisted, private. */
  myProjects: () => ['myProjects'] as const,
  /** The creators this account follows (#159). Persisted, private. */
  following: () => ['following'] as const,
  /** The surveys this account is being asked (#159), answers included. Persisted, private. */
  surveys: () => ['surveys'] as const,
  /** Where each reward this account is owed is (#159). Persisted, private; not paged. */
  fulfilments: () => ['fulfilments'] as const,
  pledges: () => ['pledges'] as const,
  pledgeList: () => ['pledges', 'list'] as const,
  shippingAddress: (pledgeId: string) => ['shippingAddress', pledgeId] as const,
  /*
   * The campaign page's other reads (#155). Every key a tab of that page needs is named here
   * already, so the tabs can be built in parallel without two changes to this object.
   */
  /**
   * §5.5's update clock for one campaign — the notice above the tabs. Under `project`, so it
   * survives a restart with the page it belongs to; `null` when the campaign has no clock.
   */
  projectObligation: (projectId: string) => ['project', projectId, 'obligation'] as const,
  /** The FAQ tab's list (at most fifty, unpaged). Under `project`, persisted with the page. */
  projectFaqs: (projectId: string) => ['project', projectId, 'faqs'] as const,
  /**
   * The Comments tab: one query per campaign and thread (`''` for every thread). Its own root,
   * `comments`, which `lib/offline.ts` never persists: a withdrawn or moderated comment must not
   * survive in a stranger's offline cache.
   */
  comments: (projectId: string, thread: string | null) =>
    ['comments', projectId, thread ?? ''] as const,
  /**
   * A public profile and its campaigns — #156's screen and the campaign page's Creator tab. Its
   * own root, `profile`, not persisted: a profile is somebody else's, and one restored from last
   * week would describe a person as they no longer describe themselves.
   */
  profile: (slug: string) => ['profile', slug] as const,
  profileProjects: (slug: string) => ['profile', slug, 'projects'] as const,
  /** The profile screen's Backed list (#156), paged; no amounts on it, ever. */
  profileBacked: (slug: string) => ['profile', slug, 'backed'] as const,
  /** §5.5's late-update count for a creator (#156), above the profile's tabs. */
  profileObligations: (slug: string) => ['profile', slug, 'obligations'] as const,
  /** Whether `viewer` follows `slug` (#156), walked from `GET /v1/me/following`. */
  profileFollowing: (slug: string, viewer: string) =>
    ['profile', slug, 'following', viewer] as const,
  /** `GET /v1/exchange-rates`: public, and an hour old at worst. */
  exchangeRates: () => ['exchangeRates'] as const,
  /**
   * The account settings screens (#161). One root, `settings`, never persisted: devices and their
   * IP addresses, a VÖEN and a payout card do not belong in an unencrypted store.
   */
  ownProfile: () => ['settings', 'profile'] as const,
  locations: () => ['settings', 'locations'] as const,
  sessions: () => ['settings', 'sessions'] as const,
  notificationPreferences: () => ['settings', 'notifications'] as const,
  profileVisibility: (slug: string) => ['settings', 'visibility', slug] as const,
  legalSubject: () => ['settings', 'legalSubject'] as const,
  payoutDestination: () => ['settings', 'payoutDestination'] as const,
  /**
   * The inbox's pages (#160). Its own root, `inbox`, never persisted: notifications are
   * time-sensitive, and last week's unread rows restored after a restart would read as news.
   */
  inbox: () => ['inbox'] as const,
} as const;

/**
 * The feed's query parameters, from the generated contract. Its `sort` is a closed set of eight
 * names; `relevance` and `near_me` are answered `DISCOVERY_OPTION_UNSUPPORTED` (#44, #47) and no
 * screen offers them — `@ideanest/discovery/vocabulary`'s `SORTS` is the list a screen draws, not
 * this type.
 */
type DiscoveryParams = NonNullable<GetQueryParams<'/v1/discover'>>;

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

/**
 * The Search tab's results for a query: the first page only, at most 24, as the web's `/search`
 * shows them. More is one tap away in the Discover feed, where the filters are, so this screen
 * never pages.
 *
 * Disabled for an empty query: no text, no request. Not retried and not kept across restarts,
 * like every feed.
 */
export function useSearchResults(query: string) {
  const text = query.trim();
  return useQuery({
    queryKey: queryKeys.search(text),
    enabled: text !== '',
    retry: false,
    queryFn: ({ signal }) =>
      api().get('/v1/search', { query: { q: text, limit: FEED_PAGE_SIZE }, signal }),
  });
}

/**
 * The category taxonomy — Home's "Browse by category", the categories index and every landing
 * page, under one key, so opening a category from Home costs no second read (#154). Small and
 * slow to change, but still not persisted: a renamed category restored from last month would be
 * a tile that opens nothing.
 *
 * Narrowed with the shared `taxonomyFrom` (a missing name reads as the slug), so a screen reads
 * `category.slug` without a guard on every field.
 */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories(),
    retry: false,
    queryFn: ({ signal }) => api().get('/v1/categories', { signal }),
    select: taxonomyFrom,
  });
}

/**
 * Every visible collection, in the curator's order (#154). Not paged: the service sends the
 * whole index at once. Rows with no slug or no title are dropped (`collectionFrom` says why).
 * Not persisted, like the taxonomy.
 */
export function useCollections() {
  return useQuery({
    queryKey: queryKeys.collections(),
    retry: false,
    queryFn: ({ signal }) => api().get('/v1/collections', { signal }),
    select: (index): readonly Collection[] => collectionsFrom(index.items ?? []),
  });
}

/**
 * One collection and its campaigns, paged by cursor in the curator's order (#154).
 *
 * Every page carries the collection again; the header reads it from the first page only, so a
 * later page cannot change the heading half way down a scroll. `limit` goes as a string because
 * the contract types it that way (`collectionQueryParams`).
 *
 * `getNextPageParam` returns `undefined` at the end — the value TanStack reads as "no next page"
 * — and treats an empty cursor as the end too. Not retried: a 404 is the answer for a slug that
 * names nothing, for an unpublished collection and for one outside its window, and asking three
 * times will not change it.
 */
export function useCollection(slug: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.collection(slug),
    enabled: slug !== '',
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api().get('/v1/collections/{slug}', {
        path: { slug },
        query: collectionQueryParams({ cursor: pageParam }, FEED_PAGE_SIZE),
        signal,
      }),
    getNextPageParam: (page: CollectionPage) =>
      page.nextCursor === undefined || page.nextCursor === '' ? undefined : page.nextCursor,
  });
}

/** The collection a page of `useCollection` describes, narrowed — `null` when it cannot be drawn. */
export function collectionOf(page: CollectionPage | undefined): Collection | null {
  return page?.collection === undefined ? null : collectionFrom(page.collection);
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

/**
 * A campaign's public pre-launch page, by project id (#155) — what is coming and how many are
 * waiting for it.
 *
 * The service answers 404 alike for no such campaign, a draft and one that has already launched,
 * and the default retry rule (`lib/offline.ts`) does not ask a 4xx twice, so that answer arrives
 * at once. Disabled for an empty id, which only a malformed route could give.
 */
export function usePrelaunchPage(projectId: string) {
  return useQuery({
    queryKey: queryKeys.prelaunch(projectId),
    enabled: projectId !== '',
    queryFn: ({ signal }) =>
      api().get('/v1/projects/{id}/prelaunch', { path: { id: projectId }, signal }),
  });
}

/**
 * §5.5's update clock for one campaign (#155) — the notice above the campaign page's tabs.
 *
 * Narrowed with the shared `readUpdateObligation`, so a body the web would not draw is not drawn
 * here either. A campaign without a clock answers `204`, which reads as `null`: "nothing to say
 * about this campaign's updates", exactly as the web treats it. Not retried beyond the default
 * rule, and never an error on screen — a notice that could not be loaded is a notice nobody owes.
 */
export function useUpdateObligation(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectObligation(projectId ?? ''),
    enabled: projectId !== undefined,
    queryFn: async ({ signal }): Promise<UpdateObligation | null> =>
      readUpdateObligation(
        await api().get('/v1/projects/{projectId}/update-obligation', {
          path: { projectId: projectId as string },
          signal,
        }),
      ),
  });
}
