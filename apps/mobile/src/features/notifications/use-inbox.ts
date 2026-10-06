import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  cursorOf,
  type InboxCursor,
  type InboxNotification,
  type InboxPage,
} from '@ideanest/account/inbox';
import { queryKeys } from '../../api/queries';
import { ACCOUNT_KEYS } from '../../lib/account';
import { listNotifications, markNotificationRead } from './api';

type Cursor = InboxCursor | null;
export type InboxPages = InfiniteData<InboxPage, Cursor>;

export interface Inbox {
  readonly items: readonly InboxNotification[];
  /** Across the whole inbox, from the newest page read; `null` until one has been. */
  readonly unreadCount: number | null;
  /** When the pages last changed (epoch ms), so the screen can pin "now" per load. */
  readonly updatedAt: number;
  readonly loading: boolean;
  /** Nothing to show, and the read that would have found something failed. */
  readonly failed: boolean;
  readonly error: unknown;
  readonly retrying: boolean;
  /** Rows on screen from memory, and the read that would refresh them failed. */
  readonly stale: boolean;
  readonly hasMore: boolean;
  readonly fetchingMore: boolean;
  readonly moreFailed: boolean;
  readonly refreshing: boolean;
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => void;
  readonly refresh: () => Promise<void>;
  /** Marks one row read and adopts the service's row; throws the refusal. Never optimistic. */
  readonly markRead: (id: string) => Promise<InboxNotification>;
}

/** The pages with `updated` in place of the row it replaces, and the badge number one lower. */
export function withRowRead(data: InboxPages, updated: InboxNotification, wasUnread: boolean): InboxPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      notifications: page.notifications.map((row) => (row.id === updated.id ? updated : row)),
      unreadCount: wasUnread ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
    })),
  };
}

/**
 * The inbox over the query cache — `before`/`beforeId` paging, pull to refresh from the newest
 * page, and a mark-read that waits for the service. The root `inbox` is not persisted
 * (`lib/offline.ts`): offline, the screen shows what this process read, never last week's rows.
 */
export function useInbox(enabled: boolean): Inbox {
  const client = useQueryClient();
  const key = useMemo(() => queryKeys.inbox(), []);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) => listNotifications(pageParam, signal),
    getNextPageParam: (page: InboxPage) => cursorOf(page) ?? undefined,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const pages = query.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((page) => page.notifications), [pages]);
  const unreadCount = pages?.[0]?.unreadCount ?? null;
  const last = pages?.at(-1);
  const nextCursor = last === undefined ? null : cursorOf(last);
  const { fetchNextPage, refetch, isFetching, hasNextPage, isFetchNextPageError, dataUpdatedAt } = query;
  const asked = useRef<string | null>(null);
  const refreshRun = useRef<Promise<void> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailedAt, setRefreshFailedAt] = useState<number | null>(null);

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasNextPage || nextCursor === null || isFetching || refreshRun.current !== null) return;
      const ask = `${nextCursor.before}|${nextCursor.beforeId}`;
      if (asked.current === ask && !(retry && isFetchNextPageError)) return;
      asked.current = ask;
      void fetchNextPage({ cancelRefetch: false }).then((result) => {
        if (!result.isError && asked.current === ask) asked.current = null;
      });
    },
    [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError, nextCursor],
  );

  /** The newest page alone, replacing every page read: a refetch of each would be one request per page. */
  const refresh = useCallback((): Promise<void> => {
    if (refreshRun.current !== null) return refreshRun.current;
    if (client.getQueryData<InboxPages>(key) === undefined) {
      return refetch().then(() => undefined);
    }
    const owner = client.getQueryCache().find({ queryKey: key, exact: true });
    setRefreshing(true);
    const run = Promise.resolve()
      .then(() => listNotifications(null))
      .then(async (first) => {
        // Signed out (the cache cleared) while the page was on its way: it is not this list's.
        if (client.getQueryCache().find({ queryKey: key, exact: true }) !== owner) return;
        await client.cancelQueries({ queryKey: key, exact: true });
        asked.current = null;
        client.setQueryData<InboxPages>(key, { pages: [first], pageParams: [null] });
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

  // An inbox is only true for a moment: one held in memory from an earlier visit is read again.
  const [heldAtMount] = useState(() => client.getQueryData(key) !== undefined);
  const checked = useRef(false);
  useEffect(() => {
    if (!enabled || !heldAtMount || checked.current) return;
    checked.current = true;
    void refresh();
  }, [enabled, heldAtMount, refresh]);

  const markRead = useCallback(
    async (id: string): Promise<InboxNotification> => {
      const before = (client.getQueryData<InboxPages>(key)?.pages ?? [])
        .flatMap((page) => page.notifications)
        .find((row) => row.id === id);
      const updated = await markNotificationRead(id);
      const wasUnread = before === undefined || before.readAt === undefined || before.readAt === null;
      const data = client.getQueryData<InboxPages>(key);
      if (data !== undefined) client.setQueryData<InboxPages>(key, withRowRead(data, updated, wasUnread));
      void client.invalidateQueries({ queryKey: ACCOUNT_KEYS.unread });
      return updated;
    },
    [client, key],
  );

  const refreshFailed = refreshFailedAt !== null && refreshFailedAt >= dataUpdatedAt;

  return {
    items,
    unreadCount,
    updatedAt: dataUpdatedAt,
    loading: enabled && pages === undefined && query.isPending,
    failed: query.isError && pages === undefined,
    error: query.error,
    retrying: isFetching,
    stale: pages !== undefined && (query.isRefetchError || refreshFailed),
    hasMore: hasNextPage,
    fetchingMore: query.isFetchingNextPage,
    moreFailed: isFetchNextPageError,
    refreshing,
    loadMore,
    retry: () => void refetch(),
    refresh,
    markRead,
  };
}
