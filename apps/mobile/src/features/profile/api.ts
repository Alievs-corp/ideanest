import { useCallback, useMemo, useRef } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { readCreatorObligations } from '@ideanest/campaign/obligation';
import { api, publicApi, sendJson } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { unfollowCreator } from '../account/api';
import {
  PROFILE_PAGE_SIZE,
  readProjectCardPage,
  readPublicProfile,
  type ProfilePage,
  type ProfileProjectCard,
} from './wire';

/**
 * The profile screen's reads and its one write (#156).
 *
 * <p>The three public reads go out as nobody (`publicApi()`), as the web reads them, and all at
 * once on open: the profile, the first page of both lists (the tab counts depend on them) and the
 * obligations. Everything lives under the `profile` root, which `lib/offline.ts` never persists —
 * in memory for the session, gone on restart.
 *
 * <p>The profile query stores the body as it arrived and narrows it in `select`, exactly like the
 * Creator tab's `useCreatorProfile`: both read `queryKeys.profile(slug)`, so opening a profile from
 * that tab costs no second request.
 */

export type ProfileListKind = 'created' | 'backed';
type Cursor = string | null;
type Pages = InfiniteData<ProfilePage, Cursor>;

export function usePublicProfile(slug: string) {
  return useQuery({
    queryKey: queryKeys.profile(slug),
    enabled: slug !== '',
    queryFn: ({ signal }) => publicApi().get('/v1/users/{slug}', { path: { slug }, signal }),
    select: readPublicProfile,
  });
}

/** A 404 — unknown, closed and private alike — is the not-found screen, never a retry. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** `null` for a creator with nothing to say, a failed read, or a body that cannot be read. */
export function useCreatorObligations(slug: string) {
  return useQuery({
    queryKey: queryKeys.profileObligations(slug),
    enabled: slug !== '',
    queryFn: async ({ signal }) =>
      readCreatorObligations(
        await publicApi().get('/v1/users/{slug}/update-obligations', { path: { slug }, signal }),
      ),
  });
}

export function profileListKey(slug: string, kind: ProfileListKind) {
  return kind === 'created' ? queryKeys.profileProjects(slug) : queryKeys.profileBacked(slug);
}

/** One page of either list, narrowed. */
export async function fetchProfilePage(
  slug: string,
  kind: ProfileListKind,
  cursor: Cursor,
  signal?: AbortSignal,
): Promise<ProfilePage> {
  const options = {
    path: { slug },
    query: cursor === null ? { limit: PROFILE_PAGE_SIZE } : { limit: PROFILE_PAGE_SIZE, cursor },
    ...(signal === undefined ? {} : { signal }),
  };
  const body =
    kind === 'created'
      ? await publicApi().get('/v1/users/{slug}/projects', options)
      : await publicApi().get('/v1/users/{slug}/backed', options);
  return readProjectCardPage(body);
}

export interface ProfileList {
  readonly items: readonly ProfileProjectCard[];
  /** The first page, for the tab's known total; `undefined` until it has arrived. */
  readonly first: ProfilePage | undefined;
  readonly loading: boolean;
  /** The first page failed and nothing is cached. */
  readonly failed: boolean;
  readonly retrying: boolean;
  readonly hasMore: boolean;
  readonly fetchingMore: boolean;
  /** Why the next page did not load, or `null`. */
  readonly moreError: unknown;
  /** Appends the next page — never the same cursor twice unless `retry` follows a failure. */
  readonly loadMore: (options?: { readonly retry?: boolean }) => void;
  readonly retry: () => void;
  /** Back to the first page, read again. */
  readonly refresh: () => Promise<void>;
}

export function useProfileList(slug: string, kind: ProfileListKind): ProfileList {
  const client = useQueryClient();
  const key = useMemo(() => profileListKey(slug, kind), [slug, kind]);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled: slug !== '',
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) => fetchProfilePage(slug, kind, pageParam, signal),
    getNextPageParam: (page: ProfilePage) => page.nextCursor ?? undefined,
  });

  const pages = query.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((page) => page.items), [pages]);
  const nextCursor = pages?.at(-1)?.nextCursor ?? null;
  const { fetchNextPage, refetch, isFetching, hasNextPage, isFetchNextPageError } = query;
  const asked = useRef<string | null>(null);

  const loadMore = useCallback(
    ({ retry = false }: { readonly retry?: boolean } = {}) => {
      if (!hasNextPage || nextCursor === null || isFetching) return;
      if (asked.current === nextCursor && !(retry && isFetchNextPageError)) return;
      asked.current = nextCursor;
      void fetchNextPage({ cancelRefetch: false });
    },
    [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError, nextCursor],
  );

  const refresh = useCallback(async () => {
    client.setQueryData<Pages>(key, (data) =>
      data === undefined
        ? data
        : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
    );
    asked.current = null;
    await refetch();
  }, [client, key, refetch]);

  return {
    items,
    first: pages?.[0],
    loading: pages === undefined && query.isPending,
    failed: query.isError && pages === undefined,
    retrying: isFetching,
    hasMore: hasNextPage,
    fetchingMore: query.isFetchingNextPage,
    moreError: isFetchNextPageError ? query.error : null,
    loadMore,
    retry: () => void refetch(),
    refresh,
  };
}

/** The largest page `GET /v1/me/following` serves, and how many of them are walked. */
const FOLLOWING_PAGE = 100;
const FOLLOWING_PAGES = 5;

/**
 * Whether the signed-in reader follows `slug` — the web's `isFollowing`. There is no per-creator
 * read yet (#137), so the list is walked, five hundred accounts at most; past that the answer is
 * `false`, which is safe because following is idempotent.
 */
export async function isFollowing(slug: string, signal?: AbortSignal): Promise<boolean> {
  let cursor: string | undefined;
  for (let read = 0; read < FOLLOWING_PAGES; read += 1) {
    const body: { readonly items?: readonly unknown[]; readonly nextCursor?: string } =
      await api().get('/v1/me/following', {
        query: cursor === undefined ? { size: FOLLOWING_PAGE } : { size: FOLLOWING_PAGE, cursor },
        ...(signal === undefined ? {} : { signal }),
      });
    const found = (body.items ?? []).some(
      (row) => typeof row === 'object' && row !== null && (row as { slug?: unknown }).slug === slug,
    );
    if (found) return true;
    cursor = body.nextCursor === undefined || body.nextCursor === '' ? undefined : body.nextCursor;
    if (cursor === undefined) return false;
  }
  return false;
}

/** `viewer` is the signed-in account's slug; disabled until it is known. */
export function useFollowing(slug: string, viewer: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.profileFollowing(slug, viewer ?? ''),
    enabled: enabled && viewer !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await isFollowing(slug, signal);
      } catch {
        // Unread is not "not following", but offering Follow is safe: the write is idempotent.
        return false;
      }
    },
  });
}

/**
 * `POST /v1/users/{slug}/follow`, or the Following screen's `unfollowCreator` for `DELETE`; the
 * service's `following` is what is drawn.
 */
export async function setFollowing(slug: string, follow: boolean): Promise<boolean> {
  if (!follow) return unfollowCreator(slug);
  const body = await sendJson('POST', `/v1/users/${encodeURIComponent(slug)}/follow`);
  const answer = typeof body === 'object' && body !== null ? (body as { following?: unknown }).following : undefined;
  return typeof answer === 'boolean' ? answer : true;
}
