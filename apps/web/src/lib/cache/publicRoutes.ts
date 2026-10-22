import { SUPPORTED_LOCALES } from '../i18n/locale';

/**
 * Which pages a shared cache may hold, and for how long — issue #127.
 *
 * <h2>Why a shared cache is safe here at all</h2>
 *
 * Because every server render in this application is anonymous, and that is a property rather
 * than a coincidence. The refresh cookie is issued on `Path=/v1/auth`, so a request for a page
 * carries no session for `cookies()` to read; `SessionProvider` says so, and nothing under
 * `src/` calls `next/headers` at all. A signed-in reader and a stranger are served the same
 * HTML and the difference appears after hydration.
 *
 * <p>That is what makes `public` truthful on the responses below. It is also why this list is
 * an allow-list of path shapes rather than a deny-list of the private ones: the day a page
 * does start varying by reader, the mistake to be protected against is one nobody remembered
 * to add to a deny-list.
 *
 * <h2>Sixty seconds, matching everything else</h2>
 *
 * The service puts sixty seconds on its own `Cache-Control` for these reads, `lib/api/server.ts`
 * holds the same window, and a third number here would be a third cache with an opinion. What
 * this adds on top is `stale-while-revalidate`: a shared cache may serve the minute-old copy
 * while it fetches a fresh one, so the reader who arrives at second sixty-one waits for a
 * network hop rather than for a render.
 *
 * <h2>WHY THIS IS NOT `next.config.mjs`'s `headers()`</h2>
 *
 * Because the campaign page's address is `/{locale}/projects/{id}/{projectSlug}` and the
 * creator's editor is `/{locale}/projects/{id}/edit`. A path pattern that matches the first
 * matches the second, and the shape of that mistake — a creator's unpublished draft page
 * marked publicly cacheable — is exactly the kind that is invisible in review and obvious in
 * production. Here the private segments are named, checked, and covered by a test that reads
 * the list rather than repeating it.
 */

/** The window every cache in this system holds these reads for. */
export const PUBLIC_PAGE_MAX_AGE_SECONDS = 60;

/**
 * How long a shared cache may keep serving the stale copy while it refreshes.
 *
 * Ten minutes. Long enough that a burst of traffic on a campaign that has just been shared is
 * absorbed by one origin render rather than by thousands, and short enough that an origin
 * which has been down for the whole window is no longer being spoken for.
 */
export const PUBLIC_PAGE_STALE_SECONDS = 600;

export const PUBLIC_PAGE_CACHE_CONTROL =
  `public, s-maxage=${PUBLIC_PAGE_MAX_AGE_SECONDS}, ` +
  `stale-while-revalidate=${PUBLIC_PAGE_STALE_SECONDS}`;

/**
 * The second segment of a public page's path, after the language.
 *
 * `''` is the home page. Everything here is a page a stranger and a crawler read, and every
 * one of them is server-rendered from anonymous reads.
 */
const PUBLIC_SECTIONS: ReadonlySet<string> = new Set([
  /*
   * The home page, discover, search, categories and collections are not here any more (#533).
   * They list the campaigns for the reader's country, so they are not one document per
   * language; `lib/market/market.ts` names them and `proxy.ts` answers them `private`.
   */
  'about',
  'how-it-works',
  'trust-safety',
  'support',
  // §22.2's documents -- #439. Read by a stranger and a regulator, rendered from anonymous
  // reads, identical for everybody in a language: the exact shape a shared cache is for.
  'legal',
  'u',
]);

/**
 * The segments under `/projects/{id}/` that belong to whoever owns the campaign.
 *
 * The campaign's own public page is `/projects/{id}/{projectSlug}`, so the slug position is a
 * wildcard and these are the words it must never be. They are the reason this is a function
 * and not a pattern in the framework's configuration.
 */
const PRIVATE_PROJECT_SEGMENTS: ReadonlySet<string> = new Set([
  'edit',
  'dashboard',
  'back',
  'prelaunch',
]);

/**
 * The `Cache-Control` a shared cache should be given for this path, or `null` when the page is
 * not one a shared cache may hold.
 *
 * `null` leaves the framework's own header in place, which for a dynamic route is
 * `private, no-cache, no-store` — the safe answer, and the one every unrecognised path gets.
 */
export function publicCacheControl(pathname: string): string | null {
  const segments = pathname.split('/');

  // `/az/discover` splits to `['', 'az', 'discover']`, so a path with no language is not one
  // of these pages: `proxy.ts` redirects it before a render happens.
  const locale = segments[1];
  if (locale === undefined || !(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return null;
  }

  const section = segments[2] ?? '';
  if (section === 'projects') return campaignPage(segments) ? PUBLIC_PAGE_CACHE_CONTROL : null;
  if (!PUBLIC_SECTIONS.has(section)) return null;

  /*
   * A trailing slash produces an empty last segment — `/az/discover/` splits to four — and
   * that is a second address for one page rather than a different page. It is refused here
   * rather than normalised, because normalising an address inside a cache decision is how two
   * caches come to disagree about what they are holding.
   */
  return segments.at(-1) === '' && segments.length > 2 ? null : PUBLIC_PAGE_CACHE_CONTROL;
}

/**
 * Whether `/{locale}/projects/...` is the campaign's public page rather than one of its
 * owner's screens.
 *
 * Exactly `/{locale}/projects/{id}/{projectSlug}` — four segments after the leading empty one
 * — and the last of them not one of the words a creator's own screens use.
 */
function campaignPage(segments: readonly string[]): boolean {
  if (segments.length !== 5) return false;

  const slug = segments[4];
  return slug !== undefined && slug !== '' && !PRIVATE_PROJECT_SEGMENTS.has(slug);
}
