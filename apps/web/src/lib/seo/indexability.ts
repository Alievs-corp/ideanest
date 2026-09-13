import type { ProjectState } from '../projects/api';

/**
 * WHETHER A CAMPAIGN MAY BE INDEXED — ONE PREDICATE, ONE FILE.
 *
 * The sitemap and the project page's own `robots` meta tag are two statements
 * about the same thing, and they have to agree: a page that says `noindex` while
 * the sitemap advertises it is a page a crawler is invited to and then turned
 * away from, and a page that is indexable but absent from the sitemap is a page
 * nobody finds. So the decision is made once, here, and both read it.
 *
 * The table below is derived from `docs/architecture.md` §6.1 — the sixteen
 * project states — and from §4.3, which says which of them discovery may return.
 * The service states the same split independently in
 * `az.ideanest.discovery.domain.DiscoveryStatus`: nine `PUBLIC_STATES` and seven
 * `HIDDEN_STATES`. Nothing here is guessed, and nothing here is a copy of the
 * transition table; it is a copy of the visibility rule only.
 *
 * THREE ANSWERS, NOT TWO. "Public" and "indexable" are different questions, and
 * collapsing them is how a cancelled campaign ends up either unreachable by a
 * backer who has the link or permanently in a search result.
 */
export type Indexability =
  /** Public, moderated, and worth a crawler's time. Goes in the sitemap. */
  | 'INDEXABLE'
  /** Publicly reachable, deliberately not indexed. Reachable by link only. */
  | 'PUBLIC_NOT_INDEXABLE'
  /** Not public at all. The service answers 404 to anyone but the creator. */
  | 'NOT_PUBLIC';

/**
 * Every state of §6.1, with the reason for its answer.
 *
 * `Record<ProjectState, …>` rather than a partial map: a seventeenth state added
 * to §6.1 is a type error here rather than a campaign that quietly defaults to
 * indexable. `ProjectState` itself is imported rather than restated — one copy
 * of the sixteen names, in `lib/projects/api.ts`.
 */
export const PROJECT_STATE_INDEXABILITY: Readonly<Record<ProjectState, Indexability>> = {
  /* The seven discovery never returns under any filter or sort (§4.3). The
   * public project page does not exist for them, so an indexed URL would be a
   * 404 at best and somebody's unfinished work at worst. */
  DRAFT: 'NOT_PUBLIC',
  SUBMITTED: 'NOT_PUBLIC',
  CHANGES_REQUESTED: 'NOT_PUBLIC',
  REJECTED: 'NOT_PUBLIC',
  APPROVED: 'NOT_PUBLIC',
  SCHEDULED: 'NOT_PUBLIC',
  SUSPENDED: 'NOT_PUBLIC',

  /* Public, and deliberately not indexed.
   *
   * PRELAUNCH is a teaser. `GET /v1/projects/{id}/prelaunch` is `permitAll` and
   * discovery lists it as "upcoming", so it is not a secret — but the campaign
   * has taken the `DRAFT → PRELAUNCH` edge without passing moderation (§6.1),
   * the page carries a title, a cover and a follower count and nothing else
   * (§10.2), and it lives at an id-based URL that stops existing the moment the
   * campaign opens. Indexing an unmoderated, short-lived page is how §5.4's
   * prohibited content becomes a search result.
   *
   * CANCELED is a campaign the creator withdrew. Its page stays reachable for
   * the backers who have the link — §4.3 keeps it publicly visible on purpose —
   * but it belongs to no discovery grouping and there is nothing left to back.
   * A permanent search result for a withdrawn campaign is a dead end that
   * outranks the live campaigns beside it. */
  PRELAUNCH: 'PUBLIC_NOT_INDEXABLE',
  CANCELED: 'PUBLIC_NOT_INDEXABLE',

  /* Public, moderated, and stable. The canonical project page of §4.4 exists
   * for each, and it is the page a backer is looking for. */
  LIVE: 'INDEXABLE',
  CLOSING_WINDOW: 'INDEXABLE',
  EXTENDED: 'INDEXABLE',
  WITHDRAWN: 'INDEXABLE',
  LATE_PLEDGE: 'INDEXABLE',
  SUCCESSFUL: 'INDEXABLE',
  COLLECTING: 'INDEXABLE',
  FULFILLING: 'INDEXABLE',
  COMPLETED: 'INDEXABLE',
  UNSUCCESSFUL: 'INDEXABLE',
};

function statesWith(answer: Indexability): readonly ProjectState[] {
  return Object.freeze(
    (Object.keys(PROJECT_STATE_INDEXABILITY) as ProjectState[]).filter(
      (state) => PROJECT_STATE_INDEXABILITY[state] === answer,
    ),
  );
}

/** The seven states that must never appear on any public surface (§4.3). */
export const HIDDEN_PROJECT_STATES: readonly ProjectState[] = statesWith('NOT_PUBLIC');

