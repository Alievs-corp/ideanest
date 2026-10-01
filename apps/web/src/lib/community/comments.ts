import { ApiError, createApiClient } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { ServerReadOptions } from '../api/server';
import { apiOrigin } from '../seo/metadata-source';
import { project } from '../cache/tags';
import {
  COMMENT_PAGE_SIZE,
  readComment,
  readCommentPage,
  type CampaignComment,
  type CampaignCommentPage,
  type CommentPageLocation,
} from '@ideanest/campaign/comments';

/**
 * §4.4's Comments tab — §4.9's C-01, C-02 and C-03, behind the community module's endpoints.
 *
 * <h2>The list is read on the server; the writes are the browser's</h2>
 *
 * `GET /v1/projects/{projectId}/comments` is `permitAll`, and a conversation under a
 * campaign is public content that a search engine and a link unfurler are entitled to. So
 * the read happens in the Server Component, in the initial HTML, like the story above it.
 *
 * The three writes cannot be. Each needs the caller's bearer token, and §4.9's rule that
 * `by_creator` is settled by the server at write time means the client has nothing to decide
 * — it posts a body and re-reads. They go through `authorizedFetch`, which is the browser's
 * path and the only one that carries a session.
 *
 * <strong>Both halves live in one module on purpose.</strong> The alternative — a
 * `comments.server.ts` and a `comments.client.ts` — would need the wire shapes declared in a
 * third file to avoid a copy, and the copy is the thing that goes wrong: a reader that
 * forgets `deleted` renders a tombstone as a blank comment. The cost is that a bundler has
 * to tree-shake `fetchCommentThreads` out of the browser build, which it can: the module has
 * no top-level side effects and every export is a function.
 *
 * <h2>Two levels, and the client places the control rather than discovering the rule</h2>
 *
 * §4.9: a reply answers a root, a reply to a reply is a 422, and every row carries
 * `acceptsReplies` so that a client puts the reply control where a reply is allowed instead
 * of finding out by being refused. That flag is read below and it is what the reply control
 * keys on — never `depth === 0` recomputed here, which would be a second copy of the bound
 * that the day it disagreed would offer somebody a form the server was going to reject.
 *
 * <h2>A tombstone is a row, not an absence</h2>
 *
 * §4.9: deleting a comment sets `deleted_at` and the read serves `body: null`,
 * `authorId: null`, `deleted: true`. The row stays because replies must not be orphaned,
 * because a moderator holding a report has to be able to read what it said, and because
 * "removed" printed beside a name is an accusation published to everybody on the page.
 * {@link CampaignComment.deleted} is therefore a first-class field here and the component
 * renders it as a tombstone — dropping the row would break the first of those three and
 * silently renumber a conversation somebody screenshotted.
 *
 * <h2>The wire is shared</h2>
 *
 * The shapes, `COMMENT_PAGE_SIZE`, `readCommentPage` and `isSubmittableComment` are
 * `@ideanest/campaign/comments` since #155, so the app reads a page of conversations the way
 * this tab does. They are re-exported below under the same names; the fetch and the three
 * writes stay here.
 *
 * <h2>Why the read is here rather than in `lib/api/server.ts`</h2>
 *
 * `lib/community/updates.ts` gives the argument in full: same conventions, different file,
 * because that module is shared ground in this branch and this one is not.
 */

export {
  COMMENT_PAGE_SIZE,
  isSubmittableComment,
  readCommentPage,
  type CampaignComment,
  type CampaignCommentPage,
  type CampaignCommentThread,
  type CommentPageLocation,
} from '@ideanest/campaign/comments';

/** A minute, matching `lib/api/server.ts` and the service's own `Cache-Control`. */
const PUBLIC_READ_REVALIDATE_SECONDS = 60;

/**
 * One page of a campaign's conversations, or `null` when the service refused.
 *
 * `null` rather than an empty page, for the reason the reward list gives: a campaign nobody
 * has commented on is a real and different thing from a service that could not be reached,
 * and a tab that could not tell them apart would print "nobody has commented" over an
 * outage.
 *
 * <strong>The server read is anonymous.</strong> `lib/api/server.ts` argues why at length,
 * and the service's own controller says the cost is nil here: a comment has no
 * backers-only variant and no scheduling, so the campaign's team is served the same page as
 * a visitor and the body is shareable. The one thing a token would add on this endpoint is
 * reading the comments under a campaign that is not public yet, which is the creator's
 * dashboard rather than this page.
 */
