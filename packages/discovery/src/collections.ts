/**
 * §4.3's D-08 — curated collections and open calls, as `GET /v1/collections` and
 * `GET /v1/collections/{slug}` send them (`CollectionController`, `CollectionResponses`).
 *
 * Moved here from `apps/web/src/lib/collections/api.ts` for the app's collection screens (#154).
 * Which wire rows can be rendered, which kind a collection is, what its window says and in what
 * order, and how a page is asked for are the same on a phone as in a browser; the reads stay in
 * each application, and so does the date formatter, which is the one piece that differs by
 * runtime (Hermes has no `formatToParts` for Azerbaijani).
 *
 * <h2>A collection that is not visible is ABSENT, and a client must not decorate that</h2>
 *
 * The service answers **404** for a slug that names nothing, for a collection that has not been
 * published, and for one outside its own window. Three different facts, one answer,
 * deliberately: a 403 would confirm that `/collections/spring-2027` exists to anybody who
 * guesses the slug. So nothing here distinguishes them, and both clients render their ordinary
 * not-found for all three.
 *
 * <h2>Null fields are absent, not null</h2>
 *
 * The service serialises with `default-property-inclusion: non_null`, so a collection with no
 * standfirst has no `description` key at all and the last page has no `nextCursor` key. The wire
 * types below say so; the types a component sees say `T | null`, because a screen renders "there
 * is no cover" and never "the field I expected is missing".
 */

/** `CollectionKind`'s three wire values. */
export type CollectionKind = 'staff_selection' | 'themed' | 'open_call';

export const COLLECTION_KINDS: readonly CollectionKind[] = ['staff_selection', 'themed', 'open_call'];

/** Whether a wire kind is one this build knows. An unknown kind costs a label, never a page. */
export function isCollectionKind(kind: string): kind is CollectionKind {
  return (COLLECTION_KINDS as readonly string[]).includes(kind);
}

export interface CollectionImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/**
 * One collection, as a reader sees it.
 *
 * <h2>`kind` is a `string`, not the union</h2>
 *
 * WIDENED ON PURPOSE. §4.3 may grow a fourth kind, and a service that starts sending it must not
 * be able to make a client throw or render nothing: a screen that meets an unfamiliar kind shows
 * the collection without a kind label or sentence, which is still a screen.
 *
 * <h2>The window is two instants, and a visible collection is always inside it</h2>
 *
 * `PostgresCuratedCollections` selects on `opens_at <= now()` and `closes_at > now()`, so
 * anything a reader can reach opened in the past and closes in the future. That is what makes
 * "Closes 12 September" honest without comparing against a clock — and why `windowFacts` states
 * dates rather than a countdown: a response may be sixty seconds old, and a date does not go
 * stale in sixty seconds while "closes in 1 minute" does.
 */
export interface Collection {
  readonly id: string;
  readonly slug: string;
  /** One of `CollectionKind`, widened. See the type comment. */
  readonly kind: string;
  /** In the reader's language, already resolved by the service. Never empty. */
  readonly title: string;
  /** The standfirst, or `null` for a collection whose curator wrote none. */
  readonly description: string | null;
  readonly image: CollectionImage | null;
  /** Whether membership is an editorial badge — §3.2, §4.4. */
  readonly grantsBadge: boolean;
  /** Publicly visible campaigns only; a suspended one a curator chose is not counted. */
  readonly projectCount: number;
  /** ISO-8601 instant, or `null` for a standing list. */
  readonly opensAt: string | null;
  /** ISO-8601 instant, or `null` for one that does not expire. */
  readonly closesAt: string | null;
}

/* -------------------------------------------------------------------------
 * The URLs — §4.13 WS-04
 * ---------------------------------------------------------------------- */

/** The index every collection landing page hangs from. */
export const COLLECTIONS_PATH = '/collections';

/**
 * A collection's landing page. The slug is encoded: it is data a curator typed, and a slug
 * editable without a deployment is a slug that can acquire a character somebody did not expect.
 */
export function collectionPath(slug: string): string {
  return `${COLLECTIONS_PATH}/${encodeURIComponent(slug)}`;
}

/* -------------------------------------------------------------------------
 * Paging
 * ---------------------------------------------------------------------- */

