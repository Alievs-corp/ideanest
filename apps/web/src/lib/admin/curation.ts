import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-03: editorial collections, the badges they grant, open calls, and placement —
 * issues #300, #301, #302 and #303.
 *
 * <h2>Four issues, one endpoint set, and that is not an accident</h2>
 *
 * The four screens the epic asks for are four questions about the same table. V14 made that
 * choice deliberately and its own header says why: a staff selection, a themed list and an
 * open call all have a slug in a URL, translated copy, a publication decision, an optional
 * window, cover imagery and an edited sequence of campaigns behind them, and the kind is the
 * only thing that differs. So `/admin/curation` is the manager, `/badges` is the ones that
 * grant a badge, `/open-calls` is the ones with a window, and `/placements` is the order they
 * appear in — and every one of them reads {@link listCollections}.
 *
 * <h2>There is no delete, and there will not be one</h2>
 *
 * A collection anything has happened to cannot be hard deleted: `curation_events.collection_id`
 * has no `ON DELETE` clause, on purpose. Withdrawing one unpublishes it, which 404s to the
 * public and leaves the record of why intact. {@link unpublishCollection} is the whole of it.
 *
 * <h2>Every mutation carries a note, and the note is required</h2>
 *
 * Publishing, withdrawing, adding a campaign and removing one are all audited, and the
 * service refuses each without a reason. That is not a form validation this client invented —
 * it is `minLength: 1` in the contract, and the reason is that in a badge-granting collection
 * adding a campaign <em>is</em> §3.2's "apply an editorial badge", which is a decision
 * somebody may have to justify a year later.
 */

/** §4.3's three senses of a curated list. */
export type CollectionKind = 'staff_selection' | 'themed' | 'open_call';

/**
 * The three kinds, as values.
 *
 * <p>Values only since #324. This used to be a table of English words, which put a
 * translatable noun in a module a client imports — the words are `admin.curation.kind` now,
 * keyed by these same values, and this array stays the one place that says which kinds exist
 * and in what order a form offers them.
 */
export const COLLECTION_KINDS: readonly CollectionKind[] = Object.freeze([
  'staff_selection',
  'themed',
  'open_call',
]);

/** The copy for one locale. Both halves are optional; a list with neither is not useful. */
export interface CollectionCopy {
  title?: string | null;
  description?: string | null;
}

export interface CollectionCover {
  url: string;
  width?: number | null;
  height?: number | null;
}

/**
 * One campaign in a collection, as staff see it.
 *
 * <p>`publiclyVisible` is what makes this the admin projection rather than the public one: a
 * curator may have added a campaign that has since been suspended, and the membership row
 * stays while the campaign stops being shown. A manager that hid those rows would leave
 * somebody unable to remove the one thing they came to remove.
 */
export interface CollectionMember {
  projectId: string;
  slug: string;
  title: string;
  state: string;
  position: number;
  publiclyVisible: boolean;
}

export interface AdminCollection {
  id: string;
  slug: string;
  kind: CollectionKind;
  /** Locale to copy. At least one entry; the service refuses a body with none. */
  copy: Record<string, CollectionCopy>;
  /**
   * The cover, as the service returns it.
   *
   * <p>Named `image` on the way out and `cover` on the way in, which is the contract's
   * spelling rather than this client's preference — {@link CollectionBody} carries the other
   * one. Renaming either here would make the two halves of a round trip disagree with the
   * generated types in `@ideanest/api-client`.
   */
  image?: CollectionCover | null;
  /** Present exactly when the collection is published. Absent is "not visible to anybody". */
  publishedAt?: string | null;
  /** ISO-8601 instants, or absent for a standing list with no window. */
  opensAt?: string | null;
  closesAt?: string | null;
  /** Whether being in this list badges a campaign — §3.2, §4.4, D-05. */
  grantsBadge: boolean;
  /** Where it sits among the others. Lower first; #303's whole subject. */
  sortOrder: number;
  /** Present on the single-collection read, absent from the index. */
  projects?: CollectionMember[];
}

