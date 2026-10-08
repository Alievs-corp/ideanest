import { SUPPORTED_LOCALES } from '@ideanest/messages/locale';

/**
 * The paths on the site that a link may open the mobile application at — issue #165, §4.12 MB-02.
 *
 * <h2>One table, three readers</h2>
 *
 * A link opens the application only when three things agree: Apple's association file
 * (`apps/web/src/lib/mobile/association.ts`), Android's intent filters
 * (`apps/mobile/app.config.ts`), and the parser that turns the URL into a screen
 * (`./destination.ts`). Each used to carry its own list, and they drifted: the association
 * claimed `/projects/*` while the site served `/az/projects/…`, so a campaign copied from a
 * browser opened nothing. All three now read {@link CLAIMED_ROUTES}.
 *
 * <h2>Why this module imports nothing but the locale list</h2>
 *
 * `app.config.ts` and `apps/mobile/scripts/check-association.mjs` load it with Node's own
 * loader, which strips the types and cannot follow an extensionless relative import. Keep it
 * free of those, and of TypeScript syntax that needs more than stripping (`enum`, namespaces).
 */

/** The four languages the site serves every page under (`apps/web/src/i18n/routing.ts`). */
export const LOCALES = SUPPORTED_LOCALES;

/** The campaign editor's steps, as both the web and the app name them. */
export const EDIT_STEPS = ['basics', 'story', 'rewards', 'faq', 'prelaunch', 'review'] as const;

/** The creator dashboard's tabs other than its overview. */
export const DASHBOARD_TABS = ['charts', 'backers', 'finance', 'surveys'] as const;

/** The web's nine `/settings/*` panels, in `ACCOUNT_GROUPS.settings` order (#161). */
export const SETTINGS_PANELS = [
  'profile',
  'notifications',
  'sessions',
  'email',
  'password',
  'security',
  'privacy',
  'payout',
  'language',
] as const;

export type SettingsPanel = (typeof SETTINGS_PANELS)[number];

/** `/account/*` pages that are a stack screen of the same name in the app (#159). */
export const ACCOUNT_SECTIONS = ['campaigns', 'deliveries', 'following', 'surveys'] as const;

/** The discovery feed's own query parameters (`@ideanest/discovery/filters`, `toSearchParams`). */
const FEED_QUERY = [
  'q',
  'status',
  'category',
  'subcategory',
  'tag',
  'completion',
  'goalBand',
  'goalMin',
  'goalMax',
  'raisedBand',
  'raisedMin',
  'raisedMax',
  'sort',
] as const;

/** One row of the claim: what the site serves, and where the application opens it. */
export interface ClaimedRoute {
  /** A stable name for the row, for tests and for reading. */
  readonly id: string;
  /**
   * The web paths, without a locale, in the association file's pattern syntax: `*` matches any
   * run of characters, slashes included. Every one is claimed bare and under each locale.
   */
  readonly paths: readonly string[];
  /** The route files the row opens, relative to `apps/mobile/src/app`, without an extension. */
  readonly routes: readonly string[];
  /** The query keys the parser keeps on this row. Every other key is dropped. */
  readonly query: readonly string[];
  /** Who writes links of this shape. */
  readonly producedBy: string;
}

const row = (
  id: string,
  paths: readonly string[],
  routes: readonly string[],
  producedBy: string,
  query: readonly string[] = [],
): ClaimedRoute => ({ id, paths, routes, query, producedBy });

/**
 * The claim, as issue #165 states it. Order matters only to a reader: the association file
 * puts {@link EXCLUDED_PATHS} first, and the parser matches the id forms before the
 * creator/slug form whatever the order here.
 */
