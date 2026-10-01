import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  COMMENT_PAGE_SIZE,
  readCommentPage,
  type CampaignComment,
  type CampaignCommentPage,
  type CampaignCommentThread,
} from '@ideanest/campaign/comments';
import { api, sendJson } from '../api/client';
import { queryKeys } from '../api/queries';

/**
 * The campaign page's Comments tab, as reads and writes — #155, over §4.9's C-01, C-02 and C-03.
 *
 * <h2>The wire is shared; the travel is the app's</h2>
 *
 * The shapes, the page size and the reader that narrows a response (a tombstone kept as a row, an
 * unreadable reply dropped on its own) are `@ideanest/campaign/comments`, which the web's tab
 * reads too. What lives here is how this app asks: the typed client for the read, `sendJson` for
 * the three writes, so each carries the session the way every other request does.
 *
 * <h2>Append, never replace — and never the same cursor twice</h2>
 *
 * The web's "Older comments" is a link to a new server page that replaces the list. The app has
 * one list that grows: an infinite query under `queryKeys.comments(projectId, thread)` — the
 * `comments` root, which `lib/offline.ts` never persists, because a withdrawn or moderated comment
 * must not survive in a stranger's offline cache. {@link useCommentThreads} asks for the next page
 * with `cancelRefetch: false`, so a second "end reached" while the first is in flight is ignored
 * rather than answered by cancelling and re-requesting the same cursor, and the pages are merged
 * by identifier, so a row cannot appear twice even if two pages ever overlapped.
 *
 * <h2>Two reads on one route</h2>
 *
 * Without `thread` the endpoint answers the tab: conversations newest first, each with a preview
 * of its replies. With it, one conversation and a page of its replies, oldest first, whose next
 * page is that thread's `nextReplyCursor` sent back with the same `thread`. The web's
 * single-thread view never pages (it reads `nextCursor`, which that answer never carries); the app
 * pages it, as #155 asks.
 */

/** One page of the tab, or of one conversation's replies. */
export async function fetchCommentPage(
  projectId: string,
  location: { readonly cursor: string | null; readonly thread: string | null },
  signal?: AbortSignal,
): Promise<CampaignCommentPage> {
  const body = await api().get('/v1/projects/{projectId}/comments', {
    path: { projectId },
    query: {
      limit: COMMENT_PAGE_SIZE,
      ...(location.cursor === null ? {} : { cursor: location.cursor }),
      ...(location.thread === null ? {} : { thread: location.thread }),
    },
    signal,
  });
  return readCommentPage(body);
}