interface CollectionIndex {
  items: AdminCollection[];
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Every collection, published or not, in placement order. */
export async function listCollections(signal?: AbortSignal): Promise<AdminCollection[]> {
  const response = await authorizedFetch('/v1/admin/collections', { signal });
  if (!response.ok) throw await errorFrom(response);

  return ((await response.json()) as CollectionIndex).items;
}

/** One collection with its copy and its membership, including campaigns the public cannot see. */
export async function readCollection(
  slug: string,
  signal?: AbortSignal,
): Promise<AdminCollection> {
  const response = await authorizedFetch(`/v1/admin/collections/${encodeURIComponent(slug)}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

/** What a create or a replace sends. `PUT` replaces the whole description, so this is all of it. */
export interface CollectionBody {
  kind: CollectionKind;
  copy: Record<string, CollectionCopy>;
  cover?: CollectionCover | null;
  opensAt?: string | null;
  closesAt?: string | null;
  grantsBadge?: boolean;
  sortOrder?: number;
}

export async function createCollection(
  slug: string,
  collection: CollectionBody,
): Promise<AdminCollection> {
  const response = await authorizedFetch('/v1/admin/collections', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ slug, collection }),
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

/**
 * Replaces the whole description: kind, window, badge grant, placement, imagery, copy.
 *
 * <p>`PUT` and not `PATCH`, which the service chose and this client keeps honest by always
 * sending every field. A screen that sent only what a form touched would silently clear the
 * fields it did not — and one of those fields decides whether a campaign is badged.
 */
export async function replaceCollection(
  slug: string,
  collection: CollectionBody,
): Promise<AdminCollection> {
  const response = await authorizedFetch(`/v1/admin/collections/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(collection),
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

/** Makes the list visible to the public. The note is required and is audited. */
export async function publishCollection(slug: string, note: string): Promise<AdminCollection> {
  return act(slug, 'publish', { note });
}

/** Takes it back down. Also audited, and also with a reason. */
export async function unpublishCollection(slug: string, note: string): Promise<AdminCollection> {
  return act(slug, 'unpublish', { note });
}

/**
 * Curates a campaign into the list, at the end of it.
 *
 * <p>In a badge-granting collection this <em>is</em> §3.2's "apply an editorial badge", which
 * is why the note is required rather than optional.
 */
export async function addProject(
  slug: string,
  projectId: string,
  note: string,
): Promise<AdminCollection> {
  return act(slug, 'projects', { projectId, note });
}

/** Takes a campaign out, and its badge with it. */
export async function removeProject(
  slug: string,
  projectId: string,
  note: string,
): Promise<AdminCollection> {
  const response = await authorizedFetch(
    `/v1/admin/collections/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}/remove`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ note }) },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

/**
 * Restates the whole sequence.
 *
 * <p>The body names every campaign in the collection exactly once. A partial order would
 * leave the rest wherever they happened to be, which is why the service made this a `PUT`.
 */
export async function reorderProjects(
  slug: string,
  projectIds: readonly string[],
): Promise<AdminCollection> {
  const response = await authorizedFetch(
    `/v1/admin/collections/${encodeURIComponent(slug)}/projects/order`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ projectIds }) },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

async function act(slug: string, action: string, body: unknown): Promise<AdminCollection> {
  const response = await authorizedFetch(
    `/v1/admin/collections/${encodeURIComponent(slug)}/${action}`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminCollection;
}

/**
 * The whole collection, as a body to send back.
 *
 * <p><strong>This is the safety rail in front of `PUT`.</strong> The endpoint replaces the
 * entire description — kind, window, badge grant, placement, imagery, copy — so a screen that
 * built a body from the one field it meant to change would silently clear the other six. Two
 * of those decide whether the list is an open call and whether being in it badges a campaign,
 * which are not fields to lose by omission.
 *
 * <p>So every editor builds its request as {@code bodyOf(collection)} with one field
 * overridden, and the only way to clear something is to say so.
 *
 * <p>The cover crosses the two names the contract uses: `image` coming back, `cover` going
 * out. `AdminCollection` records why neither is renamed here.
 */
export function bodyOf(collection: AdminCollection): CollectionBody {
  return {
    kind: collection.kind,
    copy: collection.copy,
    cover: collection.image ?? null,
    opensAt: collection.opensAt ?? null,
    closesAt: collection.closesAt ?? null,
    grantsBadge: collection.grantsBadge,
    sortOrder: collection.sortOrder,
  };
}

/* -------------------------------------------------------------------------
 * Reading a collection, without deciding how to draw it
 * ---------------------------------------------------------------------- */

/**
 * The title a curator sees, from whichever locale has one.
 *
 * <p>The admin projection returns the copy for every locale rather than resolving one, which
 * is right — a curator editing the Russian title has to see that it is the Russian title. A
 * list still needs one line per row, so this is the chain: the platform's own language first,
 * then English, then whatever exists, then the slug.
 *
 * <p>It falls back to the slug rather than to an empty string for `Taxonomy.resolveName`'s
 * reason: a heading that renders empty is worse than one that renders a handle.
 */
export function collectionTitle(collection: AdminCollection): string {
  const preferred = ['az', 'en'];
  for (const locale of preferred) {
    const title = collection.copy[locale]?.title;
    if (title != null && title !== '') return title;
  }
  for (const copy of Object.values(collection.copy)) {
    if (copy.title != null && copy.title !== '') return copy.title;
  }
  return collection.slug;
}

/** Whether the public can see this list at all. */
export function isPublished(collection: AdminCollection): boolean {
  return collection.publishedAt != null;
}

/**
 * Whether an open call's window is open at a given instant.
 *
 * <p>Takes `now` rather than reading the clock, so that every row on one render is judged
 * against the same instant and the tests do not have to freeze time — the rule
 * `lib/moderation/describe.ts` states for the queue.
 *
 * <p>A window with no `opensAt` has always been open; one with no `closesAt` does not close.
 * Both halves are optional in the schema, and a standing list is the ordinary case.
 */
export function isWindowOpen(collection: AdminCollection, now: Date): boolean {
  const at = now.getTime();
  if (collection.opensAt != null && new Date(collection.opensAt).getTime() > at) return false;
  if (collection.closesAt != null && new Date(collection.closesAt).getTime() <= at) return false;
  return true;
}

/** The static screens beside `/admin/curation/[slug]`; a collection with one of these handles could never be opened. */
export const RESERVED_HANDLES: readonly string[] = Object.freeze(['badges', 'open-calls', 'placements']);

export type HandleProblem = 'shape' | 'length' | 'reserved';

/** What is wrong with a handle before the service is asked, mirroring V14's checks. */
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < 2 || handle.length > 80) return 'length';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle)) return 'shape';
  if (RESERVED_HANDLES.includes(handle)) return 'reserved';
  return null;
}