export const CLAIMED_ROUTES: readonly ClaimedRoute[] = [
  row('home', ['/'], ['(tabs)/index'], 'shares; the notification fallback `/`'),
  row('discover', ['/discover'], ['discover'], 'shares', FEED_QUERY),
  row('search', ['/search'], ['(tabs)/search'], 'shares', ['q']),
  row(
    'categories',
    ['/categories', '/categories/*'],
    ['categories/index', 'categories/[category]/index', 'categories/[category]/[subcategory]'],
    'shares',
  ),
  row('collections', ['/collections', '/collections/*'], ['collections/index', 'collections/[slug]'], 'shares'),
  row('campaign-new', ['/projects/new'], ['campaigns/new'], 'the footer’s "Start a campaign"'),
  row('campaign-prelaunch', ['/projects/*/prelaunch'], ['campaigns/[id]/prelaunch'], 'the pre-launch link copy'),
  row('campaign-checkout', ['/projects/*/back'], ['campaigns/[id]/back'], 'the campaign CTA', ['reward', 'token']),
  row(
    'campaign-editor',
    ['/projects/*/edit', '/projects/*/edit/*'],
    EDIT_STEPS.map((step) => `campaigns/[id]/edit/${step}`),
    'creator emails and links',
  ),
  row(
    'campaign-dashboard',
    ['/projects/*/dashboard', '/projects/*/dashboard/*'],
    ['campaigns/[id]/dashboard/index', ...DASHBOARD_TABS.map((tab) => `campaigns/[id]/dashboard/${tab}`)],
    'creator notifications',
  ),
  row(
    'campaign',
    ['/projects/*/*'],
    ['projects/[creatorSlug]/[projectSlug]'],
    'shares, push, notifications',
    ['tab', 'thread'],
  ),
  // The web has no page at `/projects/<uuid>` either; old notification rows still point there.
  row('campaign-legacy-id', ['/projects/*'], ['+not-found'], 'notification rows written before slugs'),
  row(
    'pledges',
    ['/pledges', '/pledges/*'],
    ['(tabs)/pledges', 'pledges/[id]/index', 'pledges/[id]/address'],
    'the payment provider’s return, notifications',
    ['payment', 'raise'],
  ),
  row('profile', ['/u/*'], ['u/[slug]'], 'shares'),
  row('notifications', ['/notifications'], ['notifications'], 'emails'),
  row(
    'account',
    ['/account', '/account/*'],
    ['(tabs)/me', 'saved', ...ACCOUNT_SECTIONS.map((section) => `account/${section}`)],
    'emails, notifications',
  ),
  row(
    'settings',
    ['/settings', '/settings/*'],
    ['settings/index', ...SETTINGS_PANELS.map((panel) => `settings/${panel}`)],
    'the new-device email (`/settings/sessions`), the payout card return',
    ['card'],
  ),
  row('sign-in', ['/sign-in'], ['(auth)/sign-in'], 'the web’s guards', ['next']),
  row('register', ['/register'], ['(auth)/register'], 'shares'),
  row('reset-password', ['/reset-password'], ['(auth)/reset-password/index'], 'emails'),
  row('verify-email', ['/verify-email'], ['(auth)/verify-email'], 'the registration email', ['token']),
  row(
    'reset-password-confirm',
    ['/reset-password/confirm'],
    ['(auth)/reset-password/confirm'],
    'the password-reset email',
    ['token'],
  ),
  row('confirm-email-change', ['/confirm-email-change'], ['(auth)/confirm-email-change'], 'the email-change email', [
    'token',
  ]),
  row('about', ['/about'], ['about'], 'the footer, shares'),
  row('how-it-works', ['/how-it-works'], ['how-it-works'], 'the footer, shares'),
  row('pricing', ['/pricing'], ['pricing'], 'the footer, the editor’s refused submission', ['from', 'project']),
  row('trust-safety', ['/trust-safety'], ['trust-safety'], 'the footer, shares'),
  row(
    'legal',
    ['/legal', '/legal/*'],
    ['legal/index', 'legal/[document]/index', 'legal/[document]/v/[version]'],
    'the footer, shares',
  ),
  row('maintenance', ['/maintenance'], ['maintenance'], 'the status banner'),
];

/**
 * Never claimed, and listed before every claim in the association file, where the first matching
 * component decides. `*` matches across slashes, so the last pattern below is every OG image,
 * including `/projects/<id>/prelaunch/opengraph-image`, which `/projects/*` would otherwise cover.
 * Each is excluded bare and under every locale.
 */
export const EXCLUDED_PATHS: readonly string[] = [
  '/admin',
  '/admin/*',
  '/api/*',
  '/v1/*',
  '/.well-known/*',
  '/_next/*',
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/icon*',
  '/apple-icon*',
  '*/opengraph-image*',
];