/** `POST /v1/projects/{projectId}/comments` — a new conversation. */
export async function postComment(projectId: string, body: string): Promise<void> {
  await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/comments`, { body });
}

/** `POST /v1/comments/{commentId}/reply` — an answer to a root. */
export async function replyToComment(commentId: string, body: string): Promise<void> {
  await sendJson('POST', `/v1/comments/${encodeURIComponent(commentId)}/reply`, { body });
}

/**
 * `DELETE /v1/comments/{commentId}` — a withdrawal. The row stays and the read serves a tombstone
 * in its place, which is why the list is re-read afterwards rather than the row removed here.
 */
export async function withdrawComment(commentId: string): Promise<void> {
  await sendJson('DELETE', `/v1/comments/${encodeURIComponent(commentId)}`);
}

/** Which of the composer's failure sentences a refusal is, or the service's own words. */
export type PostFailure =
  | { readonly kind: 'sessionExpired' }
  | { readonly kind: 'rateLimited' }
  | { readonly kind: 'rateLimitedFor'; readonly minutes: number }
  | { readonly kind: 'detail'; readonly text: string }
  | { readonly kind: 'notPosted' }
  | { readonly kind: 'unreachable' };

/**
 * The web's `messageFor` (`CommentComposer.tsx`), as data, so the words stay the catalogue's: a
 * 401 is an expired session; a 429 says how long, in whole minutes rounded up from the service's
 * `retryAfterSeconds` (150 s is "about 3 minutes" — a reader told 2 would be refused again); any
 * other refusal is the service's `detail` (then `title`), which knows which of its rules refused;
 * and no answer at all is "could not be reached".
 */
export function postFailureOf(cause: unknown): PostFailure {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return { kind: 'sessionExpired' };
    if (cause.status === 429) {
      const seconds = cause.problem?.retryAfterSeconds;
      return seconds === undefined
        ? { kind: 'rateLimited' }
        : { kind: 'rateLimitedFor', minutes: retryMinutes(seconds) };
    }
    const text = cause.problem?.detail ?? cause.problem?.title;
    return text === undefined || text === '' ? { kind: 'notPosted' } : { kind: 'detail', text };
  }
  return { kind: 'unreachable' };
}

/** `retryAfterSeconds` as the whole minutes the 429 sentence names, rounded up. */
export function retryMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

export type WithdrawFailure =
  | { readonly kind: 'detail'; readonly text: string }
  | { readonly kind: 'notWithdrawn' }
  | { readonly kind: 'unreachable' };

/** The web's `CommentControls` catch: the service's words, else "could not be withdrawn". */
export function withdrawFailureOf(cause: unknown): WithdrawFailure {
  if (cause instanceof ApiError) {
    const text = cause.problem?.detail ?? cause.problem?.title;
    return text === undefined || text === ''
      ? { kind: 'notWithdrawn' }
      : { kind: 'detail', text };
  }
  return { kind: 'unreachable' };
}

/**
 * The tab's conversations across every page read so far, in the service's order — newest first,
 * as it paged them. Never re-sorted: the cursor is a keyset over that order, and sorting here would
 * reorder a page relative to the cursor that produced it. A root already seen is not repeated.
 */
export function threadsOf(pages: readonly CampaignCommentPage[]): readonly CampaignCommentThread[] {
  const seen = new Set<string>();
  const threads: CampaignCommentThread[] = [];
  for (const page of pages) {
    for (const thread of page.threads) {
      if (seen.has(thread.root.id)) continue;
      seen.add(thread.root.id);
      threads.push(thread);
    }
  }
  return threads;
}

/** One conversation across the pages of its replies, or `null` when the first page has none. */
export interface Conversation {
  readonly root: CampaignComment;
  readonly replies: readonly CampaignComment[];
}

/**
 * The single-thread view's conversation: the root from the first page, and every page's replies
 * after it, oldest first, each once.
 */
export function conversationOf(pages: readonly CampaignCommentPage[]): Conversation | null {
  const root = pages[0]?.threads[0]?.root;
  if (root === undefined) return null;
  const seen = new Set<string>([root.id]);
  const replies: CampaignComment[] = [];
  for (const page of pages) {
    for (const reply of page.threads[0]?.replies ?? []) {
      if (seen.has(reply.id)) continue;
      seen.add(reply.id);
      replies.push(reply);
    }
  }
  return { root, replies };
}

/**
 * The cursor for the page after `page`: the tab's `nextCursor`, or — in the single-thread view —
 * that conversation's `nextReplyCursor`. `undefined` is TanStack's "there is no next page".
 */
export function nextCursorOf(page: CampaignCommentPage, thread: string | null): string | undefined {
  const cursor = thread === null ? page.nextCursor : (page.threads[0]?.nextReplyCursor ?? null);
  return cursor ?? undefined;
}

/**
 * The Comments tab's read: the whole tab (`thread` null) or one conversation, appended a page at a
 * time. Reads nothing while `enabled` is false — the tab is not on screen.
 *
 * - `loadMore` asks for the next page, at most once at a time; it is what `onEndReached` and the
 *   "Older comments" pill both call.
 * - `refreshFirstPage` drops every page but the first and reads that one again — pull to refresh,
 *   and a new conversation, which arrives at the top of the first page.
 * - `refreshAll` reads every page already shown again, in order — after a reply or a withdrawal,
 *   so the change appears where the reader is instead of the list collapsing to its first page.
 */
export function useCommentThreads(projectId: string, thread: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => queryKeys.comments(projectId, thread), [projectId, thread]);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchCommentPage(projectId, { cursor: pageParam, thread }, signal),
    getNextPageParam: (page: CampaignCommentPage) => nextCursorOf(page, thread),
  });

  const { hasNextPage, isFetching, fetchNextPage, refetch } = query;

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetching) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, isFetching, fetchNextPage]);

  const refreshFirstPage = useCallback(async () => {
    queryClient.setQueryData<InfiniteData<CampaignCommentPage, string | null>>(queryKey, (data) =>
      data === undefined
        ? data
        : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
    );
    await queryClient.refetchQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  const refreshAll = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return { query, loadMore, refreshFirstPage, refreshAll };
}
