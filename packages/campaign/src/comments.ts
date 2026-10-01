/**
 * §4.4's Comments tab — §4.9's C-01, C-02 and C-03 — as a page of the public read narrows.
 *
 * <h2>Only the wire, and why</h2>
 *
 * This is the half of `apps/web/src/lib/community/comments.ts` with nothing web-only in it: the
 * shapes, the page size, the reader that narrows the response, and the one check a composer
 * makes before sending. It moved here with #155 so the app's Comments tab keeps a tombstone as a
 * row and drops an unreadable reply exactly as the web does. How a request is sent — the web's
 * cached server read and `authorizedFetch` writes, the app's typed client — is the part that
 * genuinely differs, and it stays with each client.
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
 * {@link CampaignComment.deleted} is therefore a first-class field here and both clients
 * render it as a tombstone.
 */

/**
 * One comment, as the public read serves it.
 *
 * `body` and `authorId` are nullable because a tombstone has neither — that is the shape
 * §4.9 specifies, and typing them non-null with an empty-string fallback would let a
 * component print an empty quotation mark where a removal notice belongs.
 */
export interface CampaignComment {
  readonly id: string;
  /** The root this belongs under. A root's own identifier for a root. */
  readonly threadId: string;
  /** `null` for a root. */
  readonly parentId: string | null;
  /** `null` on a tombstone, and on nothing else. */
  readonly authorId: string | null;
  /** `null` on a tombstone. */
  readonly body: string | null;
  /** §4.9's C-02, decided by the server at write time and never by the request body. */
  readonly byCreator: boolean;
  readonly deleted: boolean;
  /** `0` for a root, `1` for a reply. The bound is structural — see the module comment. */
  readonly depth: number;
  /** ISO-8601 instant, UTC. */
  readonly createdAt: string;
  /** Whether the service would accept a reply to this row. Read, never recomputed. */
  readonly acceptsReplies: boolean;
}

export interface CampaignCommentThread {
  readonly root: CampaignComment;
  readonly replies: readonly CampaignComment[];
  /** More replies under this root than the page carried, or `null`. Opaque; never parsed. */
  readonly nextReplyCursor: string | null;
}

export interface CampaignCommentPage {
  readonly threads: readonly CampaignCommentThread[];
  /** The next page of conversations, or `null` on the last. Opaque; never parsed. */
  readonly nextCursor: string | null;
}

/**
 * How many conversations one page asks for.
 *
 * Smaller than the updates page, because a thread is a root plus its replies rather than one
 * row: ten conversations is already a long tab, and the service decides how many replies
 * come with each.
 */
export const COMMENT_PAGE_SIZE = 10;

/**
 * Which part of a campaign's conversations to read.
 *
 * <strong>Two reads on one route, which is the service's design and not this module's.</strong>
 * Without `thread` the endpoint answers the tab: a page of conversations, each with a preview
 * of its replies. With it, one conversation and a page of that conversation's replies — which
 * is what "show more replies" asks for. `PublicCommentController` argues why it is a
 * parameter rather than a second route, and a second function here would be a second place to
 * keep that in step.
 */
export interface CommentPageLocation {
  /** The `nextCursor` (or `nextReplyCursor`) from the previous read. Opaque; never parsed. */
  readonly cursor?: string | null | undefined;
  /** A root comment's identifier, to read that one conversation in full. */
  readonly thread?: string | null | undefined;
}

const EMPTY_PAGE: CampaignCommentPage = Object.freeze({ threads: [], nextCursor: null });

/**
 * The wire body, narrowed.
 *
 * A thread with no readable root is dropped: the replies under it hang off nothing this page
 * could render, and a conversation whose first message is missing is not a shorter
 * conversation. A single unreadable <em>reply</em> is dropped on its own and the rest of its
 * thread survives, because the conversation is still a conversation without it.
 *
 * Both clients call it on the body of `GET /v1/projects/{projectId}/comments`: the web from its
 * server fetch, the app from its typed client.
 */
export function readCommentPage(body: unknown): CampaignCommentPage {
  if (body === null || typeof body !== 'object') return EMPTY_PAGE;

  const source = body as Record<string, unknown>;
  const rows = source['threads'];

  const threads: CampaignCommentThread[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows as readonly unknown[]) {
      const thread = readThread(row);
      if (thread !== null) threads.push(thread);
    }
  }

  return { threads, nextCursor: text(source['nextCursor']) };
}

function readThread(value: unknown): CampaignCommentThread | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const root = readComment(source['root']);
  if (root === null) return null;

  const replies: CampaignComment[] = [];
  const rows = source['replies'];
  if (Array.isArray(rows)) {
    for (const row of rows as readonly unknown[]) {
      const reply = readComment(row);
      if (reply !== null) replies.push(reply);
    }
  }

  return { root, replies, nextReplyCursor: text(source['nextReplyCursor']) };
}

/**
 * One row, or `null` when it is not one a page can render. Exported for the writes, which
 * answer with the row they created.
 */
export function readComment(value: unknown): CampaignComment | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const id = text(source['id']);
  const createdAt = text(source['createdAt']);
  if (id === null || createdAt === null) return null;

  const deleted = source['deleted'] === true;
  const body = text(source['body']);

  /*
   * A row with neither a body nor a deletion flag is not renderable. The service sends one
   * or the other on every row it serves, so this is a malformed response rather than an
   * empty comment — and printing a blank speech bubble under somebody's campaign is worse
   * than printing nothing.
   */
  if (!deleted && body === null) return null;

  return {
    id,
    // A root heads its own thread, which is what the service stores, so an absent
    // `threadId` falls back to the row's own identifier rather than disqualifying it.
    threadId: text(source['threadId']) ?? id,
    parentId: text(source['parentId']),
    authorId: text(source['authorId']),
    body: deleted ? null : body,
    byCreator: source['byCreator'] === true,
    deleted,
    depth: typeof source['depth'] === 'number' ? (source['depth'] as number) : 0,
    createdAt,
    acceptsReplies: source['acceptsReplies'] === true,
  };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Whether a body is worth sending.
 *
 * <strong>A friendliness, not a rule this module owns.</strong> The service stores the body
 * on a `not null` column and §10.2 publishes no length bound, so this refuses only the one
 * case that is certainly a mistake — nothing typed at all — and lets the service be the
 * authority on everything else. A client-side maximum invented here would be a limit nobody
 * could find in the contract, refusing a long comment the platform would have accepted.
 */
export function isSubmittableComment(body: string): boolean {
  return body.trim() !== '';
}
