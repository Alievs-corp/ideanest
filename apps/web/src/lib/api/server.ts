import { getLocale } from 'next-intl/server';
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type components,
  type paths,
} from '@ideanest/api-client';
import type { ExchangeRate } from '@ideanest/money';
import type { Category } from '../categories/api';
import {
  collectionFrom,
  collectionQueryParams,
  collectionsFrom,
  type Collection,
  type CollectionLanding,
  type CollectionPageQuery,
} from '../collections/api';
import type { DiscoveryFeed, ProjectCard } from '../discovery/api';
import type { Plan } from '../plans/api';
import { DEFAULT_LOCALE } from '../i18n/locale';
import { LEGAL_UNAVAILABLE, LEGAL_UNPUBLISHED, type LegalRead } from '../legal/api';
import {
  COLLECTIONS,
  DISCOVERY,
  LEGAL,
  PLANS,
  TAXONOMY,
  campaignAddress,
  collection as collectionTag,
  project,
} from '../cache/tags';
import type { EnvSource } from '../seo/metadata';
import { apiOrigin } from '../seo/metadata-source';

/**
 * Reads the service makes on the server, for the pages #119 renders there.
 *
 * <h2>Why this is not `lib/api/client.ts`</h2>
 *
 * That module talks to `/v1` as a RELATIVE path, and that is deliberate: in a browser the
 * request is same-origin because `next.config.mjs` rewrites `/v1` to the service, which is
 * the only arrangement in which a `SameSite=Strict` refresh cookie travels at all.
 *
 * A relative path has no meaning inside a Server Component. There is no document, no
 * origin, and no rewrite — the rewrite is a property of the HTTP server this code runs
 * *in*, not of `fetch` — so the call that works in the browser throws `Failed to parse
 * URL` on the server. Server reads therefore go straight to `IDEANEST_API_ORIGIN`, which
 * `apiOrigin` reads from the same variable the rewrite does.
 *
 * <h2>Anonymous, and that is a decision rather than a limitation</h2>
 *
 * Nothing here sends a token. The pages that use it are public — a campaign page and the
 * discovery feed — and a server render that varied by session would be a page that cannot
 * be cached by anything, shared by anybody, or served to the crawler #119 exists for. A
 * signed-in visitor's personal additions to those pages (whether they have saved a
 * campaign, whether they have backed it) belong to a client component that fetches them
 * after hydration, because those are the parts that must not be in a shared cache.
 *
 * <h2>Failure is `null`, never a thrown page</h2>
 *
 * Every reader below answers `null` when the service refuses or cannot be reached. A
 * Server Component that throws takes the whole route to an error page, and the difference
 * between "this campaign does not exist" and "the API is restarting" is the difference
 * between a 404 and a 500 — decided at the call site, where the page knows which it wants.
 */

/** The campaign page's projection, as the published contract describes it. */
export type ProjectPageResponse = components['schemas']['ProjectPageResponse'];

/** The public reward list, likewise. */
export type PublicRewardListResponse = components['schemas']['PublicRewardListResponse'];

export interface ServerReadOptions {
  /** Injected in tests. Defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly env?: EnvSource;
  /** §10.3's localisation header. Decides the taxonomy names a campaign page shows. */
  readonly locale?: string;
  /** Overrides the shared window below. Per call, because a caller may know better. */
  readonly revalidateSeconds?: number;
}

/**
 * A minute, matching the `Cache-Control` the service puts on these reads.
 *
 * The service already decided how stale its own public reads may be — a campaign's pledged
 * total and the feed's ordering both move continuously, and sixty seconds is what
 * `PublicProjectController` and `DiscoveryController` chose. Holding a different opinion
 * here would mean two caches disagreeing about the same bytes, with the tighter one winning
 * by accident.
 */
const PUBLIC_READ_REVALIDATE_SECONDS = 60;

/**
 * A client bound to the service's own origin.
 *
 * Built per call rather than held in a module constant: `apiOrigin` reads `process.env`,
 * and a constant would capture the value at module evaluation — which during a Next build
 * is before the deployment's environment exists.
 */
function client(options: ServerReadOptions): ApiClient {
  const baseUrl = apiOrigin(options.env);
  return options.fetchImpl === undefined
    ? createApiClient({ baseUrl })
    : createApiClient({ baseUrl, fetch: options.fetchImpl });
}