/** A placement after every existing one, so a new collection does not jump to the top. */
export function nextSortOrder(collections: readonly AdminCollection[]): number {
  return collections.reduce((highest, collection) => Math.max(highest, collection.sortOrder), 0) + 10;
}

export interface PlacementChange {
  readonly collection: AdminCollection;
  readonly sortOrder: number;
}

/**
 * The writes that move one collection a step, given the list in its current order.
 *
 * <p>Swapping the two numbers is enough only when the whole list is strictly increasing. Two
 * collections sharing a number — every collection created before placement was set — swap to
 * the same order they started in, so then the list is renumbered in tens instead.
 */
export function placementChanges(
  ordered: readonly AdminCollection[],
  index: number,
  direction: -1 | 1,
): PlacementChange[] {
  const first = ordered[index];
  const second = ordered[index + direction];
  if (first === undefined || second === undefined) return [];

  const increasing = ordered.every(
    (collection, i) => i === 0 || (ordered[i - 1]?.sortOrder ?? 0) < collection.sortOrder,
  );
  if (increasing) {
    return [
      { collection: first, sortOrder: second.sortOrder },
      { collection: second, sortOrder: first.sortOrder },
    ];
  }

  const moved = [...ordered];
  moved[index] = second;
  moved[index + direction] = first;
  return moved
    .map((collection, i) => ({ collection, sortOrder: (i + 1) * 10 }))
    .filter((change) => change.collection.sortOrder !== change.sortOrder);
}

/** The collection's copy in one locale, or empty strings for a locale it has none in. */
export function copyIn(
  collection: AdminCollection,
  locale: string,
): { title: string; description: string } {
  const copy = collection.copy[locale];
  return { title: copy?.title ?? '', description: copy?.description ?? '' };
}
