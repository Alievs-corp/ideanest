import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';

/**
 * A cursor-paged account list over the query cache — the web's `useCursorList` (#159), as a
 * `useInfiniteQuery` so `lib/offline.ts` persists it and a restart opens on the last pages read.
 *
 * <ul>
 *   <li>The first page loads with the screen; `loadMore` appends the next cursor, once per cursor
 *       (an end-reached event fires more than once at the bottom of a list).</li>
 *   <li>`refresh` — pull to refresh, and a stale cache on mount — reloads the first page alone and
 *       replaces the pages with it, as `usePledgeList` does: a refetch of every page read would be
 *       one request per page for a gesture that asks for the top of the list.</li>
 *   <li>`remove` takes a row out of the cache at once, so the persisted copy agrees after a restart,
 *       and hands back a `restore` that puts it back at the index it had. The cursor is never
 *       reset by a removal: the service pages over its own rows, and this list only dropped one.</li>
 *   <li>A removed row stays removed when a page that was already on its way lands with it: an
 *       infinite fetch writes back the pages it started from, and a refresh may have been asked
 *       before the delete reached the service. Removed keys are held until `restore`, or, once the
 *       delete is confirmed, until a refresh asked after it or an invalidation of the list.</li>
 *   <li>Removing every row read while more remain asks for the next page rather than showing the
 *       empty state.</li>
 * </ul>
 */

export interface Page<T> {
  readonly items: readonly T[];
  /** `null` on the last page. */
  readonly nextCursor: string | null;
}

type Cursor = string | null;
export type Pages<T> = InfiniteData<Page<T>, Cursor>;

export interface CursorListOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly enabled: boolean;
  readonly read: (cursor: Cursor, signal?: AbortSignal) => Promise<Page<T>>;
  readonly keyOf: (item: T) => string;
}

export interface Removal {
  /** The service refused: puts the row back where it was, unless it is already back. */
  readonly restore: () => void;
  /** The service agreed: the row stays out until the list is next read from the top. */
  readonly confirm: () => void;
}

export interface CursorList<T> {
  readonly items: readonly T[];
  /** Nothing to show yet and an answer on its way. */
  readonly loading: boolean;
  /** Nothing to show, and the read that would have found something failed. */
  readonly failed: boolean;
  readonly retrying: boolean;
  /** Rows on screen from the cache, and the read that would refresh them failed. */
  readonly stale: boolean;
  readonly hasMore: boolean;
  readonly fetchingMore: boolean;
  readonly moreFailed: boolean;
  readonly refreshing: boolean;
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
  readonly remove: (key: string) => Removal | null;
}

/** Every row across the cached pages, in order. */
export function rowsOf<T>(data: Pages<T> | undefined): readonly T[] {
  return (data?.pages ?? []).flatMap((page) => page.items);
}

/** The pages with `item` inserted at flat position `index`, or at the end when that is past it. */
export function insertAt<T>(data: Pages<T>, index: number, item: T): Pages<T> {
  const pages = [...data.pages];
  let remaining = Math.max(0, index);
  for (let number = 0; number < pages.length; number += 1) {
    const page = pages[number];
    if (page === undefined) break;
    if (remaining <= page.items.length || number === pages.length - 1) {
      const at = Math.min(remaining, page.items.length);
      pages[number] = { ...page, items: [...page.items.slice(0, at), item, ...page.items.slice(at)] };
      return { ...data, pages };
    }
    remaining -= page.items.length;
  }
  return data;
}

/** The pages without the rows whose key is in `removed`, or the same object when none is there. */
export function withoutRemoved<T>(
  data: Pages<T>,
  removed: ReadonlyMap<string, unknown>,
  keyOf: (item: T) => string,
): Pages<T> {
  if (removed.size === 0 || !rowsOf(data).some((row) => removed.has(keyOf(row)))) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((row) => !removed.has(keyOf(row))),
    })),
  };
}

/** A removed row's key, and when the service confirmed the removal (`null` while pending). */
type RemovedKeys = Map<string, { confirmedAt: number | null }>;