/**
 * <h2>THE LANGUAGE IS DEFAULTED HERE NOW, AND #123 IS WHAT MADE IT FREE</h2>
 *
 * This function used to send no `Accept-Language` at all, and the paragraph here explained
 * why at length: negotiating one meant reading the locale cookie, reading a cookie makes a
 * render dynamic, and these are the cached public reads a stranger meets first. The
 * consequence was written down rather than hidden — the taxonomy names inside a cached
 * public page followed whatever language the *server's* request happened to carry, on an
 * otherwise English page, which is the asymmetry #324 was filed about.
 *
 * That argument is spent. The language is a path segment, so `/az/discover` and
 * `/ru/discover` are two cached documents rather than one document with a `Vary` on it, and
 * `getLocale()` reads the value `layout.tsx` already handed to `setRequestLocale`. No
 * cookie, no header, no variance per visitor — one fixed language per cache entry, which is
 * exactly what a shared cache wants.
 *
 * <h2>The fallback is not decoration</h2>
 *
 * `getLocale()` throws outside a request scope, and this module is read from two of them:
 * `app/sitemap.ts` and the unit tests. Neither is rendering a page for anybody, so neither
 * has a language to speak — `DEFAULT_LOCALE` is the honest answer, and the same one the
 * service's own RFC 4647 lookup would have arrived at from an absent header.
 *
 * An explicit `options.locale` still wins, because a caller inside an already-dynamic route
 * may know better.
 */
async function readOptions(options: ServerReadOptions, ...tags: readonly string[]) {
  return {
    headers: { 'accept-language': await localeFor(options) },
    /*
     * THE TAGS ARE WHAT MAKE THE WINDOW ABOVE SURVIVABLE — #127. Sixty seconds is a
     * strategy for load and not for correctness: a backer watches the total they just moved
     * sit unchanged for up to a minute on the page where the number is the point. A tag lets
     * the service name the campaign that changed, so the minute stays for everything nobody
     * touched. `lib/cache/tags.ts` holds the vocabulary and says what is deliberately not
     * invalidated.
     */
    next: {
      revalidate: options.revalidateSeconds ?? PUBLIC_READ_REVALIDATE_SECONDS,
      tags: [...tags],
    },
  };
}

