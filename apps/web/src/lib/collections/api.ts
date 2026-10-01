import {
  collectionQueryParams as sharedQueryParams,
  windowFacts as sharedWindowFacts,
  WINDOW_DATE_OPTIONS,
  type Collection,
  type CollectionPageQuery,
  type WindowCopy,
  type WindowFact,
  type WireCollection,
} from '@ideanest/discovery/collections';
import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import { publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { PAGE_SIZE, type ProjectCard } from '../discovery/api';

/**
 * §4.3's D-08 — curated collections and open calls, as `GET /v1/collections` and
 * `GET /v1/collections/{slug}` send them (`CollectionController`, `CollectionResponses`).
 *
 * The shapes, the wire narrowing, the paths, the kinds and the window's order live in
 * `@ideanest/discovery/collections` since the app's collection screens (#154) needed the same
 * answers; the package's header gives the arguments (a hidden collection is absent, nulls are
 * omitted). This module re-exports them under the names the web has always imported, and keeps
 * what is the browser's own: the date formatter, the query string, and the paging fetch.
 *
 * <h2>The cards are the discovery feed's cards, and deliberately the same type</h2>
 *
 * `CollectionResponses.page` maps every member through `DiscoveryResponses::card`, so a
 * collection's items are byte for byte the shape `/v1/discover` answers with. Importing
 * `ProjectCard` rather than restating it is what lets `CampaignGrid` render a collection with
 * the card the feed already argues about — the badge, the lime urgency pill, the progress
 * figure read with `decimal.js` — instead of a second card for the same JSON.
 */

export {
  COLLECTIONS_PATH,
  collectionFrom,
  collectionPath,
  collectionsFrom,
  isOpenCall,
  type Collection,
  type CollectionImage,
  type CollectionKind,
  type CollectionPageQuery,
  type WindowFact,
  type WireCollection,
} from '@ideanest/discovery/collections';

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

/** The service's own parameter names for a page request, `limit` as a string — the package's. */
export function collectionQueryParams(page: CollectionPageQuery = {}): {
  cursor?: string;
  limit?: string;
} {
  return sharedQueryParams(page, PAGE_SIZE);
}

/** The same parameters as a query string, for the browser's own `fetch`. */
export function collectionQuery(page: CollectionPageQuery = {}): string {
  return new URLSearchParams(collectionQueryParams(page)).toString();
}

/* -------------------------------------------------------------------------
 * The window
 * ---------------------------------------------------------------------- */

/**
 * An instant a reader can be shown, or `null` when the value is not a date at all. A long date
 * in UTC, in the reader's language — `WINDOW_DATE_OPTIONS` says why.
 */
export function formatWindowDate(iso: string, locale: Locale): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : dateTimeFormat(locale, WINDOW_DATE_OPTIONS, 'window').format(at);
}

/**
 * What a collection's window says, closing first, with unparseable instants dropped — the
 * package's `windowFacts` with the browser's formatter.
 */
export function windowFacts(
  collection: Collection,
  locale: Locale,
  copy: WindowCopy,
): readonly WindowFact[] {
  return sharedWindowFacts(collection, copy, (iso) => formatWindowDate(iso, locale));
}

/*
 * `WindowCopy` is declared in `@ideanest/discovery/collections` since #154 and re-exported here
 * and from `lib/i18n/collection-copy.ts`, so the builder and both consumers read one shape.
 */
export type { WindowCopy };

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
