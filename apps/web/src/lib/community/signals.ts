import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.9's C-10 — the campaigns this account saved and the creators it follows.
 *
 * Two endpoints, one module, because they are one screen's data and one paginator.
 * `BackerSignalController` says the same thing from the other side: four writes and two reads
 * on one controller, sharing one rate-limit budget, because splitting them would let a script
 * that had spent its saves carry on spending follows.
 *
 * <h2>The cursor is opaque and stays that way</h2>
 *
 * `nextCursor` is a value the service encoded and only the service decodes. It is passed back
 * unread and unparsed; a client that looked inside would be a client that breaks the day the
 * encoding changes. `null` means this was the last page — not an empty string, and not a page
 * of zero rows to fetch and discard.
 */

/** How many rows a page asks for. The service clamps rather than refusing an over-large size. */
const PAGE_SIZE = 24;

export interface SavedCampaign {
  readonly projectId: string;
  readonly title: string;
  readonly creatorSlug: string;
  readonly projectSlug: string;
  /** ISO-8601 instant, UTC. */
  readonly savedAt: string;
}

export interface FollowedCreator {
  readonly creatorId: string;
  readonly name: string;
  readonly slug: string;
  readonly followedAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** `null` on the last page. */
  readonly nextCursor: string | null;
}

interface RawPage<T> {
  readonly items?: readonly T[];
  readonly nextCursor?: string | null;
}

async function readPage<T>(path: string, cursor: string | null, signal?: AbortSignal): Promise<Page<T>> {
  const query = new URLSearchParams({ size: String(PAGE_SIZE) });
  if (cursor !== null) query.set('cursor', cursor);

  const response = await authorizedFetch(`${path}?${query.toString()}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as RawPage<T>;
  return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
}

/** One page of saved campaigns, most recently saved first — `GET /v1/me/saved`. */
export function listSaved(cursor: string | null = null, signal?: AbortSignal): Promise<Page<SavedCampaign>> {
  return readPage<SavedCampaign>('/v1/me/saved', cursor, signal);
}

/** One page of followed creators — `GET /v1/me/following`. */
export function listFollowing(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<FollowedCreator>> {
  return readPage<FollowedCreator>('/v1/me/following', cursor, signal);
}

/** Removes a campaign from the saved list — `DELETE /v1/projects/{id}/save`. */
export async function unsaveCampaign(projectId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/save`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await errorFrom(response);
}

/**
 * Stops following a creator — `DELETE /v1/users/{slug}/follow`.
 *
 * By slug, because that is how the service addresses a person outside their own module: the
 * follow is made from a creator's page and a creator's page is reached by slug.
 */
export async function unfollowCreator(slug: string): Promise<void> {
  const response = await authorizedFetch(`/v1/users/${encodeURIComponent(slug)}/follow`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await errorFrom(response);
}

/**
 * Follows a creator — `POST /v1/users/{slug}/follow`. Issue #143.
 *
 * Idempotent on the service's side: following somebody already followed is the same success.
 * The answer is the service's `{ following }`, and the caller draws that rather than assuming.
 */
export async function followCreator(slug: string): Promise<boolean> {
  const response = await authorizedFetch(`/v1/users/${encodeURIComponent(slug)}/follow`, {
    method: 'POST',
  });
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { readonly following?: boolean };
  return body.following ?? true;
}

/** The largest page `GET /v1/me/following` serves — `CommunityProperties.Signals`' ceiling. */
const FOLLOWING_SCAN_PAGE_SIZE = 100;

/** How many of those pages a follow control reads before it stops looking. */
const FOLLOWING_SCAN_PAGES = 5;

/**
 * Whether the signed-in reader follows `slug`, read from `GET /v1/me/following`. Issue #143.
 *
 * There is no per-creator "do I follow this" read (#137 proposes a viewer-state endpoint), so
 * the list is walked at the service's largest page size. The walk stops after
 * `FOLLOWING_SCAN_PAGES` pages — five hundred accounts — and answers `false` beyond that. That
 * is safe rather than merely convenient, for the reason `CampaignActions` gives about saving:
 * following is idempotent, so the worst case is a reader who follows five hundred people
 * pressing Follow and being told they follow this one, which is true.
 */
export async function isFollowing(slug: string, signal?: AbortSignal): Promise<boolean> {
  let cursor: string | null = null;
  for (let read = 0; read < FOLLOWING_SCAN_PAGES; read += 1) {
    const query = new URLSearchParams({ size: String(FOLLOWING_SCAN_PAGE_SIZE) });
    if (cursor !== null) query.set('cursor', cursor);

    const response = await authorizedFetch(`/v1/me/following?${query.toString()}`, { signal });
    if (!response.ok) throw await errorFrom(response);

    const body = (await response.json()) as RawPage<FollowedCreator>;
    if ((body.items ?? []).some((creator) => creator.slug === slug)) return true;

    cursor = body.nextCursor ?? null;
    if (cursor === null) return false;
  }
  return false;
}

/**
 * The public address of a campaign.
 *
 * §10.2's `/projects/{creatorSlug}/{projectSlug}`. The folder under `app/` is called `[id]`
 * for a framework reason the campaign page's own comment explains, and the URL is the one
 * written here.
 */
export function campaignHref(campaign: Pick<SavedCampaign, 'creatorSlug' | 'projectSlug'>): string {
  return `/projects/${encodeURIComponent(campaign.creatorSlug)}/${encodeURIComponent(campaign.projectSlug)}`;
}
