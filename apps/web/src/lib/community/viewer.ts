import type { components } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/*
 * A module of its own rather than another export of `signals.ts`, because that module is also in
 * the profile page's bundle (its follow control) and an export the campaign page uses is kept in
 * every chunk the module lands in. The campaign page is the only reader of this one.
 */

/** What the signed-in reader has already said about one campaign. See {@link viewerState}. */
export type ViewerState = components['schemas']['CampaignViewerResponse'];

/**
 * Whether the signed-in reader has saved this campaign, asked for its launch reminder, follows
 * its creator and backs it — `GET /v1/projects/{id}/viewer` (#137).
 *
 * A read of its own rather than part of the campaign page, because the page is public and the
 * same for everybody: folding the reader into it would make every cached copy somebody's. The
 * service answers it `no-store`, 401 without a session and 404 for a campaign the public may not
 * see; a caller treats any failure as "not known" and offers the actions, which is safe because
 * every write behind them is idempotent.
 */
export async function viewerState(projectId: string, signal?: AbortSignal): Promise<ViewerState> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/viewer`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as ViewerState;
}
