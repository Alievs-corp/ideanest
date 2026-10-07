/**
 * Where My campaigns sends a creator — the web's `lib/projects/mine.ts` and
 * `lib/account/navigation.ts`, in this application's route names (#159).
 *
 * <p>The web's id-keyed `/projects/{id}/…` pages live under `campaigns/` here, because Expo Router
 * cannot hold `projects/[id]` beside `projects/[creatorSlug]`. The public page keeps its address.
 */

/** §6.1's public states: a campaign in one of these has a page a backer could open. */
export const PUBLIC_STATES: ReadonlySet<string> = new Set([
  'PRELAUNCH',
  'LIVE',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  'CLOSING_WINDOW',
  'EXTENDED',
  'WITHDRAWN',
]);

/**
 * The states with a dashboard worth opening — the web's `LAUNCHED_STATES` (#141): every public
 * state but `PRELAUNCH`, which has no backers yet, plus `SUSPENDED`, whose creator still owes
 * what the dashboard lists.
 */
const LAUNCHED_STATES: ReadonlySet<string> = new Set([
  ...[...PUBLIC_STATES].filter((state) => state !== 'PRELAUNCH'),
  'SUSPENDED',
]);

export function isPubliclyVisible(state: string): boolean {
  return PUBLIC_STATES.has(state);
}

export function hasLaunched(state: string): boolean {
  return LAUNCHED_STATES.has(state);
}

export interface CampaignRow {
  readonly id: string;
  readonly state: string;
  readonly creatorSlug?: string;
  readonly slug?: string;
}

export type CampaignHref =
  | {
      readonly pathname: '/projects/[creatorSlug]/[projectSlug]';
      readonly params: { readonly creatorSlug: string; readonly projectSlug: string };
    }
  | { readonly pathname: '/campaigns/[id]/edit/basics'; readonly params: { readonly id: string } }
  | { readonly pathname: '/campaigns/[id]/dashboard'; readonly params: { readonly id: string } };

export function editorHref(id: string): CampaignHref {
  return { pathname: '/campaigns/[id]/edit/basics', params: { id } };
}

export function dashboardHref(id: string): CampaignHref {
  return { pathname: '/campaigns/[id]/dashboard', params: { id } };
}

/**
 * The row's own destination — `myCampaignHref`: the public page when there is one, otherwise the
 * editor, which is the only address a draft has. A public card missing its slugs falls back to the
 * editor too, rather than to a page that would answer 404.
 */
export function myCampaignHref(row: CampaignRow): CampaignHref {
  const creatorSlug = row.creatorSlug ?? '';
  const projectSlug = row.slug ?? '';
  if (isPubliclyVisible(row.state) && creatorSlug !== '' && projectSlug !== '') {
    return { pathname: '/projects/[creatorSlug]/[projectSlug]', params: { creatorSlug, projectSlug } };
  }
  return editorHref(row.id);
}
