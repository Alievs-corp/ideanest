/**
 * Deep links and universal links — §4.12 MB-02. **A shared campaign link opens
 * the app when installed.**
 *
 * <h2>Three ways in, one answer</h2>
 *
 * A campaign can arrive from a push notification (`ideanest://…`, the custom
 * scheme, which needs nothing from any server), from a link somebody pasted into
 * a message (`https://ideyanest.com/projects/…`, which iOS and Android only hand
 * over after they have fetched and believed the association files), or from a
 * cold start where the operating system passes the URL that launched the
 * process. All three end up here, because a link that opens a different screen
 * depending on which of the three it was is a link that gets reported as broken
 * once a month for ever.
 *
 * <h2>Why this is a pure function and not Expo Router's own parser</h2>
 *
 * Expo Router can map an incoming URL to a route by itself, but it cannot refuse:
 * its matcher will happily route a link from a host this application has nothing
 * to do with, and on Android an implicit intent from any installed application
 * can carry one. So its own handling is switched off (`app/+native-intent.tsx`)
 * and every link goes through here, checked against the host this build claims.
 * Being pure is what lets that check be tested without a simulator.
 */

/** A destination inside the application, as a path Expo Router understands. */
import { parseFilters, searchParamsFrom, toSearchParams } from '@ideanest/discovery/filters';
import { archivedVersionOf, isLegalDocumentSlug } from '@ideanest/legal/documents';
import { isSettingsSection } from '../features/settings/sections';

/**
 * A route, and the params it opens with. `params` is only ever the feed's own parameters
 * (Discover), the query (Search), the decoded slugs of a browse route (#154), or a campaign's
 * `tab` and `thread` and the checkout's `reward` (#155), rebuilt from the
 * link rather than passed through: a link carries whatever its author wrote, and a `utm_source`
 * or a mistyped status is not a param any screen should receive.
 */
export type Destination = {
  readonly pathname: string;
  readonly params?: Readonly<Record<string, string>>;
};

/**
 * The campaign path shape, on both the web and here.
 *
 * `apps/web` serves a campaign at `/projects/<creator>/<campaign>`, and this
 * application renders it at the same path — so the universal link that opened
 * the app and the route it lands on are the same string, and the `pathPrefix` in
 * `app.config.ts` guards one shape rather than two.
 */
const CAMPAIGN_PATH = /^\/projects\/([^/]+)\/([^/]+)\/?$/;

/**
 * Where a URL should take somebody, or `null` when it should take them nowhere.
 *
 * `null` rather than a home-screen fallback. An unrecognised link is either a
 * page this application does not have — the web has many, and the right answer
 * is to let the browser keep it — or an application trying to drive this one
 * somewhere. Silently landing on the feed makes both look like they worked.
 *
 * <p>Only the paths below are answered, so this parser never names a development route — the kit
 * gallery at `dev/kit` (issue #151) — as a destination; `links.test.ts` pins that. Expo Router's
 * own linking is off (`app/+native-intent.tsx`), and the gallery's `__DEV__` redirect is the
 * second guard that keeps a release build from showing it.
 *
 * @param url the incoming link, in any of the three forms above
 * @param siteHost the host this build claims, from `app.config.ts`'s `siteUrl`
 */
export function destinationFor(url: string, siteHost: string): Destination | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === 'ideanest:') {
    /*
     * A custom-scheme URL has no authority to speak of: `ideanest://projects/a/b`
     * parses with host `projects` and path `/a/b`, which is why the two halves
     * are joined back together before matching rather than read separately.
     * Getting this wrong is the classic custom-scheme bug — it works from a
     * `Linking.openURL` call and fails from a push payload, because the two
     * differ by a slash.
     */
    const path = `/${parsed.host}${parsed.pathname}`.replace(/\/{2,}/g, '/');
    return campaignDestination(path, parsed.search);
  }

  if (parsed.protocol !== 'https:') {
    // http is not accepted even for the right host. A universal link is https by
    // definition, and honouring plain http would accept a downgraded copy of one.
    return null;
  }

  /*
   * The host comparison is exact and case-insensitive. Not `endsWith`: that
   * accepts `evil-ideyanest.com`, which is the whole reason this check exists.
   */
  if (parsed.host.toLowerCase() !== siteHost.toLowerCase()) {
    return null;
  }

  return campaignDestination(parsed.pathname, parsed.search);
}

