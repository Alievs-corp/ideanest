import type { components } from '@ideanest/api-client';
import { api, sendJson } from '../../api/client';
import type { Page } from './use-cursor-list';

/**
 * The account area's reads and its one write of its own — #159, after the web's
 * `lib/community/signals.ts` and `lib/projects/mine.ts`.
 *
 * <p>Every row is narrowed here: a row without its identity cannot be keyed, opened or removed,
 * so it is dropped rather than drawn. The generated schema types the following list with the
 * saved list's row (both are called `Item` in the contract), so that one is read as `unknown`.
 */

/** The web's `PAGE_SIZE` for the two signal lists and `PROFILE_PAGE_SIZE` for My campaigns. */
export const ACCOUNT_PAGE_SIZE = 24;

export interface SavedCampaign {
  readonly projectId: string;
  readonly title: string;
  readonly creatorSlug: string;
  readonly projectSlug: string;
  /** ISO-8601 instant; empty when the service sent none. */
  readonly savedAt: string;
}

export interface FollowedCreator {
  readonly creatorId: string;
  readonly name: string;
  readonly slug: string;
  readonly followedAt: string;
}

export type MyCampaign = components['schemas']['ProfileProjectCard'] & {
  readonly id: string;
  readonly state: string;
};

type Cursor = string | null;

/** The signal lists' page parameters: `size`, and the cursor when there is one. */
function signalQuery(cursor: Cursor) {
  return cursor === null ? { size: ACCOUNT_PAGE_SIZE } : { size: ACCOUNT_PAGE_SIZE, cursor };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function savedFrom(row: unknown): SavedCampaign | null {
  if (typeof row !== 'object' || row === null) return null;
  const item = row as Record<string, unknown>;
  const projectId = text(item.projectId);
  if (projectId === '') return null;
  return {
    projectId,
    title: text(item.title),
    creatorSlug: text(item.creatorSlug),
    projectSlug: text(item.projectSlug),
    savedAt: text(item.savedAt),
  };
}

function followedFrom(row: unknown): FollowedCreator | null {
  if (typeof row !== 'object' || row === null) return null;
  const item = row as Record<string, unknown>;
  const creatorId = text(item.creatorId);
  const slug = text(item.slug);
  if (creatorId === '' || slug === '') return null;
  return { creatorId, slug, name: text(item.name) || slug, followedAt: text(item.followedAt) };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/** One page of saved campaigns, most recently saved first — `GET /v1/me/saved`. */
export async function listSaved(cursor: Cursor, signal?: AbortSignal): Promise<Page<SavedCampaign>> {
  const body = await api().get('/v1/me/saved', {
    query: signalQuery(cursor),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    items: (body.items ?? []).map(savedFrom).filter(present),
    nextCursor: body.nextCursor ?? null,
  };
}

/** One page of followed creators — `GET /v1/me/following`. */
export async function listFollowing(
  cursor: Cursor,
  signal?: AbortSignal,
): Promise<Page<FollowedCreator>> {
  const body: { readonly items?: readonly unknown[]; readonly nextCursor?: string } = await api().get(
    '/v1/me/following',
    { query: signalQuery(cursor), ...(signal === undefined ? {} : { signal }) },
  );
  return {
    items: (body.items ?? []).map(followedFrom).filter(present),
    nextCursor: body.nextCursor ?? null,
  };
}

/** One page of this account's own campaigns, drafts included — `GET /v1/me/projects`. */
export async function listMyProjects(cursor: Cursor, signal?: AbortSignal): Promise<Page<MyCampaign>> {
  const body = await api().get('/v1/me/projects', {
    query: cursor === null ? { limit: ACCOUNT_PAGE_SIZE } : { limit: ACCOUNT_PAGE_SIZE, cursor },
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    items: (body.projects ?? []).filter(
      (card): card is MyCampaign => typeof card.id === 'string' && card.id !== '' && typeof card.state === 'string',
    ),
    nextCursor: body.nextCursor ?? null,
  };
}

/**
 * Stops following a creator — `DELETE /v1/users/{slug}/follow`. Resolves with whether the account
 * still follows them: the service is idempotent, so an unfollow of nobody followed is `false` too.
 */
export async function unfollowCreator(slug: string): Promise<boolean> {
  const body = await sendJson('DELETE', `/v1/users/${encodeURIComponent(slug)}/follow`);
  return typeof body === 'object' && body !== null && (body as { following?: unknown }).following === true;
}
