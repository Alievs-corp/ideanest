import { ApiError, createApiClient } from '@ideanest/api-client';
import type { ServerReadOptions } from '../api/server';
import { apiOrigin } from '../seo/metadata-source';
import { project } from '../cache/tags';
import { readFaqList, type CampaignFaq } from '@ideanest/campaign/faqs';

/**
 * §4.4's FAQ tab — issue #283, over the public read the service now publishes.
 *
 * <h2>The tab that was missing, and what changed</h2>
 *
 * `lib/projects/tabs.ts` used to name FAQ as the one tab of §4.4's table with nothing behind
 * it: §10.2 listed `GET /v1/projects/{id}/faqs` and the service did not publish it, so a tab
 * would have said "no questions yet" on every campaign on the platform — a claim about each
 * campaign that was really a statement about the software. `project_faqs` exists now, the
 * read is `permitAll`, and the empty state is finally a true sentence about one campaign.
 *
 * <h2>The read is on the server, like every other tab on this page</h2>
 *
 * The endpoint is public, so nothing about it needs a browser. Fetching it after hydration
 * would put the campaign's own answers behind JavaScript on the route #119 exists to keep in
 * the initial HTML — and "does it ship to Germany" is exactly the question somebody searches
 * for by quoting it.
 *
 * <h2>Not paged, and the cap is what makes that honest</h2>
 *
 * §4.4 caps the list at fifty entries server-side and publishes no cursor. So there is no
 * `nextCursor` here and no "older questions" link: everything the service will ever send for
 * one campaign arrives in one body. If fifty stops being enough the answer is a cursor rather
 * than a bigger cap — §4.4 says so in as many words — and this module gains a page type on
 * the day that happens rather than pretending to have one now.
 *
 * <h2>The order is the creator's, and nothing here re-sorts it</h2>
 *
 * `sort_order` is what `PATCH /v1/projects/{id}/faqs/reorder` writes and what the editor's
 * move controls change. A client that sorted alphabetically, or by length, or by anything at
 * all would silently discard a creator's decision about which question a backer should read
 * first — which on a campaign is usually the one about shipping.
 *
 * <h2>Anonymous, and what that costs honestly</h2>
 *
 * The server read sends no token, for the reason `lib/api/server.ts` gives at length: a
 * server render that varied by session cannot be cached, shared, or served to a crawler. The
 * service answers a stranger's read of a campaign that is not in a public state with 404, and
 * this page is only ever rendered for a campaign that already resolved publicly — so the two
 * agree. The team's own view of an unlaunched campaign's list is the editor's read, which
 * carries a bearer token and lives in `lib/projects/api.ts`.
 *
 * <h2>Why the read is here rather than in `lib/api/server.ts`</h2>
 *
 * The same reason `lib/community/updates.ts` gives: that module is shared ground on this
 * branch, several agents are adding public reads to it at once, and several sets of hands in
 * one file is how two of them end up with two spellings of the same helper. Folding these
 * back into it is a tidy-up with no behaviour in it.
 */

/*
 * The shape, `CAMPAIGN_FAQ_LIMIT` and `readFaqList` are `@ideanest/campaign/faqs` since #155,
 * so the app's FAQ tab reads the same list. Re-exported under the same names.
 */
export { CAMPAIGN_FAQ_LIMIT, readFaqList, type CampaignFaq } from '@ideanest/campaign/faqs';

/** A minute, matching `lib/api/server.ts` and the service's own `Cache-Control`. */
const PUBLIC_READ_REVALIDATE_SECONDS = 60;

/**
 * A campaign's questions and answers, or `null` when the service refused.
 *
 * <strong>`null` rather than an empty list</strong>, for the reason `fetchProjectUpdates`
 * gives about updates and `fetchPublicRewards` gives about tiers: an empty list is a campaign
 * that has answered nothing, which is a real and different thing, and a tab that could not
 * tell them apart would print "this campaign has not answered anything yet" over a service
 * that was merely restarting. That distinction is the whole reason the tab was worth waiting
 * for an endpoint.
 */
export async function fetchProjectFaqs(
  projectId: string,
  options: ServerReadOptions = {},
): Promise<readonly CampaignFaq[] | null> {
  const baseUrl = apiOrigin(options.env);
  const client =
    options.fetchImpl === undefined
      ? createApiClient({ baseUrl })
      : createApiClient({ baseUrl, fetch: options.fetchImpl });

  try {
    const body = await client.get('/v1/projects/{projectId}/faqs', {
      path: { projectId },
      ...(options.locale === undefined ? {} : { headers: { 'accept-language': options.locale } }),
      // #127. The service names the campaign when a comment, an update or a question
      // moves; without the tag this list is only ever as fresh as the window above.
      next: {
        revalidate: options.revalidateSeconds ?? PUBLIC_READ_REVALIDATE_SECONDS,
        tags: [project(projectId)],
      },
    });
    return readFaqList(body);
  } catch (cause) {
    /*
     * The same two-case rule `lib/api/server.ts` argues: a refusal the service made is an
     * answer this tab can render, and a `TypeError` from an unreachable service is the one
     * non-refusal a public page still has to survive. Anything else is a bug and is allowed
     * to surface rather than becoming a campaign that has quietly stopped answering anything.
     */
    if (cause instanceof ApiError || cause instanceof TypeError) return null;
    throw cause;
  }
}