/** The web carries the locale in the path; the app has a chosen locale instead. */
const LOCALE_PREFIX = /^\/(az|en|ru|tr)(?=\/|$)/;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * The web paths keyed by a project **id** and the app routes they open — issues #150, #155.
 *
 * Expo Router cannot hold `projects/[creatorSlug]` and `projects/[id]` as siblings, so
 * these live under `campaigns/`. They are tested BEFORE the creator/slug pattern, and
 * with a strict UUID: otherwise `/projects/<uuid>/back` would open a campaign slugged
 * `back`, and `/projects/alice/back` (not a UUID) would open the checkout.
 *
 * <p>The checkout keeps the one parameter it is opened with, `?reward=` — the tier a reader chose
 * under "Select this reward" — so a link from the campaign page lands on that tier rather than
 * on the picker. Nothing else in the query reaches any of these screens.
 */
const ID_ROUTES: readonly [RegExp, (m: RegExpExecArray, query: URLSearchParams) => Destination][] = [
  [/^\/projects\/new\/?$/, () => ({ pathname: '/campaigns/new' })],
  [
    new RegExp(`^/projects/(${UUID})/back/?$`),
    (m, query) =>
      withParams(`/campaigns/${m[1]}/back`, {
        reward: opaqueParam(query.get('reward')),
        token: tokenParam(query.getAll('token')),
      }),
  ],
  [new RegExp(`^/projects/(${UUID})/prelaunch/?$`), (m) => ({ pathname: `/campaigns/${m[1]}/prelaunch` })],
  [
    new RegExp(`^/projects/(${UUID})/edit/(basics|story|rewards|faq|prelaunch|review)/?$`),
    (m) => ({ pathname: `/campaigns/${m[1]}/edit/${m[2]}` }),
  ],
  // A bare `/edit` opens the first step rather than a campaign slugged "edit".
  [new RegExp(`^/projects/(${UUID})/edit/?$`), (m) => ({ pathname: `/campaigns/${m[1]}/edit/basics` })],
  [
    new RegExp(`^/projects/(${UUID})/dashboard(?:/(charts|backers|finance|surveys))?/?$`),
    (m) => ({ pathname: `/campaigns/${m[1]}/dashboard${m[2] === undefined ? '' : `/${m[2]}`}` }),
  ],
  [/^\/pledges\/?$/, () => ({ pathname: '/pledges' })],
  [
    new RegExp(`^/pledges/(${UUID})/?$`),
    (m, query) =>
      withParams(`/pledges/${m[1]}`, {
        payment: returnHintParam(query.get('payment')),
        raise: returnHintParam(query.get('raise')),
      }),
  ],
  [new RegExp(`^/pledges/(${UUID})/address/?$`), (m) => ({ pathname: `/pledges/${m[1]}/address` })],
];

function returnHintParam(value: string | null): string | undefined {
  return value === 'returned' || value === 'failed' ? value : undefined;
}

/**
 * The campaign page's tabs other than the default, as the web names them in `?tab=`
 * (`apps/web/src/lib/projects/tabs.ts`, `CAMPAIGN_TABS`). `campaign` is not here because the web
 * never writes it: the bare path is the default tab, and a link that says `?tab=campaign` opens
 * the same page with no param. An unknown value is dropped for the same reason the web's
 * `campaignTabFrom` answers the default — a mistyped link still opens the campaign.
 */
const LINKED_TABS: ReadonlySet<string> = new Set(['creator', 'faq', 'updates', 'comments']);

