import { ApiError, createApiClient } from '@ideanest/api-client';
import type { ServerReadOptions } from '../api/server';
import { apiOrigin } from '../seo/metadata-source';
import { project } from '../cache/tags';
import {
  UPDATE_PAGE_SIZE,
  readUpdatePage,
  type CampaignUpdatePage,
} from '@ideanest/campaign/updates';

/**
 * §4.4's Updates tab and §4.9's half of #83 — the numbered announcements on a campaign.
 *
 * <h2>The read is on the server, and that is the whole point of the tab</h2>
 *
 * `GET /v1/projects/{projectId}/updates` is `permitAll`, so there is nothing about it that
 * needs a browser. Fetching it after hydration would put the campaign's own announcements
 * behind JavaScript on the one route #119 exists to keep in the initial HTML — a creator's
 * "the moulds were late" is exactly the kind of thing somebody searches for by quoting it,
 * and a crawler served an empty list has been told the campaign has said nothing.
 *
 * <h2>The client does not filter, and could not</h2>
 *
 * §4.9 is explicit: `visibility` is stored and enforced, and the public read withholds a
 * `BACKERS_ONLY` update from anybody outside the campaign's team. What arrives here is
 * therefore already the list this caller may see. <strong>Nothing below drops a row</strong>,
 * and a client-side filter would be worse than redundant — it would be a second, weaker copy
 * of an entitlement rule, and the first time the two disagreed the weaker one would be the
 * one rendering a private update into public HTML.
 *
 * `visibility` is still read and still shown, because a public update marked as such is a
 * different statement from one that happens to be visible: a backer who can see a
 * backers-only update is entitled to know that not everybody can.
 *
 * <h2>Why the read is here rather than in `lib/api/server.ts`</h2>
 *
 * That module is where every other server-side public read lives and this one follows its
 * conventions exactly — anonymous, `next.revalidate` matching the service's own
 * `Cache-Control`, and `null` rather than a thrown page when the service refuses. It is not
 * <em>in</em> that file because it is shared ground in this branch: several agents are adding
 * public reads at once, and several sets of hands in one module is how two of them end up
 * with two spellings of the same helper. Folding these two functions back into it is a
 * tidy-up with no behaviour in it.
 *
 * <h2>Anonymous, and what that costs honestly</h2>
 *
 * The server read sends no token, for the reason `lib/api/server.ts` gives at length: a
 * server render that varied by session cannot be cached, shared, or served to a crawler. So
 * a signed-in member of the campaign's team is served the same list as a stranger. Today
 * that costs nothing at all, because §4.9 says the service withholds `BACKERS_ONLY` from
 * <em>everybody</em> outside the team and the team reads its own updates from the dashboard.
 * The day the service learns "has this account an active pledge", this tab needs a
 * client-side top-up for the signed-in case rather than a session-varying server render.
 */

/*
 * The shapes, `UPDATE_PAGE_SIZE` and `readUpdatePage` are `@ideanest/campaign/updates` since
 * #155, so the app's Updates tab reads the same list. Re-exported under the same names.
 */
export {
  UPDATE_PAGE_SIZE,
  readUpdatePage,
  type CampaignUpdate,
  type CampaignUpdatePage,
  type UpdateVisibility,
} from '@ideanest/campaign/updates';

/** A minute, matching `lib/api/server.ts` and the service's own `Cache-Control`. */
const PUBLIC_READ_REVALIDATE_SECONDS = 60;

/**
 * One page of a campaign's updates, or `null` when the service refused.
 *
 * `null` rather than an empty page, for the reason `fetchPublicRewards` gives about reward
 * tiers: an empty list is a campaign that has announced nothing, which is a real and
 * different thing, and a tab that could not tell them apart would print "no updates yet"
 * over a service that was merely restarting.
 */
export async function fetchProjectUpdates(
  projectId: string,
  cursor: number | null = null,
  options: ServerReadOptions = {},
): Promise<CampaignUpdatePage | null> {
  const baseUrl = apiOrigin(options.env);
  const client =
    options.fetchImpl === undefined
      ? createApiClient({ baseUrl })
      : createApiClient({ baseUrl, fetch: options.fetchImpl });

  try {
    const body = await client.get('/v1/projects/{projectId}/updates', {
      path: { projectId },
      query: cursor === null ? { limit: UPDATE_PAGE_SIZE } : { cursor, limit: UPDATE_PAGE_SIZE },
      ...(options.locale === undefined ? {} : { headers: { 'accept-language': options.locale } }),
      // #127. The service names the campaign when a comment, an update or a question
      // moves; without the tag this list is only ever as fresh as the window above.
      next: {
        revalidate: options.revalidateSeconds ?? PUBLIC_READ_REVALIDATE_SECONDS,
        tags: [project(projectId)],
      },
    });
    return readUpdatePage(body);
  } catch (cause) {
    /*
     * The same two-case rule `lib/api/server.ts` argues: a refusal the service made is an
     * answer this tab can render, and a `TypeError` from an unreachable service is the one
     * non-refusal a public page still has to survive. Anything else is a bug and is allowed
     * to surface rather than becoming a campaign that has quietly stopped announcing things.
     */
    if (cause instanceof ApiError || cause instanceof TypeError) return null;
    throw cause;
  }
}