export async function fetchCommentThreads(
  projectId: string,
  location: CommentPageLocation = {},
  options: ServerReadOptions = {},
): Promise<CampaignCommentPage | null> {
  const baseUrl = apiOrigin(options.env);
  const client =
    options.fetchImpl === undefined
      ? createApiClient({ baseUrl })
      : createApiClient({ baseUrl, fetch: options.fetchImpl });

  const { cursor, thread } = location;

  try {
    const body = await client.get('/v1/projects/{projectId}/comments', {
      path: { projectId },
      query: {
        limit: COMMENT_PAGE_SIZE,
        ...(thread == null ? {} : { thread }),
        ...(cursor == null ? {} : { cursor }),
      },
      ...(options.locale === undefined ? {} : { headers: { 'accept-language': options.locale } }),
      // #127. The service names the campaign when a comment, an update or a question
      // moves; without the tag this list is only ever as fresh as the window above.
      next: {
        revalidate: options.revalidateSeconds ?? PUBLIC_READ_REVALIDATE_SECONDS,
        tags: [project(projectId)],
      },
    });
    return readCommentPage(body);
  } catch (cause) {
    // The two-case rule `lib/api/server.ts` argues: a refusal is an answer, an unreachable
    // service is the failure a public page survives, anything else is a bug worth surfacing.
    if (cause instanceof ApiError || cause instanceof TypeError) return null;
    throw cause;
  }
}

/* -------------------------------------------------------------------------
 * The three writes — the browser's half
 *
 * All three need a session, and §4.9 gives the reason it is a mechanism rather than
 * friction: who may comment is "backers of that project and its creator", enforced today as
 * far as "a signed-in account in good standing", and the duplicate suppression the whole
 * feature rests on is unstateable without an identity. So `authorizedFetch`, which throws a
 * 401 when there is no token, is the right shape — a composer is never offered to somebody
 * who has no session, and `ReportControl` argues that same point for its own form.
 *
 * NONE OF THEM RETURNS THE NEW LIST, and the callers do not build one. The component calls
 * `router.refresh()` afterwards and the server re-renders the page it already knows how to
 * render. Splicing the new comment into local state would be a second, client-side
 * implementation of thread ordering, reply nesting and the creator highlight — three things
 * §4.9 settles on the server precisely so that a client cannot get them wrong.
 * ---------------------------------------------------------------------- */

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** §4.9's C-01 — a new conversation. `POST /v1/projects/{projectId}/comments`. */
export async function postComment(projectId: string, body: string): Promise<CampaignComment | null> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/comments`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw await errorFrom(response);
  return readComment(await response.json());
}

/**
 * §4.9's C-03 — an answer to a root. `POST /v1/comments/{commentId}/reply`.
 *
 * Addressed by the comment being answered rather than by the campaign, which is what makes
 * the two-level bound checkable in one query on the server side: the parent's depth is on
 * the row the path names.
 */
export async function replyToComment(commentId: string, body: string): Promise<CampaignComment | null> {
  const response = await authorizedFetch(`/v1/comments/${encodeURIComponent(commentId)}/reply`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw await errorFrom(response);
  return readComment(await response.json());
}

/**
 * Withdraws a comment — `DELETE /v1/comments/{commentId}`.
 *
 * <strong>Not a removal, and the interface must not call it one.</strong> §4.9: the row
 * stays, its body stays, and the read serves a tombstone. It is idempotent, so a retry
 * cannot rewrite who removed it, and it spends none of the comment rate limit — a creator
 * clearing a flood must not be stopped part way through by the control that exists to stop
 * the flood.
 *
 * There is no edit endpoint, deliberately (§4.9), so this is the whole of "I take that
 * back".
 */
export async function deleteComment(commentId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await errorFrom(response);
}
