import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import type { WindowCopy } from '../i18n/collection-copy';
import { publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { PAGE_SIZE, type ProjectCard } from '../discovery/api';

/**
 * §4.3's D-08 — curated collections and open calls, as `GET /v1/collections` and
 * `GET /v1/collections/{slug}` send them (`CollectionController`, `CollectionResponses`).
 *
 * ONE MODULE, ONE PLACE, the rule `lib/categories/api.ts` and `lib/discovery/api.ts` already
 * state. The shapes come from the controller; nothing here invents a field.
 *
 * <h2>A collection that is not visible is ABSENT, and the client must not decorate that</h2>
 *
 * The service answers **404** for a slug that names nothing, for a collection that has not
 * been published, and for one outside its own window. Three different facts, one answer,
 * deliberately — `CollectionController` gives the argument in full: which campaigns the
 * platform is about to put its name behind, and by implication which it passed over, is a
 * commercially interesting fact about its plans, and a 403 would confirm that
 * `/collections/spring-2027` exists to anybody who guesses the slug.
 *
 * So nothing in this module distinguishes them, nothing renders "this collection is not open
 * yet", and the page renders the ordinary not-found route for all three. `lib/profiles/api.ts`
 * holds the same line for a private profile and explains why a client that tried to be
 * helpful here would be an oracle built on top of an endpoint designed not to be one.
 *
 * <h2>The cards are the discovery feed's cards, and deliberately the same type</h2>
 *
 * `CollectionResponses.page` maps every member through `DiscoveryResponses::card`, so a
 * collection's items are byte for byte the shape `/v1/discover` answers with. Importing
 * `ProjectCard` rather than restating it is what lets `CampaignGrid` render a collection with
 * the card the feed already argues about — the badge, the lime urgency pill, the progress
 * figure read with `decimal.js` — instead of a second card for the same JSON.
 *
 * <h2>Null fields are absent, not null</h2>
 *
 * The service serialises with `default-property-inclusion: non_null`, so a collection with no
 * standfirst has no `description` key at all and the last page has no `nextCursor` key. The
 * wire types below say so; the types a component sees say `T | null`, because a page renders
 * "there is no cover" and never "the field I expected is missing".
 */

/* -------------------------------------------------------------------------
 * What a collection is
 * ---------------------------------------------------------------------- */

/** `CollectionKind`'s three wire values — lower case with underscores, like every other
 *  closed vocabulary this module publishes. */
export type CollectionKind = 'staff_selection' | 'themed' | 'open_call';

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
 * WIDENED ON PURPOSE, the same decision `ProjectCard.state` takes. §4.3 may grow a fourth
 * kind, and a service that starts sending it must not be able to make this application throw
 * or render nothing: a page that meets an unfamiliar kind prints the collection without a
 * kind label, which is a page. `kindLabel` is the one place that narrows, and it answers
 * `null` rather than guessing.
 *
 * <h2>The window is two instants, and a visible collection is always inside it</h2>
 *
 * `PostgresCuratedCollections` selects on `opens_at IS NULL OR opens_at <= now()` and
 * `closes_at IS NULL OR closes_at > now()`, so anything a reader can reach opened in the past
 * and closes in the future. That is what makes "Closes 12 September" honest without this
 * module having to compare against a clock — and it is also why `windowFacts` states the
 * dates rather than a countdown: a response may be sixty seconds old (the endpoint is cached
 * for that long), and a date does not go stale in sixty seconds while "closes in 1 minute"
 * does.
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

/** `GET /v1/collections/{slug}` — the landing page's collection and its first page of cards. */
export interface CollectionLanding {
  readonly collection: Collection;
  /** In the curator's order. */
  readonly items: readonly ProjectCard[];
  /**
   * `null` on the last page. A SHORT PAGE IS NOT THE END OF THE LIST — only the absence of
   * this is, and a client that stopped on a short page would truncate a collection whose last
   * page happened to be full.
   */
  readonly nextCursor: string | null;
}

/** One further page of a collection's campaigns, as the browser asks for it. */
export interface CollectionCampaignPage {
  readonly items: readonly ProjectCard[];
  readonly nextCursor: string | null;
}

/* -------------------------------------------------------------------------
 * The URLs — §4.13 WS-04 and WS-05
 * ---------------------------------------------------------------------- */

/** The index every collection landing page hangs from, and the crawl path to them. */
export const COLLECTIONS_PATH = '/collections';

/**
 * A collection's landing page.
 *
 * `/collections/{slug}` rather than a filter on the feed, and that is the whole point of the
 * route. `?programme={slug}` on `/v1/discover` narrows to an `OPEN_CALL` collection and the
 * web feed does not expose it — `@ideanest/discovery/filters` has nine filters and that is not
 * one of them — but even if it did, robots.txt disallows `/discover?` wholesale
 * (`lib/seo/indexability.ts`), so the only URL that reached a collection would be one no
 * crawler is allowed to fetch. And a filter cannot reproduce **the curator's order**, which
 * is the one thing a curated list is.
 *
 * The slug is encoded: it is data a curator typed, and a slug editable without a deployment
 * is a slug that can acquire a character somebody did not expect.
 */
export function collectionPath(slug: string): string {
  return `${COLLECTIONS_PATH}/${encodeURIComponent(slug)}`;
}

/* -------------------------------------------------------------------------
 * Paging
 * ---------------------------------------------------------------------- */

/**
 * How many cards a page of a collection carries.
 *
 * **Discovery's, deliberately.** `CollectionController.limitOf` defaults to
 * `DiscoveryQuery.DEFAULT_LIMIT` and clamps to the same bounds, so the two surfaces already
 * agree on the server; restating a different number here would be this application disagreeing
 * with itself about how long a page is, on two grids that look identical.
 */
export { PAGE_SIZE };

export interface CollectionPageQuery {
  /** The opaque keyset token from the previous page. Absent for the first. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

/**
 * The service's own parameter names for a page request, as an object.
 *
 * <h2>Why an object rather than a query string</h2>
 *
 * `lib/discovery/api.ts` builds a string because the discovery filters live in the address
 * bar and the string the browser sends must be the string the server render sends. Nothing
 * about a collection is in the address bar — the cursor is a position in somebody's scroll,
 * not a fact about the page — so there is no second serialisation to keep honest, and an
 * object is what the generated client actually takes.
 *
 * `limit` is a string because the service binds it as one: `CollectionController` parses it
 * itself so that a value that is not a number is refused through the feed's problem detail
 * rather than by Spring's binder.
 */
export function collectionQueryParams(page: CollectionPageQuery = {}): {
  cursor?: string;
  limit?: string;
} {
  const cursor = page.cursor;
  return {
    ...(cursor == null || cursor === '' ? {} : { cursor }),
    limit: String(page.limit ?? PAGE_SIZE),
  };
}

/** The same parameters as a query string, for the browser's own `fetch`. */
export function collectionQuery(page: CollectionPageQuery = {}): string {
  return new URLSearchParams(collectionQueryParams(page)).toString();
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
 * One wire collection, narrowed to what a page renders — or `null` when it cannot be rendered.
 *
 * <h2>A row with no slug or no title is dropped rather than defaulted</h2>
 *
 * `fetchCategories` fills a missing name with the slug, and that is right there: a category
 * without a translation still has an address and a page worth reaching. A collection is
 * different in both halves. Without a slug it has **no URL at all**, so a card for it would be
 * a link to `/collections/` — an entry in an index that navigates nowhere, and one a crawler
 * would follow. Without a title there is nothing to call it; the slug is a curator's internal
 * handle rather than a name in the reader's language, and printing `spring-2027-open-call` as
 * a heading is worse than not listing the collection at all.
 *
 * Neither can happen against the service as it stands — `CollectionResponses.Collection` fills
 * both from non-null columns. This is the gate that keeps a future contract change from
 * putting a dead link in the site's own crawl path.
 *
 * The cover is dropped whole when any of its three fields is missing. `MediaFrame` reserves a
 * box from a ratio, and a width or height of zero is a division nobody wants; a collection
 * with no cover is a real and ordinary state that renders as the reserved surface.
 */
export function collectionFrom(raw: WireCollection): Collection | null {
  const slug = raw.slug ?? '';
  const title = raw.title ?? '';
  if (slug === '' || title === '') return null;

  const image = raw.image;
  const usableImage =
    image != null && image.url != null && image.url !== '' && image.width != null && image.height != null
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

/* -------------------------------------------------------------------------
 * What a kind means to a reader
 * ---------------------------------------------------------------------- */

/**
 * The three kinds, in words.
 *
 * **The label is not decoration; it is the only thing that says what the list is.** A staff
 * selection is what the platform stands behind, a themed collection is a season or a subject,
 * and an open call is a programme with a window a campaign can still be part of — and a reader
 * deciding whether to apply needs to know which one they are looking at before they read the
 * standfirst. docs/ui-kit.md §9.2 forbids colour alone from carrying meaning, so the kind is a
 * word on every surface that shows it, with an icon beside it and never instead of it.
 *
 * `null` for a kind this build does not know, which is the point of `Collection.kind` being
 * widened: an unfamiliar kind costs a label, never a page.
 */
/*
 * THE KIND'S NAME AND THE COUNT MOVED TO THE CATALOGUE — issue #324.
 *
 * `KIND_LABELS`, `kindLabel` and `campaignCount` were three English constants in this module,
 * and `campaignCount` carried the singular/plural split that is the whole of English and none
 * of Russian. They are `discovery.collections.kinds` and `discovery.collections.count` now, and
 * `lib/i18n/collection-copy.ts` builds them into the objects the two surfaces already take.
 *
 * A kind the service returns that this build does not know still renders no tag rather than a
 * raw `open_call`, which is what `kindLabel` returning `null` bought: the lookup is on the
 * copy's own table and misses the same way.
 */

/** §4.3's Programmes: the one kind a campaign applies to rather than merely appears in. */
export function isOpenCall(collection: Collection): boolean {
  return collection.kind === 'open_call';
}

/* -------------------------------------------------------------------------
 * The window
 * ---------------------------------------------------------------------- */

/**
 * A DATE AND NOT A TIME. `lib/time.ts` prints an exact timestamp for a session or a
 * notification, where the minute is the fact somebody is checking. A collection's window is a
 * period measured in weeks, and a closing time of "20:59" invites a reader to work out a
 * timezone that the date alone does not raise. UTC, stated as a plain date, is the honest
 * shape.
 *
 * <p>The language was pinned to `en-GB` with a note pointing at §21.1's routing; that landed
 * with #123, so the reader's own language is what this is built in now.
 */

/** One end of a collection's window: what it is called, when it is, and the machine form. */
export interface WindowFact {
  /** "Open since", "Closes". Read as the first half of a sentence. */
  readonly term: string;
  /** The ISO-8601 instant, for `<time datetime>`. */
  readonly iso: string;
  /** The same instant for a reader. */
  readonly date: string;
}

/** An instant a reader can be shown, or `null` when the value is not a date at all. */
export function formatWindowDate(iso: string, locale: Locale): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : dateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }, 'window').format(at);
}

/**
 * What a collection's window says, in the order a reader needs it.
 *
 * **CLOSING FIRST WHEN THERE IS A CLOSE.** For an open call the deadline is the whole of the
 * decision — a programme somebody might submit to closes on a date, and everything else on the
 * card is context for that. The opening is stated after it, and only when there is one: a
 * standing staff selection has neither, and printing "Opened —" for it would be a field
 * rendered because it exists rather than because it says anything.
 *
 * An unparseable instant is dropped rather than shown. `Invalid Date` in a `<time>` element is
 * a machine-readable statement that is wrong, which is worse than the absence of one.
 */
export function windowFacts(
  collection: Collection,
  locale: Locale,
  copy: WindowCopy,
): readonly WindowFact[] {
  const facts: WindowFact[] = [];

  const closes = collection.closesAt;
  if (closes !== null) {
    const date = formatWindowDate(closes, locale);
    if (date !== null) facts.push({ term: copy.closes, iso: closes, date });
  }

  const opens = collection.opensAt;
  if (opens !== null) {
    const date = formatWindowDate(opens, locale);
    if (date !== null) facts.push({ term: copy.openSince, iso: opens, date });
  }

  return facts;
}

/*
 * `WindowCopy` is declared in `lib/i18n/collection-copy.ts` since #324 and re-exported here.
 * It was defined in this module when it was the only piece of collection copy that had moved;
 * the rest followed, and one file holding the shape of what a route resolves is what keeps the
 * builder and the consumer from drifting.
 */
export type { WindowCopy } from '../i18n/collection-copy';

/* -------------------------------------------------------------------------
 * Reading from the browser
 * ---------------------------------------------------------------------- */

interface WireCollectionPage {
  collection?: WireCollection | null;
  items?: readonly ProjectCard[] | null;
  nextCursor?: string | null;
}

/**
 * A further page of a collection's campaigns — `GET /v1/collections/{slug}?cursor=`.
 *
 * **THE FIRST PAGE IS NEVER ASKED FOR HERE.** `app/(site)/collections/[slug]/page.tsx` already
 * fetched it on the server so that the campaigns are in the HTML a crawler and a slow
 * connection receive; a browser that requested it again would be spending a round trip to
 * replace content that is already on screen. `CollectionCampaigns` holds the seed and only
 * ever asks for what comes after it — the argument `ProfileCampaignGrid` makes for the same
 * arrangement on a profile.
 *
 * **The collection itself is not returned.** The response carries it on every page, and it is
 * the same collection the server already rendered a header from; handing it back would invite
 * a caller to re-render a heading half way down a scroll.
 *
 * `publicFetch`, NOT `authorizedFetch`. The endpoint is `permitAll` and a collection page is a
 * front door — `authorizedFetch` throws when there is no token, which would make "show me more
 * of this programme" mean "sign in first".
 */
export async function getCollectionCampaigns(
  slug: string,
  cursor: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollectionCampaignPage> {
  const query = collectionQuery({ cursor });
  const response = await publicFetch(`/v1/collections/${encodeURIComponent(slug)}?${query}`, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as WireCollectionPage;
  return {
    items: body.items ?? [],
    nextCursor: body.nextCursor ?? null,
  };
}

export type { ProjectCard };
