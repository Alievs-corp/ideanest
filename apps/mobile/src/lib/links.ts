/**
 * Deep links and universal links — issue #114. **A shared campaign link opens
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
 * Expo Router can map an incoming URL to a route by itself, and it does — this
 * is not a replacement for it. What it cannot do is refuse: its matcher will
 * happily route a link from a host this application has nothing to do with, and
 * on Android an implicit intent from any installed application can carry one. So
 * the URL is checked here, against the host this build claims, before it is
 * handed over. Being pure is what lets that check be tested without a simulator.
 */

/** A destination inside the application, as a path Expo Router understands. */
export type Destination = { readonly pathname: string };

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
    return campaignDestination(path);
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

  return campaignDestination(parsed.pathname);
}

/** The web carries the locale in the path; the app has a chosen locale instead. */
const LOCALE_PREFIX = /^\/(az|en|ru|tr)(?=\/|$)/;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * The web paths keyed by a project **id** and the app routes they open — issue #150.
 *
 * Expo Router cannot hold `projects/[creatorSlug]` and `projects/[id]` as siblings, so
 * these live under `campaigns/`. They are tested BEFORE the creator/slug pattern, and
 * with a strict UUID: otherwise `/projects/<uuid>/back` would open a campaign slugged
 * `back`, and `/projects/alice/back` (not a UUID) would open the checkout.
 */
const ID_ROUTES: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  [/^\/projects\/new\/?$/, () => '/campaigns/new'],
  [
    new RegExp(`^/projects/(${UUID})/(back|prelaunch)/?$`),
    (m) => `/campaigns/${m[1]}/${m[2]}`,
  ],
  [
    new RegExp(`^/projects/(${UUID})/edit/(basics|story|rewards|faq|prelaunch|review)/?$`),
    (m) => `/campaigns/${m[1]}/edit/${m[2]}`,
  ],
  // A bare `/edit` opens the first step rather than a campaign slugged "edit".
  [new RegExp(`^/projects/(${UUID})/edit/?$`), (m) => `/campaigns/${m[1]}/edit/basics`],
  [
    new RegExp(`^/projects/(${UUID})/dashboard(?:/(charts|backers|finance|surveys))?/?$`),
    (m) => `/campaigns/${m[1]}/dashboard${m[2] === undefined ? '' : `/${m[2]}`}`,
  ],
];

function campaignDestination(rawPath: string): Destination | null {
  const path = rawPath.replace(LOCALE_PREFIX, '') || '/';

  for (const [pattern, toRoute] of ID_ROUTES) {
    const idMatch = pattern.exec(path);
    if (idMatch !== null) return { pathname: toRoute(idMatch) };
  }

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
  return { pathname: `/projects/${creator}/${slug}` };
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
