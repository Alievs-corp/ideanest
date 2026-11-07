import type { AudienceSurface } from './beacon';

/**
 * Which pages a `VISIT` is counted on, and the two attributes a card link carries for a `CLICK`.
 *
 * <h2>Not the console, not a creator's own back office</h2>
 *
 * The console (`/admin`), a campaign's dashboard and its editor (`/projects/{id}/dashboard`,
 * `/projects/{id}/edit`, `/projects/new`) are where staff and creators work, not where the
 * platform's audience is. Counting them would put every refresh of a creator watching their own
 * numbers into the numbers they are watching. Everything else — the public site, sign-in, an
 * account's own pages — is somebody using the platform and is counted.
 *
 * The path is the one `i18n/navigation`'s `usePathname` returns, without the language segment.
 */

const UNCOUNTED: readonly RegExp[] = [
  /^\/admin(?:\/|$)/,
  /^\/projects\/new(?:\/|$)/,
  /^\/projects\/[^/]+\/(?:dashboard|edit)(?:\/|$)/,
];

export function countsAsVisit(pathname: string): boolean {
  return !UNCOUNTED.some((pattern) => pattern.test(pathname));
}

/**
 * The attributes the delegated listener in `AudienceTracker` reads off a followed link.
 *
 * Data attributes rather than an `onClick`, because both cards are Server Components and must
 * stay ones: a handler would make each card a client boundary, and a feed of twenty-four of them
 * would ship twenty-four hydrated islands to send one beacon. One listener on the document,
 * mounted once in the root layout, reads these instead.
 */
export const AUDIENCE_PROJECT_ATTRIBUTE = 'data-audience-project';
export const AUDIENCE_SURFACE_ATTRIBUTE = 'data-audience-surface';

export function audienceClickAttributes(
  projectId: string,
  surface: AudienceSurface,
): Readonly<Record<string, string>> {
  return { [AUDIENCE_PROJECT_ATTRIBUTE]: projectId, [AUDIENCE_SURFACE_ATTRIBUTE]: surface };
}

const SURFACES: ReadonlySet<string> = new Set<AudienceSurface>([
  'HOME',
  'DISCOVER',
  'SEARCH',
  'CATEGORY',
  'COLLECTION',
  'PROFILE',
  'SAVED',
  'OTHER',
]);

/** A surface read back off the DOM. Anything unrecognised is `OTHER` rather than a 400. */
export function surfaceOf(value: string | null): AudienceSurface {
  return value !== null && SURFACES.has(value) ? (value as AudienceSurface) : 'OTHER';
}