export function useCursorList<T>({ queryKey, enabled, read, keyOf }: CursorListOptions<T>): CursorList<T> {
  const client = useQueryClient();
  // One list, one key, for the hook's life.
  const [key] = useState(() => queryKey);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) => read(pageParam, signal),
    getNextPageParam: (page: Page<T>) => page.nextCursor ?? undefined,
    // Refreshed by hand, first page only (see above).
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const removed = useRef<RemovedKeys>(new Map());
  // Bumped on every remove, restore and confirm, so the rows are read again through the ref.
  const [removals, setRemovals] = useState(0);
  const pages = query.data?.pages;
  const items = useMemo(() => {
    void removals;
    return (pages ?? []).flatMap((page) => page.items).filter((row) => !removed.current.has(keyOf(row)));
  }, [pages, removals, keyOf]);

  // A page that landed with a removed row in it is written back without it, so the persisted copy
  // never holds the row again.
  const data = query.data as Pages<T> | undefined;
  useEffect(() => {
    if (data === undefined) return;
    const filtered = withoutRemoved(data, removed.current, keyOf);
    if (filtered !== data) client.setQueryData<Pages<T>>(key, filtered);
  }, [client, data, key, keyOf]);

  // An invalidation (the campaign page saved or unsaved something) hands the list back to the
  // service: confirmed removals stop being held, so a row saved again can come back.
  useEffect(() => {
    const cache = client.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'invalidate') return;
      if (event.query !== cache.find({ queryKey: key, exact: true })) return;
      let dropped = false;
      for (const [target, entry] of removed.current) {
        if (entry.confirmedAt !== null) {
          removed.current.delete(target);
          dropped = true;
        }
      }
      if (dropped) setRemovals((count) => count + 1);
    });
  }, [client, key]);
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
    if (client.getQueryData<Pages<T>>(key) === undefined) {
      return refetch().then(() => undefined);
    }
    const owner = client.getQueryCache().find({ queryKey: key, exact: true });
    const askedAt = Date.now();
    setRefreshing(true);
    const run = Promise.resolve()
      .then(() => read(null))
      .then(async (first) => {
        // Signed out (the cache cleared) while the page was on its way: it is not this list's.
        if (client.getQueryCache().find({ queryKey: key, exact: true }) !== owner) return;
        await client.cancelQueries({ queryKey: key, exact: true });
        asked.current = null;
        // A removal confirmed before this was asked is already in the service's answer.
        for (const [target, entry] of removed.current) {
          if (entry.confirmedAt !== null && entry.confirmedAt <= askedAt) removed.current.delete(target);
        }
        client.setQueryData<Pages<T>>(
          key,
          withoutRemoved({ pages: [first], pageParams: [null] }, removed.current, keyOf),
        );
        setRemovals((count) => count + 1);
        setRefreshFailedAt(null);
      })
      .catch(() => setRefreshFailedAt(Date.now()))
      .finally(() => {
        refreshRun.current = null;
        setRefreshing(false);
      });
    refreshRun.current = run;
    return run;
  }, [client, key, keyOf, read, refetch]);

  // A cache restored from disk, or older than the client's staleTime, is refreshed once on mount.
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

  const remove = useCallback(
    (target: string): Removal | null => {
      const data = client.getQueryData<Pages<T>>(key);
      const rows = rowsOf(data);
      const index = rows.findIndex((item) => keyOf(item) === target);
      const item = rows[index];
      if (data === undefined || item === undefined) return null;
      removed.current.set(target, { confirmedAt: null });
      setRemovals((count) => count + 1);
      client.setQueryData<Pages<T>>(key, withoutRemoved(data, removed.current, keyOf));
      return {
        restore: () => {
          removed.current.delete(target);
          setRemovals((count) => count + 1);
          const now = client.getQueryData<Pages<T>>(key);
          if (now === undefined || rowsOf(now).some((row) => keyOf(row) === target)) return;
          client.setQueryData<Pages<T>>(key, insertAt(now, index, item));
        },
        confirm: () => {
          if (removed.current.has(target)) removed.current.set(target, { confirmedAt: Date.now() });
        },
      };
    },
    [client, key, keyOf],
  );

  const refreshFailed = refreshFailedAt !== null && refreshFailedAt >= dataUpdatedAt;

  // Every row read has been removed and more remain: read on, rather than say the list is empty.
  const drained = enabled && pages !== undefined && items.length === 0 && hasNextPage;
  useEffect(() => {
    if (drained && !isFetchNextPageError) loadMore();
  }, [drained, isFetchNextPageError, loadMore]);

  return {
    items,
    loading: (pages === undefined && query.isPending && enabled) || (drained && !isFetchNextPageError),
    failed: (query.isError && pages === undefined) || (drained && isFetchNextPageError),
    retrying: isFetching,
    stale: pages !== undefined && (query.isRefetchError || refreshFailed),
    hasMore: hasNextPage,
    fetchingMore: query.isFetchingNextPage,
    moreFailed: isFetchNextPageError,
    refreshing,
    loadMore,
    retry: () => (drained ? loadMore({ retry: true }) : void refetch()),
    refresh,
    remove,
  };
}
