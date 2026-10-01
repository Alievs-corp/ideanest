import { useCallback, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  UPDATE_PAGE_SIZE,
  readUpdatePage,
  type CampaignUpdate,
  type CampaignUpdatePage,
} from '@ideanest/campaign/updates';
import { api } from '../../../../api/client';
import { queryKeys } from '../../../../api/queries';

/**
 * The Updates tab's read (#155): `GET /v1/projects/{projectId}/updates?limit=20[&cursor=]`, one
 * infinite query whose pages are appended, never replaced.
 *
 * <h2>The key</h2>
 *
 * `queryKeys.projectUpdates(projectId)` plus `'pages'`. Still under the `project` root, so the
 * pages survive a restart with the campaign they belong to (`lib/offline.ts`), and still matched
 * by anything that invalidates `projectUpdates`. The suffix is there because the screen this one
 * replaced cached a single five-update *query* under the bare key, and the persister may restore
 * that body for up to a week: an infinite query handed `{updates, nextCursor}` where it expects
 * `{pages, pageParams}` throws on its first render. A key of its own means an old cache is simply
 * an entry nobody reads, and ages out.
 *
 * <h2>Never the same cursor twice</h2>
 *
 * The next page is asked for from two places — the list's end-reached and the "Older updates"
 * pill — and a guard on `isFetchingNextPage` alone is a render late: both can land before the flag
 * is set. So the cursor last asked for is remembered (`discover.tsx`'s rule). It is cleared when
 * the ask settles without failing; a page that failed keeps its mark, so the end of the list does
 * not hammer it, and only an explicit retry asks again.
 *
 * <h2>Refresh is the first page</h2>
 *
 * TanStack refetches every loaded page of an infinite query. Pull to refresh asks for the newest
 * twenty, so the query is cut back to its first page before the refetch — what the web does when
 * it renders page one again.
 */

type Cursor = number | undefined;
type UpdatePages = InfiniteData<CampaignUpdatePage, Cursor>;

export function projectUpdatesKey(projectId: string) {
  return [...queryKeys.projectUpdates(projectId), 'pages'] as const;
}

export interface ProjectUpdates {
  /** Every update loaded so far, in the order the pages arrived (newest first). */
  readonly updates: readonly CampaignUpdate[];
  /** How many pages are loaded — more than one is "a paged list". */
  readonly pageCount: number;
  /** The first page is on its way and nothing is cached. */
  readonly loading: boolean;
  /** The first page could not be read and nothing is cached. */
  readonly failed: boolean;
  readonly hasMore: boolean;
  readonly fetchingMore: boolean;
  /** The last ask for the next page failed. The pages already loaded stay. */
  readonly moreFailed: boolean;
  readonly fetching: boolean;
  /** Appends the next page, unless that cursor is already asked for (or failed, without `retry`). */
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => Promise<unknown>;
  readonly refresh: () => Promise<unknown>;
}

export function useProjectUpdates(projectId: string, enabled: boolean): ProjectUpdates {
  const client = useQueryClient();
  const key = useMemo(() => projectUpdatesKey(projectId), [projectId]);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: undefined as Cursor,
    queryFn: async ({ pageParam, signal }): Promise<CampaignUpdatePage> =>
      readUpdatePage(
        await api().get('/v1/projects/{projectId}/updates', {
          path: { projectId },
          query:
            pageParam === undefined
              ? { limit: UPDATE_PAGE_SIZE }
              : { limit: UPDATE_PAGE_SIZE, cursor: pageParam },
          signal,
        }),
      ),
    // `undefined`, not `null`, at the end: the value TanStack reads as "there is no next page".
    getNextPageParam: (page: CampaignUpdatePage): Cursor => page.nextCursor ?? undefined,
  });

  const pages = query.data?.pages;
  const updates = useMemo(() => (pages ?? []).flatMap((page) => page.updates), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;
  const hasMore = query.hasNextPage;
  const moreFailed = query.isFetchNextPageError;

  const asked = useRef<string | null>(null);
  const { fetchNextPage } = query;

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasMore || nextCursor === null) return;
      const ask = `${projectId}|${nextCursor}`;
      if (asked.current === ask && !(retry && moreFailed)) return;
      asked.current = ask;
      void fetchNextPage({ cancelRefetch: false }).then((result) => {
        if (!result.isError && asked.current === ask) asked.current = null;
      });
    },
    [fetchNextPage, hasMore, moreFailed, nextCursor, projectId],
  );

  const { refetch } = query;
  const refresh = useCallback(() => {
    asked.current = null;
    client.setQueryData<UpdatePages>(key, (data) =>
      data === undefined || data.pages.length <= 1
        ? data
        : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
    );
    return refetch();
  }, [client, key, refetch]);

  return {
    updates,
    pageCount: pages?.length ?? 0,
    loading: pages === undefined && query.isPending,
    failed: pages === undefined && query.isError,
    hasMore,
    fetchingMore: query.isFetchingNextPage,
    moreFailed,
    fetching: query.isFetching,
    loadMore,
    retry: () => refetch(),
    refresh,
  };
}
