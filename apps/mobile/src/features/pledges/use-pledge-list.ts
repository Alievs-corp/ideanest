import { useCallback, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '../../api/queries';
import { listMyPledges, type BackerPledgeSummary, type PledgePage } from './api';

type Cursor = string | null;
export type PledgePages = InfiniteData<PledgePage, Cursor>;

export interface PledgeList {
  readonly items: readonly BackerPledgeSummary[];
  readonly loading: boolean;
  readonly failed: boolean;
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
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((page) => page.items), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;
  const { fetchNextPage, refetch, isFetching, hasNextPage, isFetchNextPageError } = query;
  const asked = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasNextPage || nextCursor === null || isFetching) return;
      if (asked.current === nextCursor && !(retry && isFetchNextPageError)) return;
      asked.current = nextCursor;
      const ask = nextCursor;
      void fetchNextPage({ cancelRefetch: false }).then((result) => {
        if (!result.isError && asked.current === ask) asked.current = null;
      });
    },
    [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError, nextCursor],
  );

  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (client.getQueryData<PledgePages>(key) === undefined) {
      await refetch();
      return;
    }
    setRefreshing(true);
    try {
      const first = await listMyPledges(null);
      await client.cancelQueries({ queryKey: key, exact: true });
      asked.current = null;
      client.setQueryData<PledgePages>(key, { pages: [first], pageParams: [null] });
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [client, key, refetch]);

  return {
    items,
    loading: pages === undefined && query.isPending,
    failed: pages === undefined && query.isError,
    stale: pages !== undefined && (query.isRefetchError || refreshFailed),
    hasMore: hasNextPage,
    fetchingMore: query.isFetchingNextPage,
    moreFailed: isFetchNextPageError,
    refreshing,
    loadMore,
    retry: () => void refetch(),
    refresh,
  };
}
