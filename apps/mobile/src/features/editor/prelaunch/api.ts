import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import { siteUrl } from '../../../api/config';
import { sendJson } from '../../../api/client';

/**
 * The Pre-launch tab's one write and its one address (#162). The follower count is read through
 * the public page's own `usePrelaunchPage` (`api/queries.ts`), the reader the app's pre-launch
 * screen already uses, rather than a second request for the same body.
 */

/**
 * `POST /v1/projects/{id}/prelaunch` — makes the pre-launch page public, `DRAFT` → `PRELAUNCH`.
 * There is no way back (docs/architecture.md §6.1), so the tab asks first. Answers the project.
 */
export async function openPrelaunch(projectId: string): Promise<ProjectEdit> {
  return (await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/prelaunch`)) as ProjectEdit;
}

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