async function localeFor(options: ServerReadOptions): Promise<string> {
  if (options.locale !== undefined) return options.locale;

  try {
    return await getLocale();
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The campaign at a public URL — §10.2's `GET /v1/projects/{creatorSlug}/{projectSlug}`.
 *
 * `null` for a campaign that does not exist and for one whose state is not public. The
 * service answers both with 404 for the reason `PublicProjects` gives, and they stay
 * indistinguishable here: a page that rendered "this campaign is private" would be the
 * oracle the 404 exists to prevent.
 */
export async function fetchCampaignPage(
  creatorSlug: string,
  projectSlug: string,
  options: ServerReadOptions = {},
): Promise<ProjectPageResponse | null> {
  try {
    return await client(options).get('/v1/projects/{creatorSlug}/{projectSlug}', {
      path: { creatorSlug, projectSlug },
      ...(await readOptions(options, campaignAddress(creatorSlug, projectSlug))),
    });
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * A campaign's public reward tiers — `GET /v1/projects/{id}/rewards/public`.
 *
 * A second request rather than a field on the projection, because the service keeps them
 * apart and says why: one response whose cost is decided by the longest tier list on the
 * platform, cached for as long as its least cacheable part, is worse than two.
 *
 * `null` rather than an empty list on failure. An empty list is a campaign offering nothing,
 * which is a real and different thing, and a page that could not tell them apart would print
 * "no rewards" over a service that was merely restarting.
 */
export async function fetchPublicRewards(
  projectId: string,
  options: ServerReadOptions = {},
): Promise<PublicRewardListResponse | null> {
  try {
    return await client(options).get('/v1/projects/{projectId}/rewards/public', {
      path: { projectId },
      ...(await readOptions(options, project(projectId))),
    });
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * The first page of the discovery feed — `GET /v1/discover`.
 *
 * <strong>Takes the query string the address bar already holds.</strong> `feedQuery` in
 * `lib/discovery/api.ts` is the one place that turns filters into the service's parameter
 * names, and it is what the browser sends; a second serialisation here would be a second
 * chance to spell `showOnly` differently, and the symptom would be a server render and a
 * client refetch that disagree about which campaigns match.
 *
 * The string is split back into a parameter object for the typed client, so a repeated
 * filter stays repeated — `?tag=a&tag=b` is two tags and `?tag=a,b` is one tag whose name
 * contains a comma, which is what `DiscoveryQueryBinder` reads.
 */
export async function fetchDiscoveryFeed(
  query: string,
  options: ServerReadOptions = {},
): Promise<DiscoveryFeed | null> {
  try {
    const feed = await client(options).get('/v1/discover', {
      query: parametersOf(query),
      ...(await readOptions(options, DISCOVERY)),
    });
    /*
     * Cast to the module that owns the discovery wire types. The generated schema describes
     * the same JSON, and every field of it as optional — springdoc marks a record component
     * required only when it can prove it — so a page reading `card.title` through the
     * generated type would be narrowing seventeen fields that are never absent.
     * `lib/discovery/api.ts` states the shape the client half already relies on, and one
     * statement of it is the point of that module.
     */
    return feed as unknown as DiscoveryFeed;
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * A page of search results — `GET /v1/search`, §4.13's WS-06.
 *
 * THE SAME FEED SHAPE AS `/v1/discover`, and deliberately the same reader. `SearchController`
 * answers with `DiscoveryResponses.Feed`, so the results page renders the same
 * `ProjectCard` as the feed does; a second card component for the same JSON would be two
 * places for the progress bar to be wrong.
 *
 * IT IS NOT THE SAME ENDPOINT, though, which is why this is not a parameter on the function
 * above. `/v1/search` refuses a request with no `q` (`requireQuery`), and the caller's
 * handling of that refusal — a results page with an empty search box, rather than an error —
 * belongs at the call site.
 */
export async function fetchSearchResults(
  query: string,
  options: ServerReadOptions = {},
): Promise<DiscoveryFeed | null> {
  try {
    const feed = await client(options).get('/v1/search', {
      query: parametersOf(query),
      ...(await readOptions(options, DISCOVERY)),
    });
    // Cast for the reason the discovery reader gives: `lib/discovery/api.ts` owns the wire
    // shape, and the generated schema marks every field of it optional.
    return feed as unknown as DiscoveryFeed;
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * §4.3's taxonomy — `GET /v1/categories`.
 *
 * <h2>An hour, not a minute</h2>
 *
 * Every other read in this module revalidates after sixty seconds, matching the
 * `Cache-Control` the service puts on a feed whose ordering and totals move continuously. A
 * taxonomy does not: §4.3 requires it to be editable without a deployment, which is a human
 * editing a row perhaps twice a year, and this tree is read by the header, the footer, the
 * home page and every category landing page — on every request. Sixty seconds there is a
 * request per minute per surface for an answer that has not changed since the platform
 * launched.
 *
 * An hour is the cost of an administrator waiting for a rename to appear. That is a bounded
 * and explainable wait; the alternative is the taxonomy being the most requested endpoint on
 * the platform.
 *
 * `null` on failure, like everything else here — a header whose Categories menu is empty is
 * a header, and a header that threw is a site that is down.
 */
export async function fetchCategories(options: ServerReadOptions = {}): Promise<readonly Category[] | null> {
  /*
   * The default is spread FIRST so a caller's own `revalidateSeconds` still wins. `client`
   * needs the origin and the fetch, `readOptions` the locale and the window, and both read
   * the same object rather than two that could disagree.
   */
  const withWindow: ServerReadOptions = { revalidateSeconds: TAXONOMY_REVALIDATE_SECONDS, ...options };

  try {
    const tree = await client(withWindow).get('/v1/categories', await readOptions(withWindow, TAXONOMY));
    /*
     * Narrowed to the three fields the browse pages use, rather than cast wholesale.
     * `CategoryResponse` also carries `names`, `nameAz` and `nameEn`, which the controller
     * marks interim; copying them here would spread an interim shape through every consumer
     * and make removing it a change to all of them.
     */
    return (tree as readonly RawCategory[]).map((category) => ({
      id: category.id ?? '',
      slug: category.slug ?? '',
      name: category.name ?? category.slug ?? '',
      subcategories: (category.subcategories ?? []).map((subcategory) => ({
        id: subcategory.id ?? '',
        slug: subcategory.slug ?? '',
        name: subcategory.name ?? subcategory.slug ?? '',
      })),
    }));
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/** One hour. See `fetchCategories`. */
const TAXONOMY_REVALIDATE_SECONDS = 60 * 60;

/**
 * The subscription catalogue -- `GET /v1/plans`.
 *
 * <h2>An hour, like the taxonomy and unlike everything else here</h2>
 *
 * The shared minute exists because a campaign's pledged total moves continuously. A price
 * does not: it is changed from one console screen a handful of times a year, and a minute
 * would mean re-reading the same three rows for every visitor who opens the pricing page.
 * The `PLANS` tag is what makes the hour safe -- an operator who reprices a plan invalidates
 * it rather than waiting one out.
 *
 * <h2>Read on the server, because the page is public and identical for everybody</h2>
 *
 * A price list is the same document for every reader in a language, which is exactly what a
 * shared cache wants. What is *not* the same for everybody -- whether this visitor already
 * holds a plan -- is read by `PlanChooser` after hydration, for the reason this module's
 * header gives about session-varying server renders.
 *
 * `null` on failure, like everything else here: a pricing page that could not be read is a
 * page saying so; one that threw is a site that is down.
 */
export async function fetchPlanCatalogue(
  options: ServerReadOptions = {},
): Promise<readonly Plan[] | null> {
  const withWindow: ServerReadOptions = { revalidateSeconds: TAXONOMY_REVALIDATE_SECONDS, ...options };

  try {
    const catalogue = await client(withWindow).get('/v1/plans', await readOptions(withWindow, PLANS));
    return ((catalogue as { plans?: readonly Plan[] }).plans ?? []) as readonly Plan[];
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * D-08's collections index — `GET /v1/collections`.
 *
 * <h2>Sixty seconds, unlike the taxonomy</h2>
 *
 * A collection's own copy changes about as often as a category's name does, and the read
 * still takes the shared window rather than the taxonomy's hour, because
 * `CollectionController` says why: `projectCount` moves whenever a campaign in a collection
 * is suspended or ends, so the index goes stale on events nobody edited a collection to
 * cause. Sixty seconds is also what the service puts on its own `Cache-Control`, and two
 * caches disagreeing about the same bytes is the arrangement this module exists to avoid.
 *
 * <h2>Not paged, because the endpoint is not</h2>
 *
 * §10.2 gives this endpoint no cursor and the controller caps nothing: a curated list of
 * lists is tens of rows. If that stops being true the answer is a cursor on both sides, not
 * a slice taken here — a client that quietly showed the first twenty of something it was
 * handed all of would be a client nobody can tell is truncating.
 *
 * `null` on failure, like everything else here. A collections index that could not be read is
 * a page saying so; one that threw is a site that is down.
 */
export async function fetchCollections(
  options: ServerReadOptions = {},
): Promise<readonly Collection[] | null> {
  try {
    const index = await client(options).get('/v1/collections', await readOptions(options, COLLECTIONS));
    /*
     * Narrowed through `lib/collections/api.ts` rather than cast. The generated schema marks
     * every field optional — springdoc marks a record component required only when it can
     * prove it — so a page reading `collection.title` through the generated type would be
     * narrowing ten fields that are never absent, and a collection with no slug would reach
     * the index as a link to nowhere. `collectionFrom` is the one place that decides.
     */
    return collectionsFrom(index.items ?? []);
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/**
 * One collection and a page of its campaigns — `GET /v1/collections/{slug}`.
 *
 * <h2>`null` is "there is no such page", and that is the whole contract</h2>
 *
 * The service answers **404** for a slug that names nothing, for a collection that has not
 * been published, and for one outside its window — three facts, one answer, for the reason
 * `CollectionController` argues at length: a 403 would confirm to anybody who guesses a slug
 * that the platform is preparing a collection under it. This reader keeps them
 * indistinguishable, exactly as `fetchCampaignPage` does for a campaign whose state is not
 * public, and `lib/collections/landing.ts` turns the `null` into the ordinary not-found route.
 *
 * <h2>The cards are cast, and the collection is not</h2>
 *
 * `items` is `DiscoveryResponses.Card`, the same shape `/v1/discover` answers with, so it
 * takes the same cast `fetchDiscoveryFeed` takes and for the same stated reason:
 * `lib/discovery/api.ts` owns that wire shape and the generated schema marks every field of
 * it optional. The collection itself goes through `collectionFrom`, because unlike a card it
 * has fields this application must refuse to render rather than merely trust.
 */
export async function fetchCollection(
  slug: string,
  page: CollectionPageQuery = {},
  options: ServerReadOptions = {},
): Promise<CollectionLanding | null> {
  try {
    const body = await client(options).get('/v1/collections/{slug}', {
      path: { slug },
      query: collectionQueryParams(page),
      /*
       * Both, because the landing page is two facts: the collection's own fields, which the
       * index also renders, and the campaigns in it, which staff add and remove one at a
       * time. Adding a campaign to Spring 2027 must not evict every other collection's page.
       */
      ...(await readOptions(options, COLLECTIONS, collectionTag(slug))),
    });

    const collection = body.collection === undefined ? null : collectionFrom(body.collection);
    /*
     * A 200 carrying no usable collection is treated as a 404 rather than rendered as an
     * empty page. There is no title for the heading and no address the page could claim as
     * its own, which is the same argument `resolveCategoryLanding` makes for a taxonomy that
     * could not be read: a 404 is recoverable, and a page that invents a collection is not.
     */
    if (collection === null) return null;

    return {
      collection,
      items: (body.items ?? []) as unknown as readonly ProjectCard[],
      nextCursor: body.nextCursor ?? null,
    };
  } catch (cause) {
    return refusalOrRethrow(cause);
  }
}

/** Just the fields read above, as the generated schema types them — every one optional. */
interface RawCategory {
  id?: string;
  slug?: string;
  name?: string;
  subcategories?: readonly { id?: string; slug?: string; name?: string }[];
}

/**
 * A query string as the typed client's parameter object.
 *
 * A repeated name becomes an array and a single name stays a string, because that is the
 * distinction the service draws and the one the client re-encodes.
 */
function parametersOf(query: string): Record<string, string | string[]> {
  const params = new URLSearchParams(query);
  const parameters: Record<string, string | string[]> = {};

  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    parameters[name] = values.length === 1 ? (values[0] as string) : values;
  }
  return parameters;
}

/**
 * A refusal is `null`; anything else is a bug and is allowed to surface.
 *
 * The distinction matters. A 404 or a 429 is the service answering, and a page can render
 * something sensible for it. A `TypeError` from a malformed base URL is not an answer, and
 * swallowing it would turn a misconfigured deployment into a site where every campaign has
 * quietly stopped existing — which is exactly the failure nobody notices in a staging
 * environment and everybody notices in production.
 *
 * A network-level failure is the one non-`ApiError` that must also be `null`: the service
 * being unreachable is precisely the case a public page has to survive, and `fetch` reports
 * it as a bare `TypeError` with no status to inspect. That is unsatisfying, and it is still
 * narrower than catching everything.
 */
function refusalOrRethrow(cause: unknown): null {
  if (cause instanceof ApiError || cause instanceof TypeError) return null;
  throw cause;
}

/**
 * §21.2's display currencies, and what one unit of each is worth — issue #327.
 *
 * <h2>Read on the server, and it is one of the few reads that genuinely should be</h2>
 *
 * Everything else in this module is public because the *page* is public. This is public
 * because the *answer* is: it is what a central bank published, it names nobody, and it
 * changes once a day. The service marks it `public, max-age=600`, so Next's own cache and
 * every hop in front of it may hold one copy for everybody.
 *
 * That is also why it does not go through the client. A settings screen that fetched it in
 * the browser would spend a round trip after hydration to draw a `<select>` whose options
 * were known before the first byte.
 *
 * <h2>Ten minutes, and it is the service's own figure rather than this module's</h2>
 *
 * The refresh runs hourly, so a shorter window would be requests spent to be told the same
 * number and a longer one would hide a new publication behind a cached copy of the old one.
 * `PUBLIC_READ_REVALIDATE_SECONDS` is a minute because a campaign's pledged total moves
 * continuously; a rate does not, and holding the two to one figure would be this module
 * having an opinion the service already has a better one about.
 *
 * <h2>An empty list is the answer, and null is a failure</h2>
 *
 * A deployment with the feature off, one whose source has been unreachable past its limit,
 * and one that has not refreshed yet all answer `{ base, rates: [] }` — which a caller reads
 * as "no display currency is offered" and draws nothing for. `null` is reserved for the
 * service being unreachable, which is a different fact and one a screen may want to retry.
 */
export interface ExchangeRatesResponse {
  /** The currency every rate is expressed in. Sent rather than assumed — see the endpoint. */
  readonly base: string;
  readonly rates: readonly ExchangeRate[];
}

export async function fetchExchangeRates(
  options: ServerReadOptions = {},
): Promise<ExchangeRatesResponse | null> {
  try {
    const body = await client(options).get('/v1/exchange-rates', {
      ...(await readOptions({ ...options, revalidateSeconds: options.revalidateSeconds ?? 600 })),
    });
    return {
      base: body.base ?? '',
      rates: (body.rates ?? []).flatMap((rate) =>
        rate.currency == null || rate.rate == null || rate.publishedFor == null
          ? []
          : [{ currency: rate.currency, rate: rate.rate, publishedFor: rate.publishedFor }],
      ),
    };
  } catch (cause) {
    /*
     * Every failure is the same absence here, deliberately. There is no 404 to distinguish
     * — the endpoint always answers — so anything that reaches this line is the service
     * being unreachable, and a settings screen that showed an error where a currency list
     * should be would be reporting an outage about a control the reader can simply not use
     * for a moment.
     */
    if (cause instanceof ApiError) return null;
    throw cause;
  }
}

/* -------------------------------------------------------------------------
 * §22.2's legal documents — GET /v1/legal/documents/{kind} (#425, #427, #439)
 * ---------------------------------------------------------------------- */

/**
 * One of §22.2's documents, as the published contract describes it.
 *
 * <p>The body comes with it. These are pages, and a page whose text arrived in a second
 * request would be a page that renders empty and then reflows.
 */
export type LegalDocumentResponse = components['schemas']['Document'];

/**
 * §22.2's eight, as the contract names them.
 *
 * <p>Taken from the generated path parameter rather than retyped, so a ninth document — or a
 * renamed one — is a compile error here rather than a 404 a reader meets.
 */
export type DocumentKind = NonNullable<
  paths['/v1/legal/documents/{kind}']['get']['parameters']['path']
>['kind'];

/**
 * The version of a legal document that is in force, in the reader's language.
 *
 * <h2>Read on the server, because it is the same document for everybody</h2>
 *
 * A legal document is identical for every reader in a language, which is exactly what a
 * shared cache wants, and the service says so itself: {@code LegalDocumentController} sets
 * {@code Cache-Control: public, max-age=3600}. This takes the same hour rather than the
 * shared minute, for {@link fetchPlanCatalogue}'s reason — it changes a few times a year and
 * is written by one screen — and {@link LEGAL} is the tag that makes the hour survivable.
 *
 * <h2>Why the checkout reads it at all</h2>
 *
 * §22.3 requires that the risk statement be shown inside the pledge flow, and #427 requires
 * the confirmation to say which version of the backer agreement it showed. The words on the
 * screen come from the catalogue — they are pinned by {@code wording.test.ts} in four
 * languages, which a database row could not be — and the <em>version</em> comes from here,
 * because it is the thing the server checks the confirmation against.
 *
 * <h2>Three answers, not two — issue #147</h2>
 *
 * `unpublished` is the service's 404: nothing of this kind is in force, which is a state rather
 * than a failure — until #439 seeds the words, the platform has the machinery and none of the
 * text, and both gates treat an unpublished agreement as no requirement.
 *
 * `unavailable` is every other failure: a 5xx, a timeout, the service unreachable. This read
 * used to fold those into the same `null`, so during an outage the checkout drew no risk
 * statement and offered the plain confirm label — as if no agreement were in force, when the
 * service would refuse a confirmation that acknowledged nothing the moment it came back. The
 * page now shows the failure state instead of a checkout it cannot complete honestly.
 *
 * Unlike {@link refusalOrRethrow}, a 403 or a 5xx is not an absence here: every status but 404
 * is `unavailable`. A bug — anything that is not an `ApiError`, a network `TypeError` or an
 * aborted or timed-out request — is still rethrown, for the reason that function gives.
 *
 * Only a 200 is held for the window: Next's data cache stores a `fetch` response only when its
 * status is 200, and the route is dynamic, so an unavailable answer is asked again on the next
 * request.
 */
export async function fetchLegalDocument(
  kind: DocumentKind,
  options: ServerReadOptions = {},
): Promise<LegalRead<LegalDocumentResponse>> {
  const withWindow: ServerReadOptions = { revalidateSeconds: TAXONOMY_REVALIDATE_SECONDS, ...options };

  try {
    const document = await client(withWindow).get('/v1/legal/documents/{kind}', {
      path: { kind },
      ...(await readOptions(withWindow, LEGAL)),
    });
    return { state: 'published', document };
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.status === 404 ? LEGAL_UNPUBLISHED : LEGAL_UNAVAILABLE;
    }
    if (cause instanceof TypeError || isAbort(cause)) return LEGAL_UNAVAILABLE;
    throw cause;
  }
}

/**
 * A request cancelled by its signal or by `AbortSignal.timeout`, which is not a bug.
 *
 * Read by name rather than by `instanceof`: `fetch` rejects with a `DOMException`, and whether
 * that inherits from this realm's `Error` depends on which implementation made it.
 */
function isAbort(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('name' in cause)) return false;
  return cause.name === 'AbortError' || cause.name === 'TimeoutError';
}
