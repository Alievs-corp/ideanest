import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  UPDATE_PAGE_SIZE,
  readUpdatePage,
  type CampaignUpdate,
  type CampaignUpdatePage,
} from '@ideanest/campaign/updates';
import { publicApi } from '../../../../api/client';
import { queryKeys } from '../../../../api/queries';

/**
 * The Updates tab's read (#155): `GET /v1/projects/{projectId}/updates?limit=20[&cursor=]`, one
 * infinite query whose pages are appended, never replaced.
 *
 * <h2>Read as nobody</h2>
 *
 * Through `publicApi()`, with no `Authorization`. The service answers a member of the campaign's
 * team with updates the public cannot see yet, and this list is drawn on the public page and
 * persisted unencrypted with it; the web reads it anonymously for the same reason.
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
 * <h2>Only ever the first page again</h2>
 *
 * TanStack refetches an infinite query by re-reading every loaded page, one after another — on
 * mount, on focus, on reconnect. Five pages in, that is five requests in a row, during which the
 * "Older updates" pill can do nothing. So none of those automatic refetches happen here. What
 * replaces them is {@link ProjectUpdates.refresh}: the newest twenty, read on their own, and the
 * loaded pages replaced by them **only once they have arrived** — offline or on a 5xx, every page
 * already loaded stays, and so does the persisted copy. It runs on pull to refresh, and when the
 * tab is opened on a list that has gone stale (a restart, a long while on another tab).
 *
 * <h2>Never the same cursor twice</h2>
 *
 * The next page is asked for from two places — the screen, as the end of the rows nears, and the
 * "Older updates" pill — and neither may ask while anything else is being read. The cursor last
 * asked for is also remembered (`discover.tsx`'s rule), because a caller can hold a handler from
 * an earlier render: it is cleared when the ask settles without failing, and a page that failed
 * keeps its mark, so only an explicit retry asks for it again.
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
  /** Something is being read — a page, a retry, or the first page again — so paging waits. */
  readonly busy: boolean;
  /** Appends the next page, unless anything is in flight or that cursor was already asked for. */
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => Promise<unknown>;
  /** The newest page again, replacing the loaded ones only on success. Never rejects. */
  readonly refresh: () => Promise<unknown>;
}

async function readPage(
  projectId: string,
  cursor: Cursor,
  signal?: AbortSignal,
): Promise<CampaignUpdatePage> {
  return readUpdatePage(
    await publicApi().get('/v1/projects/{projectId}/updates', {
      path: { projectId },
      query:
        cursor === undefined
          ? { limit: UPDATE_PAGE_SIZE }
          : { limit: UPDATE_PAGE_SIZE, cursor },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export function useProjectUpdates(projectId: string, enabled: boolean): ProjectUpdates {
  const client = useQueryClient();
  const key = useMemo(() => projectUpdatesKey(projectId), [projectId]);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: undefined as Cursor,
    queryFn: ({ pageParam, signal }) => readPage(projectId, pageParam, signal),
    // `undefined`, not `null`, at the end: the value TanStack reads as "there is no next page".
    getNextPageParam: (page: CampaignUpdatePage): Cursor => page.nextCursor ?? undefined,
    /*
     * See the module comment: each of these would re-read every loaded page in turn. `staleTime`
     * too, because TanStack also refetches a stale query when its observer is re-enabled — which
     * is every time this tab is opened. Staleness is judged below, against the client's own rule.
     */
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const pages = query.data?.pages;
  const updates = useMemo(() => (pages ?? []).flatMap((page) => page.updates), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;
  const hasMore = query.hasNextPage;
  const moreFailed = query.isFetchNextPageError;

  const [refreshing, setRefreshing] = useState(false);
  const refreshRun = useRef<Promise<unknown> | null>(null);
  const asked = useRef<string | null>(null);
  const { fetchNextPage, refetch, isFetching } = query;

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasMore || nextCursor === null || isFetching || refreshRun.current !== null) return;
      const ask = `${projectId}|${nextCursor}`;
      if (asked.current === ask && !(retry && moreFailed)) return;
      asked.current = ask;
      void fetchNextPage({ cancelRefetch: false }).then((result) => {
        if (!result.isError && asked.current === ask) asked.current = null;
      });
    },
    [fetchNextPage, hasMore, isFetching, moreFailed, nextCursor, projectId],
  );

  const refresh = useCallback((): Promise<unknown> => {
    if (refreshRun.current !== null) return refreshRun.current;
    // Nothing loaded: the query's own read, which also carries its failure to the screen.
    if (client.getQueryData<UpdatePages>(key) === undefined) return refetch();

    setRefreshing(true);
    const run = readPage(projectId, undefined)
      .then(async (first) => {
        // A next page still in flight would land on the old list and undo this one.
        await client.cancelQueries({ queryKey: key, exact: true });
        asked.current = null;
        client.setQueryData<UpdatePages>(key, { pages: [first], pageParams: [undefined] });
      })
      // A refresh that fails changes nothing: every page already loaded stays, as it was.
      .catch(() => undefined)
      .finally(() => {
        refreshRun.current = null;
        setRefreshing(false);
      });
    refreshRun.current = run;
    return run;
  }, [client, key, projectId, refetch]);

  /*
   * Opening the tab on a list that has gone stale — restored after a restart, or left on another
   * tab past the client's `staleTime` — reads the first page again, once per opening. A list read
   * just now (the tab's first load) is fresh and is left alone.
   */
  const checked = useRef(false);
  const hasData = query.data !== undefined;
  useEffect(() => {
    if (!enabled) {
      checked.current = false;
      return;
    }
    if (!hasData || checked.current) return;
    checked.current = true;
    const state = client.getQueryState(key);
    const freshFor = client.getDefaultOptions().queries?.staleTime;
    const stale =
      state !== undefined &&
      (state.isInvalidated ||
        Date.now() - state.dataUpdatedAt > (typeof freshFor === 'number' ? freshFor : 0));
    if (stale) void refresh();
  }, [client, enabled, hasData, key, refresh]);

  return {
    updates,
    pageCount: pages?.length ?? 0,
    loading: pages === undefined && query.isPending,
    failed: pages === undefined && query.isError,
    hasMore,
    fetchingMore: query.isFetchingNextPage,
    moreFailed,
    busy: isFetching || refreshing,
    loadMore,
    retry: () => refetch(),
    refresh,
  };
}
