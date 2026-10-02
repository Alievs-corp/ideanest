import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '../../api/queries';
import { listMyPledges, type BackerPledgeSummary, type PledgePage } from './api';

type Cursor = string | null;
export type PledgePages = InfiniteData<PledgePage, Cursor>;

export interface PledgeList {
  readonly items: readonly BackerPledgeSummary[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly retrying: boolean;
  readonly stale: boolean;
  readonly hasMore: boolean;
  readonly fetchingMore: boolean;
  readonly moreFailed: boolean;
  readonly refreshing: boolean;
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
}

export function cachedPledgeSummaries(data: PledgePages | undefined): readonly BackerPledgeSummary[] {
  return (data?.pages ?? []).flatMap((page) => page.items);
}

export function usePledgeList(enabled: boolean): PledgeList {
  const client = useQueryClient();
  const key = useMemo(() => queryKeys.pledgeList(), []);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) => listMyPledges(pageParam, signal),
    getNextPageParam: (page: PledgePage) => page.nextCursor ?? undefined,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    client.removeQueries({ queryKey: queryKeys.pledges(), exact: true });
  }, [client]);

  const pages = query.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((page) => page.items), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;
  const { fetchNextPage, refetch, isFetching, hasNextPage, isFetchNextPageError, dataUpdatedAt } = query;
  const asked = useRef<string | null>(null);
  const refreshRun = useRef<Promise<void> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailedAt, setRefreshFailedAt] = useState<number | null>(null);

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasNextPage || nextCursor === null || isFetching || refreshRun.current !== null) return;
      if (asked.current === nextCursor && !(retry && isFetchNextPageError)) return;
      asked.current = nextCursor;
      const ask = nextCursor;
      void fetchNextPage({ cancelRefetch: false }).then((result) => {
        if (!result.isError && asked.current === ask) asked.current = null;
      });
    },
    [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError, nextCursor],
  );

  const refresh = useCallback((): Promise<void> => {
    if (refreshRun.current !== null) return refreshRun.current;
    if (client.getQueryData<PledgePages>(key) === undefined) {
      return refetch().then(() => undefined);
    }
    const owner = client.getQueryCache().find({ queryKey: key, exact: true });
    setRefreshing(true);
    const run = Promise.resolve()
      .then(() => listMyPledges(null))
      .then(async (first) => {
        if (client.getQueryCache().find({ queryKey: key, exact: true }) !== owner) return;
        await client.cancelQueries({ queryKey: key, exact: true });
        asked.current = null;
        client.setQueryData<PledgePages>(key, { pages: [first], pageParams: [null] });
        setRefreshFailedAt(null);
      })
      .catch(() => setRefreshFailedAt(Date.now()))
      .finally(() => {
        refreshRun.current = null;
        setRefreshing(false);
      });
    refreshRun.current = run;
    return run;
  }, [client, key, refetch]);

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

  const refreshFailed = refreshFailedAt !== null && refreshFailedAt >= dataUpdatedAt;

  return {
    items,
    loading: pages === undefined && query.isPending,
    failed: query.isError && items.length === 0,
    retrying: isFetching,
    stale: items.length > 0 && (query.isRefetchError || refreshFailed),
    hasMore: hasNextPage,
    fetchingMore: query.isFetchingNextPage,
    moreFailed: isFetchNextPageError,
    refreshing,
    loadMore,
    retry: () => void refetch(),
    refresh,
  };
}