/** The states whose project page belongs in the sitemap. */
export const INDEXABLE_PROJECT_STATES: readonly ProjectState[] = statesWith('INDEXABLE');

/**
 * The answer for a state read off the wire.
 *
 * FAILS CLOSED. `state` arrives as a string on `ProjectCard`, so a state this
 * build has never heard of — a deployment ahead of this one, a typo, an empty
 * field — is treated as not public. The alternative is a default that indexes
 * whatever it does not recognise, and the thing it would not recognise first is
 * a new pre-publication state.
 */
export function projectStateIndexability(state: string): Indexability {
  return (
    PROJECT_STATE_INDEXABILITY[state as ProjectState] ??
    /* Not in the table. */ ('NOT_PUBLIC' satisfies Indexability)
  );
}

/** The predicate the sitemap filters on. */
export function isIndexableProjectState(state: string): boolean {
  return projectStateIndexability(state) === 'INDEXABLE';
}

/**
 * The same decision as a `robots` meta directive, for the project page itself.
 *
 * `follow` stays true even when `index` is false. A withdrawn or pre-launch
 * campaign still links to its creator, its category and the feed, and those
 * pages are indexable — `nofollow` would throw away the one useful thing an
 * unindexed page does.
 *
 * **Rendered since #119**, by `app/projects/[id]/[projectSlug]/page.tsx`. It lives
 * here rather than in that page so that the page and the sitemap filter on one
 * predicate: a campaign that is in the sitemap and `noindex` on its own page, or
 * the reverse, is a contradiction a crawler resolves by trusting neither.
 */
export function projectPageRobots(state: string): { index: boolean; follow: boolean } {
  return { index: isIndexableProjectState(state), follow: true };
}

/**
 * The surfaces a crawler must never index, as robots.txt path patterns.
 *
 * Not derived from the routes that exist today, and that is deliberate: a
 * private surface has to be disallowed on the deploy that *introduces* it, and
 * a robots.txt updated afterwards is updated too late. The creator dashboard
 * (§4.7), the pledge manager (§4.8) and administration (§4.11) are named in the
 * specification and not built, and are listed here anyway.
 *
 * `*` is the wildcard Google and Bing both honour. There is no `Disallow: /`
 * anywhere in this list — see the `robots.ts` route for the allow rule that
 * frames it.
 */
export const PRIVATE_PATH_PREFIXES: readonly string[] = Object.freeze([
  // The pledge flow. Money, a five-minute reservation, and nothing to index
  // (§4.5). Its URL is also the one place a crawler could start a checkout.
  '/projects/*/back',

  // The campaign editor: somebody's unpublished work (§4.6).
  '/projects/new',
  '/projects/*/edit',

  // The pre-launch teaser. Public, deliberately not indexed — see
  // `PROJECT_STATE_INDEXABILITY` above for why.
  '/projects/*/prelaunch',

  // The account, its settings, and its sessions (§4.1, §4.2).
  '/settings',
  '/account',

  // The creator dashboard (§4.7) and the pledge manager (§4.8).
  '/dashboard',
  '/pledges',

  // Administration (§4.11).
  '/admin',

  // Sign-in and the token flows. Nothing here has content, and every URL is
  // single use.
  //
  // `/auth` was named before the screens existed and is kept — it is the prefix the mobile
  // application's deep links use, and removing it would quietly re-open whatever lands there.
  // The three paths below it are the routes #268 to #270 actually built, in `app/(auth)`:
  // there is nothing on them to index, and `/verify-email` carries a single-use credential in
  // its query string, which is the one thing that must never reach an index.
  '/auth',
  '/sign-in',
  '/register',
  '/verify-email',

  // #271 and #277's landing pages, on the same terms and for the sharper half of the same
  // reason. `/reset-password` itself has nothing to index; `/reset-password/confirm` and
  // `/confirm-email-change` each carry a single-use credential in the query string, and the
  // first of the two sets a password rather than merely proving an address.
  '/reset-password',
  '/confirm-email-change',

  // The API, which this application proxies under its own origin so that the
  // refresh cookie can be `SameSite=Strict` (see `next.config.mjs`). It serves
  // JSON, it is rate limited, and a crawler walking it is spending the budget
  // that should have gone on pages.
  '/v1/',

  // Every filtered permutation of the feed. §4.3's filters are query
  // parameters, they combine, and several are comma-separated lists — so the
  // number of URLs describing one set of campaigns is combinatorial, and each
  // one is a crawl budget spent on a page that already exists. `/discover`
  // itself, with no query, stays allowed and is in the sitemap.
  //
  // This includes `?q=`: a search-results page is generated by whoever types in
  // the box, which is an unbounded set of URLs with no content of its own.
  '/discover?',

  // WS-06's dedicated results route, for exactly the sentence above. It is a different
  // endpoint from the feed and it has the same property: the URL space is written by whoever
  // types in the box. The bare `/search` is disallowed with it rather than carved out —
  // it holds a form and no content, so an index entry for it would be an index entry for an
  // empty page.
  '/search',
]);
