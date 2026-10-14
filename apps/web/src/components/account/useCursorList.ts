'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api/problem';
import type { Page } from '../../lib/community/signals';

/**
 * A cursor-paginated list, read once on mount and extended a page at a time.
 *
 * <h2>Why a hook rather than two copies</h2>
 *
 * The saved list and the following list (#288) are the same machine over different rows: one
 * read, one cursor, one "load more", one signed-out state, and one distinction between "the
 * service refused" and "the request was abandoned". Two copies of that would be two places for
 * the abort handling to be got wrong — and getting it wrong is silent, because an aborted
 * request that is treated as a failure only shows up as a flash of an error nobody can
 * reproduce.
 *
 * <h2>The cursor is never reset by a removal</h2>
 *
 * Unsaving a campaign takes its row out of local state and leaves the cursor alone. Refetching
 * from the start would drop every page the reader has already loaded and put them back at the
 * top of a list they were reading; the row they removed is the one thing they already know is
 * gone.
 *
 * <h2>Three states, and a fourth that is not an error</h2>
 *
 * `loading`, `ready` and `failed` — plus `signed-out`, which is what a 401 means here rather
 * than a failure to report. `SessionProvider`'s guard is what acts on it; this hook only has
 * to stop rendering a list it cannot read.
 */

export type ListStatus = 'loading' | 'ready' | 'failed' | 'signed-out';

/**
 * What `error` says when the service sent no `detail` of its own — `common.list.refused` and
 * `common.list.unreachable`, handed in by the panel because a hook cannot read the catalogue
 * (#462). They are the paginator's, like `common.list.showMore`, so every list says them alike.
 */
export interface CursorListFailureCopy {
  readonly refused: string;
  readonly unreachable: string;
}

export interface CursorList<T> {
  readonly status: ListStatus;
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly loadMore: () => void;
  /** Drops one row locally, by whatever identity the caller keys on. */
  readonly remove: (matches: (item: T) => boolean) => void;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function messageFor(cause: unknown, copy: CursorListFailureCopy): string {
  if (cause instanceof ApiError) {
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

export function useCursorList<T>(
  read: (cursor: string | null, signal?: AbortSignal) => Promise<Page<T>>,
  failures: CursorListFailureCopy,
): CursorList<T> {
  // Read when a request fails rather than as a dependency: new words must not refetch the list.
  const failureCopy = useRef(failures);
  failureCopy.current = failures;
  const [status, setStatus] = useState<ListStatus>('loading');
  const [items, setItems] = useState<readonly T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const page = await read(null, controller.signal);
        if (controller.signal.aborted) return;

        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 401) {
          setStatus('signed-out');
          return;
        }
        setError(messageFor(cause, failureCopy.current));
        setStatus('failed');
      }
    })();

    return () => controller.abort();
  }, [read]);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    setError(null);

    void (async () => {
      try {
        const page = await read(cursor);
        /*
         * Appended rather than replaced, and the cursor advances with it. A page that arrives
         * after a removal is still correct: the service paginates over its own rows, and this
         * list has only ever dropped one locally.
         */
        setItems((previous) => [...previous, ...page.items]);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
      } catch (cause) {
        if (wasAborted(cause)) return;
        setError(messageFor(cause, failureCopy.current));
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [cursor, loadingMore, read]);

  const remove = useCallback((matches: (item: T) => boolean) => {
    setItems((previous) => previous.filter((item) => !matches(item)));
  }, []);

  return { status, items, hasMore, loadingMore, error, loadMore, remove };
}