/**
 * Longer than any id or cursor the service mints — a UUID is 36 — and short enough to be a
 * bound: the web's `campaignCursorFrom` draws the line at the same length for the same reason.
 */
const MAX_OPAQUE_LENGTH = 128;

/**
 * A value the service minted — a comment thread's id, a reward tier's id — carried through the
 * link untouched, or `undefined`. Trimmed and length-bounded and otherwise not read: its shape is
 * the service's business, and a malformed one is refused by the service the screen asks.
 */
function opaqueParam(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed.length > MAX_OPAQUE_LENGTH ? undefined : trimmed;
}

/** Every `?token=` that unlocks hidden tiers (#157), comma-joined; one with a comma is dropped. */
function tokenParam(values: readonly string[]): string | undefined {
  const tokens = values
    .map((value) => opaqueParam(value))
    .filter((value): value is string => value !== undefined && !value.includes(','));
  return tokens.length === 0 ? undefined : tokens.join(',');
}

/** A destination whose `params` holds only the values that are present — none means no `params`. */
function withParams(pathname: string, params: Record<string, string | undefined>): Destination {
  const present: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) present[name] = value;
  }
  return Object.keys(present).length === 0 ? { pathname } : { pathname, params: present };
}

/**
 * The campaign page's own query — `?tab=` and, on the Comments tab, `?thread=` — rebuilt from the
 * link, so `/projects/a/b?tab=comments` opens the comments rather than the story (#155). The
 * web's `from` cursor is not carried: the app appends older pages in place rather than
 * addressing one, so a cursor in a link would name a page the screen never asks for.
 */
function campaignParams(query: URLSearchParams): Record<string, string | undefined> {
  const tab = query.get('tab')?.trim().toLowerCase();
  const linkedTab = tab !== undefined && LINKED_TABS.has(tab) ? tab : undefined;
  // A thread is a conversation on the Comments tab; the web ignores it on every other tab.
  const thread = linkedTab === 'comments' ? opaqueParam(query.get('thread')) : undefined;
  return { tab: linkedTab, thread };
}

/*
 * The discovery entry points (#153): the home page, the feed with its filters in the query
 * string, and the search results. Each opens its screen with the state the web would show for the
 * same URL — the filters through the shared `parseFilters`, so an unknown status is dropped and a
 * slug is lower-cased exactly as the browser does it.
 */
const HOME_PATH = /^\/?$/;
const DISCOVER_PATH = /^\/discover\/?$/;
const SEARCH_PATH = /^\/search\/?$/;

function discoveryDestination(path: string, search: string): Destination | null {
  if (HOME_PATH.test(path)) return { pathname: '/' };

  if (DISCOVER_PATH.test(path)) {
    const params: Record<string, string> = {};
    for (const [name, value] of toSearchParams(parseFilters(searchParamsFrom(search)))) {
      params[name] = value;
    }
    return { pathname: '/discover', params };
  }

  if (SEARCH_PATH.test(path)) {
    const query = searchParamsFrom(search).get('q')?.trim() ?? '';
    return query === '' ? { pathname: '/search' } : { pathname: '/search', params: { q: query } };
  }

  return null;
}

/*
 * The browse pages (#154): the categories index, a category, a subcategory within it, the
 * collections index and one collection — each the web's path, so a link shared from a landing
 * page opens the same landing page. Nothing deeper is claimed: `/categories/a/b/c` is a page
 * neither platform has.
 */
const CATEGORIES_INDEX = /^\/categories\/?$/;
const CATEGORY_PAGE = /^\/categories\/([^/]+)\/?$/;
const SUBCATEGORY_PAGE = /^\/categories\/([^/]+)\/([^/]+)\/?$/;
const COLLECTIONS_INDEX = /^\/collections\/?$/;
const COLLECTION_PAGE = /^\/collections\/([^/]+)\/?$/;

/**
 * Each segment decoded exactly once, or `null` when one will not decode, decodes to nothing, or
 * decodes to a slash — the rule `campaignDestination` states for a campaign's two slugs.
 */