export interface CollectionPageQuery {
  /** The opaque keyset token from the previous page. Absent for the first. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

/**
 * The service's own parameter names for a page request.
 *
 * `limit` is a string because the service binds it as one: `CollectionController` parses it
 * itself, so a value that is not a number is refused through the feed's problem detail rather
 * than by Spring's binder — and the generated contract types it that way.
 *
 * @param defaultLimit the page size when `page.limit` is absent — the feed's `PAGE_SIZE`
 */
export function collectionQueryParams(
  page: CollectionPageQuery,
  defaultLimit: number,
): { cursor?: string; limit: string } {
  const cursor = page.cursor;
  return {
    ...(cursor == null || cursor === '' ? {} : { cursor }),
    limit: String(page.limit ?? defaultLimit),
  };
}

/* -------------------------------------------------------------------------
 * Reading the wire
 * ---------------------------------------------------------------------- */

/** A collection as the wire really is: every field optional, because nulls are omitted. */
export interface WireCollection {
  id?: string | null;
  slug?: string | null;
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  image?: { url?: string | null; width?: number | null; height?: number | null } | null;
  grantsBadge?: boolean | null;
  projectCount?: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
}

/**
 * One wire collection, narrowed to what a screen renders — or `null` when it cannot be rendered.
 *
 * <h2>A row with no slug or no title is dropped rather than defaulted</h2>
 *
 * Without a slug a collection has **no address at all**, so a card for it would be a link to
 * `/collections/` — an entry in an index that navigates nowhere. Without a title there is nothing
 * to call it; the slug is a curator's internal handle rather than a name in the reader's
 * language. Neither can happen against the service as it stands; this is the gate that keeps a
 * future contract change from putting a dead link in the index.
 *
 * The cover is dropped whole when any of its three fields is missing. A frame reserves its box
 * from a ratio, and a collection with no cover is a real and ordinary state that renders as the
 * reserved surface.
 */
export function collectionFrom(raw: WireCollection): Collection | null {
  const slug = raw.slug ?? '';
  const title = raw.title ?? '';
  if (slug === '' || title === '') return null;

  const image = raw.image;
  const usableImage =
    image != null &&
    image.url != null &&
    image.url !== '' &&
    image.width != null &&
    image.height != null
      ? { url: image.url, width: image.width, height: image.height }
      : null;

  return {
    id: raw.id ?? slug,
    slug,
    kind: raw.kind ?? '',
    title,
    description: raw.description ?? null,
    image: usableImage,
    grantsBadge: raw.grantsBadge ?? false,
    projectCount: raw.projectCount ?? 0,
    opensAt: raw.opensAt ?? null,
    closesAt: raw.closesAt ?? null,
  };
}

/** Every collection in a wire index that can be rendered, in the order the curator set. */
export function collectionsFrom(raw: readonly WireCollection[]): readonly Collection[] {
  return raw
    .map(collectionFrom)
    .filter((collection): collection is Collection => collection !== null);
}

/** §4.3's Programmes: the one kind a campaign applies to rather than merely appears in. */
export function isOpenCall(collection: Collection): boolean {
  return collection.kind === 'open_call';
}

/* -------------------------------------------------------------------------
 * The window
 * ---------------------------------------------------------------------- */

/** The two terms a collection's window is stated with. */
export interface WindowCopy {
  readonly closes: string;
  readonly openSince: string;
}

/** One end of a collection's window: what it is called, when it is, and the machine form. */
export interface WindowFact {
  /** "Open since", "Closes". Read as the first half of a sentence. */
  readonly term: string;
  /** The ISO-8601 instant. */
  readonly iso: string;
  /** The same instant for a reader. */
  readonly date: string;
}

/**
 * The options every client formats a window date with: a date and not a time, in **UTC**.
 *
 * A collection's window is a period measured in weeks, and a closing time of "20:59" invites a
 * reader to work out a timezone that the date alone does not raise. UTC, stated as a plain
 * long date, is the honest shape — and it is why a window closing at 23:30 UTC on the 31st reads
 * "31" on a phone in Baku, where it is already the 1st.
 */
export const WINDOW_DATE_OPTIONS: Intl.DateTimeFormatOptions = Object.freeze({
  dateStyle: 'long',
  timeZone: 'UTC',
});

/**
 * What a collection's window says, in the order a reader needs it.
 *
 * **CLOSING FIRST WHEN THERE IS A CLOSE.** For an open call the deadline is the whole of the
 * decision, and everything else is context for it. The opening is stated after it, and only when
 * there is one: a standing staff selection has neither.
 *
 * An unparseable instant is dropped rather than shown — `format` answers `null` for it.
 *
 * @param format the client's own formatter for {@link WINDOW_DATE_OPTIONS}, `null` for a value
 *     that is not a date
 */
export function windowFacts(
  collection: Pick<Collection, 'opensAt' | 'closesAt'>,
  copy: WindowCopy,
  format: (iso: string) => string | null,
): readonly WindowFact[] {
  const facts: WindowFact[] = [];

  const closes = collection.closesAt;
  if (closes !== null) {
    const date = format(closes);
    if (date !== null) facts.push({ term: copy.closes, iso: closes, date });
  }

  const opens = collection.opensAt;
  if (opens !== null) {
    const date = format(opens);
    if (date !== null) facts.push({ term: copy.openSince, iso: opens, date });
  }

  return facts;
}
