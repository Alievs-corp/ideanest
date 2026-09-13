import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Page } from '../community/signals';
import { PROFILE_PAGE_SIZE, type ProfileProjectCard } from '../profiles/api';
import { readProjectCardPage } from '../profiles/wire';

/**
 * `GET /v1/me/projects` — the reader's own campaigns, drafts included.
 *
 * <h2>A module of its own rather than a third function in `lib/profiles/api.ts`</h2>
 *
 * That one reads two public lists through `publicFetch`, and its whole docblock is about a
 * 404 contract this endpoint does not have. This list is behind a bearer token, is never
 * server-rendered, and answers 401 rather than 404 — three differences, none of which a
 * boolean on the shared reader would make legible at the call site.
 *
 * <h2>The card is the same shape, deliberately</h2>
 *
 * The service answers with the same {@link ProfileProjectCard}, so the same narrowing runs
 * over it. What differs is `state`: the public lists carry nine of §6.1's sixteen and this
 * one carries all of them, which is the entire reason the endpoint exists.
 */

/**
 * §6.1's nine public states, for deciding where a row points.
 *
 * <p><strong>A presentation decision and not a copy of the server's filter.</strong> The
 * service already decided what is on this list; this only decides whether a creator pressing
 * a row wants the editor or the page a backer would see. Getting it wrong sends somebody to
 * the wrong screen — it does not disclose anything, which is why it is allowed to live in a
 * client at all.
 */
const PUBLIC_STATES: ReadonlySet<string> = new Set([
  'PRELAUNCH',
  'LIVE',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  // IDN-EXT-01 (#32): still taking pledges, and closed by withdrawal.
  'CLOSING_WINDOW',
  'EXTENDED',
  'WITHDRAWN',
]);

/** Whether this campaign has an address a backer could open. */
export function isPubliclyVisible(card: ProfileProjectCard): boolean {
  return PUBLIC_STATES.has(card.state);
}

/**
 * Where a row goes when the reader is its creator.
 *
 * <p>A campaign that is not yet public has no page to send anybody to — `/projects/{creator}/
 * {slug}` answers 404 for a draft — so the editor is not a preference here, it is the only
 * address that exists. A public one goes to the page instead: a creator opening a live
 * campaign is almost always looking at what a backer sees, and the editor is one press away
 * from there.
 */
export function myCampaignHref(card: ProfileProjectCard): string {
  if (isPubliclyVisible(card)) {
    return `/projects/${encodeURIComponent(card.creatorSlug)}/${encodeURIComponent(card.slug)}`;
  }
  return `/projects/${encodeURIComponent(card.id)}/edit/basics`;
}

/**
 * One page of the reader's own campaigns, newest first.
 *
 * `authorizedFetch` and not `publicFetch`: there is no anonymous form of this question, and
 * a reader with no token should meet the sign-in wall rather than an empty list.
 */
export async function listMyProjects(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<ProfileProjectCard>> {
  const query = new URLSearchParams({ limit: String(PROFILE_PAGE_SIZE) });
  if (cursor !== null) query.set('cursor', cursor);

  const response = await authorizedFetch(`/v1/me/projects?${query.toString()}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return readProjectCardPage((await response.json()) as unknown);
}