function decodedSegments(raw: readonly (string | undefined)[]): string[] | null {
  const decoded: string[] = [];
  for (const segment of raw) {
    if (segment === undefined) return null;
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (value === '' || value.includes('/')) return null;
    decoded.push(value);
  }
  return decoded;
}

/**
 * The slugs go to the screen as params against the route's own pattern rather than spliced into
 * a path, so a slug the router would read as syntax (`?`, `#`) is still one slug.
 */
function browseDestination(path: string): Destination | null {
  if (CATEGORIES_INDEX.test(path)) return { pathname: '/categories' };
  if (COLLECTIONS_INDEX.test(path)) return { pathname: '/collections' };

  const sub = SUBCATEGORY_PAGE.exec(path);
  if (sub !== null) {
    const [category, subcategory] = decodedSegments([sub[1], sub[2]]) ?? [];
    return category === undefined || subcategory === undefined
      ? null
      : { pathname: '/categories/[category]/[subcategory]', params: { category, subcategory } };
  }

  const one = CATEGORY_PAGE.exec(path);
  if (one !== null) {
    const [category] = decodedSegments([one[1]]) ?? [];
    return category === undefined
      ? null
      : { pathname: '/categories/[category]', params: { category } };
  }

  const collection = COLLECTION_PAGE.exec(path);
  if (collection !== null) {
    const [slug] = decodedSegments([collection[1]]) ?? [];
    return slug === undefined ? null : { pathname: '/collections/[slug]', params: { slug } };
  }

  return null;
}

/*
 * The account settings (#161): the list, and each of the web's nine `/settings/*` pages — the
 * address in every notification email. The payout page keeps the one parameter its card
 * registration returns with, `?card=returned|failed`.
 */
const SETTINGS_PATH = /^\/settings(?:\/([a-z]+))?\/?$/;

function settingsDestination(path: string, query: URLSearchParams): Destination | null {
  const match = SETTINGS_PATH.exec(path);
  if (match === null) return null;
  const section = match[1];
  if (section === undefined) return { pathname: '/settings' };
  if (!isSettingsSection(section)) return null;
  return section === 'payout'
    ? withParams('/settings/payout', { card: returnHintParam(query.get('card')) })
    : { pathname: `/settings/${section}` };
}

/*
 * The static and legal pages (#164): About, How it works, Trust and safety, the legal index, a
 * document in force and an archived version. A document outside §22.2's eight, or a version
 * segment that is not one, is left to the browser rather than opened as a not-found screen.
 * Pricing keeps the two parameters a refused submission adds, `?from=submit&project=<id>`, and
 * only with an id: anything else opens the plain page.
 */
const STATIC_PAGE = /^\/(about|how-it-works|trust-safety|legal)\/?$/;
const LEGAL_DOCUMENT = /^\/legal\/([a-z-]+)(?:\/v\/([^/]+))?\/?$/;

const PRICING_PAGE = /^\/pricing\/?$/;
const PROJECT_ID = new RegExp(`^${UUID}$`);

function contentDestination(path: string, query: URLSearchParams): Destination | null {
  if (PRICING_PAGE.test(path)) {
    const project = query.get('project');
    return query.get('from') === 'submit' && project !== null && PROJECT_ID.test(project)
      ? { pathname: '/pricing', params: { from: 'submit', project } }
      : { pathname: '/pricing' };
  }

  const page = STATIC_PAGE.exec(path);
  if (page !== null) return { pathname: `/${page[1]}` };

  const legal = LEGAL_DOCUMENT.exec(path);
  if (legal === null) return null;
  const [, slug, version] = legal;
  if (slug === undefined || !isLegalDocumentSlug(slug)) return null;
  if (version === undefined) return { pathname: `/legal/${slug}` };
  const number = archivedVersionOf(version);
  return number === null ? null : { pathname: `/legal/${slug}/v/${number}` };
}

/*
 * The account area (#159): the web's `/account` is the Me tab here, `/account/saved` is the Me
 * hub's Saved screen, and the other four are stack routes of the same name. Any other section is
 * a page neither platform has, and is left to the browser.
 */
