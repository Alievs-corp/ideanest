import { siteUrl } from '../../../api/config';

/**
 * The Pre-launch tab's one address (#162). The follower count is read through the public page's
 * own `usePrelaunchPage` (`api/queries.ts`), the reader the app's pre-launch screen already uses,
 * rather than a second request for the same body.
 *
 * There is no write. The page is public once moderation has approved the campaign; a creator can
 * no longer open it from a draft, which published a campaign nobody had reviewed.
 */

/**
 * The address to share: `{IDEANEST_SITE_URL}/projects/{id}/prelaunch`.
 *
 * The https form, as `shareUrlFor` builds a campaign's, because a link sent to somebody without the
 * app has to open in a browser. No locale segment: the site picks the reader's language, and
 * `lib/links.ts` maps the same path back onto this app's pre-launch screen.
 */
export function prelaunchLink(projectId: string, site: string = siteUrl()): string {
  return `${site}/projects/${encodeURIComponent(projectId)}/prelaunch`;
}
