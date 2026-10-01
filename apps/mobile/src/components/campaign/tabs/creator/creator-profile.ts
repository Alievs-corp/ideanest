import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { queryKeys } from '../../../../api/queries';

/**
 * The Creator tab's reads (#155): the creator's public profile and a few of their campaigns —
 * the web's `lib/projects/creatorProfile.ts` over `lib/profiles/wire.ts`'s narrowing.
 *
 * <h2>Two reads, asked for when the tab opens</h2>
 *
 * `GET /v1/users/{slug}` and `GET /v1/users/{slug}/projects?limit=7`. `enabled` is the tab's
 * `active`, so a reader who never opens the Creator tab costs the service nothing (#155's "tab
 * data loads lazily").
 *
 * <h2>Never persisted, and stored as the service sent it</h2>
 *
 * Both live under the `profile` root, which `lib/offline.ts` refuses to persist: a profile is
 * somebody else's, and last week's describes a person as they no longer describe themselves.
 * The query holds the response body as it arrived and `select` narrows it — so the profile screen
 * (#156), which shares `queryKeys.profile`, can read the same cache entry in its own shape.
 *
 * The campaigns list adds the size it asks for to `queryKeys.profileProjects`: seven rows is not
 * the profile screen's page of that list, and the two must not answer each other.
 *
 * <h2>Every refusal is one answer</h2>
 *
 * The service answers 404 alike for an unknown slug, a closed account and a `PRIVATE` profile, so
 * that nobody can tell them apart. Nothing here distinguishes them either: a failed or unreadable
 * profile is `null`, and the tab draws the campaign's own name and avatar with no link and no
 * explanation — "this profile is private" would rebuild in the interface the oracle the 404 closes.
 */

/** How many of a creator's other campaigns the tab lists — the web's `CREATOR_PROJECT_LIMIT`. */
export const CREATOR_PROJECT_LIMIT = 6;

/** One more than the tab shows, so dropping the campaign being read still leaves six. */
const CREATOR_PROJECT_ASK = CREATOR_PROJECT_LIMIT + 1;

/** The fields of §4.2's public profile the tab draws. */
export interface CreatorProfile {
  readonly slug: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Plain text. `null` is a creator who has written none; the row is then left out. */
  readonly bio: string | null;
  /** ISO-8601 instant. `null` only for a body that did not carry one — never "January 1970". */
  readonly joinedAt: string | null;
}

/** One of the creator's campaigns, as the tab's row needs it. */
export interface CreatorProject {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly creatorSlug: string;
  readonly blurb: string | null;
  /** An open string (#323): a state with no word in the catalogue is drawn without one. */
  readonly state: string;
}

/**
 * The profile body, or `null` when it cannot be drawn. Without a slug there is nothing to link to
 * and without a name nothing to call them, so either missing is no profile at all.
 */
export function readCreatorProfile(value: unknown): CreatorProfile | null {
  const source = object(value);
  if (source === null) return null;
  const slug = text(source['slug']);
  const name = text(source['name']);
  if (slug === null || name === null) return null;
  return {
    slug,
    name,
    avatarUrl: text(source['avatarUrl']),
    bio: text(source['bio']),
    joinedAt: text(source['joinedAt']),
  };
}

/**
 * The campaigns body, narrowed. A row missing any of the five fields that make a link is dropped
 * rather than drawn as an unlabelled hole in somebody's body of work.
 */
export function readCreatorProjects(value: unknown): readonly CreatorProject[] {
  const source = object(value);
  const rows = source === null ? null : source['projects'];
  if (!Array.isArray(rows)) return [];
  const projects: CreatorProject[] = [];
  for (const row of rows as readonly unknown[]) {
    const card = object(row);
    if (card === null) continue;
    const id = text(card['id']);
    const title = text(card['title']);
    const slug = text(card['slug']);
    const creatorSlug = text(card['creatorSlug']);
    const state = text(card['state']);
    if (id === null || title === null || slug === null || creatorSlug === null || state === null) {
      continue;
    }
    projects.push({ id, title, slug, creatorSlug, blurb: text(card['blurb']), state });
  }
  return projects;
}

/**
 * The campaigns the tab lists: the creator's, minus the one being read, at most six, in the
 * service's order (newest first). Which of them the reader is already on is this tab's question,
 * not the endpoint's.
 */
export function otherCampaigns(
  projects: readonly CreatorProject[],
  currentId: string,
): readonly CreatorProject[] {
  return projects.filter((project) => project.id !== currentId).slice(0, CREATOR_PROJECT_LIMIT);
}

export function useCreatorProfile(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.profile(slug),
    enabled,
    queryFn: ({ signal }) => api().get('/v1/users/{slug}', { path: { slug }, signal }),
    select: readCreatorProfile,
  });
}

export function useCreatorProjects(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.profileProjects(slug), CREATOR_PROJECT_ASK] as const,
    enabled,
    queryFn: ({ signal }) =>
      api().get('/v1/users/{slug}/projects', {
        path: { slug },
        query: { limit: CREATOR_PROJECT_ASK },
        signal,
      }),
    select: readCreatorProjects,
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