const ACCOUNT_PATH = /^\/account(?:\/([a-z]+))?\/?$/;
const ACCOUNT_SECTIONS: ReadonlySet<string> = new Set(['campaigns', 'deliveries', 'following', 'surveys']);

function accountDestination(path: string): Destination | null {
  const match = ACCOUNT_PATH.exec(path);
  if (match === null) return null;
  const section = match[1];
  if (section === undefined) return { pathname: '/me' };
  if (section === 'saved') return { pathname: '/saved' };
  return ACCOUNT_SECTIONS.has(section) ? { pathname: `/account/${section}` } : null;
}

/** A public profile (#156): `/u/<slug>`, the slug decoded once, nothing deeper. */
const PROFILE_PAGE = /^\/u\/([^/]+)\/?$/;

function profileDestination(path: string): Destination | null {
  const match = PROFILE_PAGE.exec(path);
  if (match === null) return null;
  const [slug] = decodedSegments([match[1]]) ?? [];
  return slug === undefined ? null : { pathname: '/u/[slug]', params: { slug } };
}

function campaignDestination(rawPath: string, search = ''): Destination | null {
  const path = rawPath.replace(LOCALE_PREFIX, '') || '/';

  const discovery = discoveryDestination(path, search);
  if (discovery !== null) return discovery;

  const browse = browseDestination(path);
  if (browse !== null) return browse;

  const account = accountDestination(path) ?? profileDestination(path);
  if (account !== null) return account;

  const query = searchParamsFrom(search);

  const settings = settingsDestination(path, query);
  if (settings !== null) return settings;

  const content = contentDestination(path, query);
  if (content !== null) return content;

  for (const [pattern, toRoute] of ID_ROUTES) {
    const idMatch = pattern.exec(path);
    if (idMatch !== null) return toRoute(idMatch, query);
  }

  /*
   * What is left under `/projects/` is a creator and a campaign slug — including
   * `/projects/alice/prelaunch` and `/projects/alice/back`, whose first segment is not an id.
   *
   * THE WEB ANSWERS THOSE TWO DIFFERENTLY, and that is deliberately not copied. Next's static
   * `prelaunch` and `back` segments win over `[projectSlug]`, so the browser renders the pre-launch
   * page (or the checkout) for a project "id" of `alice`, which the service answers 404, and a
   * campaign slugged `prelaunch` is unreachable there (#148). This application's own share sheet
   * builds `/projects/{creator}/{slug}` for every campaign (`shareUrlFor`), so such a link is one
   * a reader was really sent, and the only page it can mean is that campaign: it opens the
   * campaign page. `links-campaigns.test.ts` pins both.
   */
  const match = CAMPAIGN_PATH.exec(path);
  if (match === null) return null;

  const creatorSlug = match[1];
  const projectSlug = match[2];
  if (creatorSlug === undefined || projectSlug === undefined) return null;

  /*
   * Decoded once, here, because the segments were percent-encoded by whoever
   * built the link and the router expects the real value. Decoding twice is how
   * a slug containing an encoded slash becomes a path separator.
   */
  let creator: string;
  let slug: string;
  try {
    creator = decodeURIComponent(creatorSlug);
    slug = decodeURIComponent(projectSlug);
  } catch {
    return null; // a malformed escape such as %zz is a bad link, not a crash
  }
  if (creator.includes('/') || slug.includes('/')) return null;
  return withParams(`/projects/${creator}/${slug}`, campaignParams(query));
}

/**
 * The canonical web URL for a campaign — what the share sheet sends.
 *
 * The https form rather than the custom scheme, because a link sent to somebody
 * without the application installed has to be openable, and `ideanest://` is a
 * dead end in every browser. The universal-link association is what makes it
 * open the application for everybody who does have it.
 */
export function shareUrlFor(siteUrl: string, creatorSlug: string, projectSlug: string): string {
  return `${siteUrl}/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`;
}
