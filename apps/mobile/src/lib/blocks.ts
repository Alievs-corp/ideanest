import { useCallback } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import type { CampaignCommentThread } from '@ideanest/campaign/comments';
import { api, sendJson } from '../api/client';
import { queryKeys } from '../api/queries';
import { canReadAccount } from './account';
import { useSession } from './use-session';

/**
 * §4.9's C-08 — blocking another account, issue #324, the web's `lib/community/blocks.ts`.
 *
 * <h2>Two addresses for one person</h2>
 *
 * A comment carries its author's account id and no slug, so the control under a comment blocks
 * by id (`/v1/me/blocks/{userId}`); a profile carries a slug and deliberately no id, so its
 * control blocks by slug (`/v1/users/{slug}/block`). The list in Settings → Privacy unblocks by
 * id, which every row carries.
 *
 * <h2>The comments are hidden here, not by the service</h2>
 *
 * The Comments tab is read as nobody (`lib/comments.ts` says why), so the service's per-reader
 * filter never sees this reader. {@link useBlockedIds} reads the reader's own list through the
 * session, and the tab leaves out what it names — the same two things the service leaves out of
 * a read that carries a token: a conversation a blocked account started, whole, and each reply it
 * wrote. A block made under a comment is written into that query at once, so the comments leave
 * the screen without a re-read.
 *
 * <h2>Never persisted</h2>
 *
 * The keys are under `settings` and `profile`, neither of which `lib/offline.ts` writes to the
 * device: whom somebody blocked is the most private list they keep here.
 */

/** One row of `GET /v1/me/blocks`. */
export interface BlockedAccount {
  readonly userId: string;
  readonly name: string;
  readonly slug: string;
  readonly avatarUrl: string | null;
  /** ISO-8601 instant, UTC; empty when the service sent none. */
  readonly blockedAt: string;
}

export interface BlockedPage {
  readonly items: readonly BlockedAccount[];
  readonly nextCursor: string | null;
}

/** Rows per page of the settings list. */
const PAGE_SIZE = 24;

/**
 * The bound on the id scan the Comments tab reads: ten pages of the service's ceiling, a thousand
 * people — the web's bound, and far past anybody blocking abusers rather than the platform.
 */
const ID_SCAN_PAGES = 10;
const ID_SCAN_PAGE_SIZE = 100;

function rowOf(raw: unknown): BlockedAccount | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.userId !== 'string' || typeof row.slug !== 'string') return null;
  return {
    userId: row.userId,
    name: typeof row.name === 'string' ? row.name : row.slug,
    slug: row.slug,
    avatarUrl: typeof row.avatarUrl === 'string' && row.avatarUrl !== '' ? row.avatarUrl : null,
    blockedAt: typeof row.blockedAt === 'string' ? row.blockedAt : '',
  };
}

/** One page of the people this account blocked, most recent first. The cursor is passed back unread. */
export async function fetchBlockedPage(
  cursor: string | null,
  size = PAGE_SIZE,
  signal?: AbortSignal,
): Promise<BlockedPage> {
  const body = await api().get('/v1/me/blocks', {
    query: cursor === null ? { size } : { size, cursor },
    ...(signal === undefined ? {} : { signal }),
  });
  const items = (body.items ?? []).map(rowOf).filter((row): row is BlockedAccount => row !== null);
  const next = body.nextCursor;
  return { items, nextCursor: typeof next === 'string' && next !== '' ? next : null };
}

/** Every account id this reader blocked, up to {@link ID_SCAN_PAGES} pages. */
export async function fetchBlockedIds(signal?: AbortSignal): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let read = 0; read < ID_SCAN_PAGES; read += 1) {
    const page: BlockedPage = await fetchBlockedPage(cursor, ID_SCAN_PAGE_SIZE, signal);
    for (const row of page.items) ids.add(row.userId);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return ids;
}

/** Blocks the author of a comment. Idempotent. */
export async function blockAccount(userId: string): Promise<void> {
  await sendJson('POST', `/v1/me/blocks/${encodeURIComponent(userId)}`);
}

/** Lifts a block. Idempotent: unblocking somebody not blocked succeeds. */
export async function unblockAccount(userId: string): Promise<void> {
  await sendJson('DELETE', `/v1/me/blocks/${encodeURIComponent(userId)}`);
}

function stateOf(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { blocked?: unknown }).blocked === true;
}

/** Whether this reader blocked the account behind a profile. */
export async function isBlocked(slug: string, signal?: AbortSignal): Promise<boolean> {
  const body = await api().get('/v1/users/{slug}/block', {
    path: { slug },
    ...(signal === undefined ? {} : { signal }),
  });
  return stateOf(body);
}

/** Blocks or unblocks from a profile; answers the state the service reports. */
export async function setBlocked(slug: string, block: boolean): Promise<boolean> {
  return stateOf(await sendJson(block ? 'POST' : 'DELETE', `/v1/users/${encodeURIComponent(slug)}/block`));
}

/** Which sentence a failed block or unblock shows. Branches on `code`, never on the service's prose. */
export type BlockFailure = 'staff' | 'self' | 'refused' | 'unreachable';

export function blockFailureOf(cause: unknown): BlockFailure {
  if (cause instanceof ApiError) {
    if (cause.problem?.code === 'CANNOT_BLOCK_STAFF') return 'staff';
    if (cause.problem?.code === 'CANNOT_BLOCK_YOURSELF') return 'self';
    return 'refused';
  }
  return 'unreachable';
}

const NOBODY: ReadonlySet<string> = new Set();

/**
 * The ids the Comments tab hides, and a way to add one the service just accepted.
 *
 * Empty for a visitor and until the list has answered — the tab draws everybody's page first and
 * thins it once this arrives, the web's trade (`BlockedAuthors.tsx`). A read that fails is empty
 * too: there is nothing better to show than what everybody else sees.
 */
export function useBlockedIds(): {
  readonly ids: ReadonlySet<string>;
  readonly add: (userId: string) => void;
} {
  const session = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.blockedIds(),
    enabled: canReadAccount(session),
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => fetchBlockedIds(signal),
  });
  const add = useCallback(
    (userId: string) => {
      client.setQueryData<ReadonlySet<string>>(queryKeys.blockedIds(), (previous) =>
        new Set(previous ?? NOBODY).add(userId),
      );
      void client.invalidateQueries({ queryKey: queryKeys.blockedList() });
    },
    [client],
  );
  return { ids: session.signedIn ? (query.data ?? NOBODY) : NOBODY, add };
}

/** The settings list's pages. */
export function useBlockedList(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.blockedList(),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchBlockedPage(pageParam, PAGE_SIZE, signal),
    getNextPageParam: (page: BlockedPage) => page.nextCursor ?? undefined,
  });
}

/**
 * The tab's conversations without what this reader blocked: a conversation whose root a blocked
 * account wrote goes whole, and every reply a blocked account wrote goes alone — the two things
 * the service leaves out of a read that carries a token. A tombstone names nobody, so it stays.
 */
export function withoutBlocked(
  threads: readonly CampaignCommentThread[],
  blocked: ReadonlySet<string>,
): readonly CampaignCommentThread[] {
  if (blocked.size === 0) return threads;
  const hidden = (authorId: string | null) => authorId !== null && blocked.has(authorId);
  return threads
    .filter((thread) => !hidden(thread.root.authorId))
    .map((thread) =>
      thread.replies.some((reply) => hidden(reply.authorId))
        ? { ...thread, replies: thread.replies.filter((reply) => !hidden(reply.authorId)) }
        : thread,
    );
}