const LOCALE_PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`);

/**
 * A path without its locale segment, `/` for a bare locale. The locale does not change the
 * application's language — that is the reader's own choice (#150) — so it is simply dropped.
 */
export function stripLocale(path: string): string {
  return path.replace(LOCALE_PREFIX, '') || '/';
}

/** `''` for the bare form, then `/az`, `/en`, … — every root a claimed path is served under. */
export function localeRoots(): readonly string[] {
  return ['', ...LOCALES.map((locale) => `/${locale}`)];
}

/** A claimed pattern under a root. The site root under `/az` is `/az`, not `/az/`. */
export function underRoot(root: string, pattern: string): string {
  if (pattern.startsWith('*')) return pattern;
  if (pattern === '/') return root === '' ? '/' : root;
  return `${root}${pattern}`;
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Every claimed pattern, bare and under each locale, without duplicates. */
export function claimedPatterns(): string[] {
  return unique(
    localeRoots().flatMap((root) =>
      CLAIMED_ROUTES.flatMap((route) => route.paths.map((path) => underRoot(root, path))),
    ),
    (pattern) => pattern,
  );
}

/** Every excluded pattern, bare and under each locale, without duplicates. */
export function excludedPatterns(): string[] {
  return unique(
    localeRoots().flatMap((root) => EXCLUDED_PATHS.map((path) => underRoot(root, path))),
    (pattern) => pattern,
  );
}

/** One entry of Apple's `components`. */
export interface AppleComponent {
  readonly '/': string;
  readonly exclude?: true;
  readonly comment: string;
}

/**
 * The association file's `components`: the excludes first, because iOS stops at the first
 * component that matches, then every claimed path.
 */
export function appleComponents(): AppleComponent[] {
  return [
    ...excludedPatterns().map((pattern) => ({ '/': pattern, exclude: true as const, comment: 'Never the app' })),
    ...claimedPatterns().map((pattern) => ({ '/': pattern, comment: commentFor(pattern) })),
  ];
}

function commentFor(pattern: string): string {
  const bare = stripLocale(pattern);
  return CLAIMED_ROUTES.find((route) => route.paths.includes(bare))?.id ?? 'claimed';
}

/** One `<data>` element of the Android intent filter. */
export type AndroidIntentData =
  | { readonly scheme: 'https'; readonly host: string; readonly path: string }
  | { readonly scheme: 'https'; readonly host: string; readonly pathPrefix: string };

/**
 * The Android intent filter's `data`, from the same table.
 *
 * Android cannot exclude, so this is an allowlist: a pattern without `*` is an exact `path`, and
 * one with `*` becomes a `pathPrefix` ending where the wildcard starts — the checkout's
 * pattern becomes `/projects/`. Such a prefix covers more than the table (an OG image under
 * `/projects/`); the application opens what it cannot show in the in-app browser. No prefix ever covers `/admin`:
 * {@link coversAdmin} is the test for that.
 *
 * <p>The site root is claimed twice: as `/`, and as the empty path. Android matches a literal
 * `path` against `Uri.getPath()` exactly, and the bare origin `https://<host>` — what a message
 * app linkifies from "ideyanest.com" — has an empty path, which `/` does not equal. Neither a
 * prefix nor a pattern can say "empty" without also claiming every path, the console included.
 * Not yet verified on a device; `apps/mobile/README.md`, "Deep links", lists it.
 */
export function androidIntentData(host: string): AndroidIntentData[] {
  return unique(
    claimedPatterns().flatMap((pattern): AndroidIntentData[] => {
      const wildcard = pattern.indexOf('*');
      if (wildcard !== -1) return [{ scheme: 'https', host, pathPrefix: pattern.slice(0, wildcard) }];
      const exact: AndroidIntentData = { scheme: 'https', host, path: pattern };
      return pattern === '/' ? [exact, { scheme: 'https', host, path: '' }] : [exact];
    }),
    (entry) => ('path' in entry ? `path ${entry.path}` : `prefix ${entry.pathPrefix}`),
  );
}

/** Whether an Android `pathPrefix` would hand the administration console to the application. */
export function coversAdmin(prefix: string): boolean {
  return localeRoots().some((root) => `${root}/admin`.startsWith(prefix) || `${root}/admin/`.startsWith(prefix));
}

/** The association file's pattern rule: `*` is any run of characters, `?` any one. */
export function matchesPattern(pattern: string, path: string): boolean {
  const source = pattern
    .split('')
    .map((char) => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\/]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`).test(path);
}

/** Whether iOS would hand this path to the application: not excluded, and claimed. */
export function isClaimedPath(path: string): boolean {
  for (const component of appleComponents()) {
    if (matchesPattern(component['/'], path)) return component.exclude !== true;
  }
  return false;
}

/** A `<data>` element as `expo config` prints it: any of the attributes may be missing. */
export interface IntentDataLike {
  readonly scheme?: string;
  readonly host?: string;
  readonly path?: string;
  readonly pathPrefix?: string;
  readonly pathPattern?: string;
}

/** How a set of intent-filter data differs from {@link androidIntentData}. */
export interface IntentDrift {
  /** Entries the table claims and the filter does not. */
  readonly missing: string[];
  /** Entries the filter claims and the table does not. */
  readonly extra: string[];
  /** Prefixes and patterns that would hand the administration console to the application. */
  readonly admin: string[];
}

function describeData(entry: IntentDataLike): string {
  if (entry.path !== undefined) return `path ${entry.path}`;
  if (entry.pathPrefix !== undefined) return `pathPrefix ${entry.pathPrefix}`;
  if (entry.pathPattern !== undefined) return `pathPattern ${entry.pathPattern}`;
  return 'every path';
}

/**
 * Compares the https data of the app's intent filters for `host` with the table — what
 * `apps/mobile/scripts/check-association.mjs` fails a build on. A hand-added prefix is `extra`,
 * a row the filter lost is `missing`.
 */
export function intentDrift(data: readonly IntentDataLike[], host: string): IntentDrift {
  const ours = data.filter((entry) => entry.scheme === 'https' && entry.host === host);
  const actual = new Set(ours.map(describeData));
  const expected = new Set(androidIntentData(host).map(describeData));
  return {
    missing: [...expected].filter((entry) => !actual.has(entry)),
    extra: [...actual].filter((entry) => !expected.has(entry)),
    admin: ours
      .filter(
        (entry) =>
          entry.pathPattern !== undefined ||
          (entry.path === undefined && entry.pathPrefix === undefined) ||
          (entry.pathPrefix !== undefined && coversAdmin(entry.pathPrefix)),
      )
      .map(describeData),
  };
}
