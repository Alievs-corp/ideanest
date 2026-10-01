import { ApiError } from '@ideanest/api-client';
import type { CampaignComment, CampaignCommentPage } from '@ideanest/campaign/comments';
import {
  conversationOf,
  nextCursorOf,
  postFailureOf,
  retryMinutes,
  threadsOf,
  withdrawFailureOf,
} from './comments';
import { reportFailureOf } from './report';

/**
 * The Comments tab's pure half (#155): which sentence a refused post becomes, and how appended
 * pages merge without a row appearing twice.
 */

function comment(id: string, overrides: Partial<CampaignComment> = {}): CampaignComment {
  return {
    id,
    threadId: id,
    parentId: null,
    authorId: 'author-1',
    body: `Body of ${id}`,
    byCreator: false,
    deleted: false,
    depth: 0,
    createdAt: '2026-09-01T10:00:00Z',
    acceptsReplies: true,
    ...overrides,
  };
}

const reply = (id: string, root: string) =>
  comment(id, { threadId: root, parentId: root, depth: 1, acceptsReplies: false });

describe('postFailureOf', () => {
  it('reads a 429 with 150 seconds as about 3 minutes — rounded up, never down', () => {
    expect(postFailureOf(new ApiError(429, { status: 429, retryAfterSeconds: 150 }))).toEqual({
      kind: 'rateLimitedFor',
      minutes: 3,
    });
    expect(retryMinutes(60)).toBe(1);
    expect(retryMinutes(61)).toBe(2);
  });

  it('reads a 429 that does not say how long as the general sentence', () => {
    expect(postFailureOf(new ApiError(429, { status: 429 }))).toEqual({ kind: 'rateLimited' });
  });

  it('reads a 401 as an expired session, whatever the body says', () => {
    expect(postFailureOf(new ApiError(401, { status: 401, detail: 'Nope' }))).toEqual({
      kind: 'sessionExpired',
    });
  });

  it("keeps the service's own sentence for any other refusal, and falls back without one", () => {
    expect(postFailureOf(new ApiError(422, { status: 422, detail: 'Too deep.' }))).toEqual({
      kind: 'detail',
      text: 'Too deep.',
    });
    expect(postFailureOf(new ApiError(500, null))).toEqual({ kind: 'notPosted' });
  });

  it('reads no answer at all as unreachable', () => {
    expect(postFailureOf(new TypeError('Network request failed'))).toEqual({
      kind: 'unreachable',
    });
  });
});

describe('withdrawFailureOf and reportFailureOf', () => {
  it("use the service's sentence, then their own, then unreachable", () => {
    expect(withdrawFailureOf(new ApiError(403, { status: 403, title: 'Not yours' }))).toEqual({
      kind: 'detail',
      text: 'Not yours',
    });
    expect(withdrawFailureOf(new ApiError(500, null))).toEqual({ kind: 'notWithdrawn' });
    expect(withdrawFailureOf(new Error('offline'))).toEqual({ kind: 'unreachable' });

    expect(reportFailureOf(new ApiError(429, { status: 429, detail: 'Slow down.' }))).toEqual({
      kind: 'detail',
      text: 'Slow down.',
    });
    expect(reportFailureOf(new ApiError(500, null))).toEqual({ kind: 'refused' });
    expect(reportFailureOf(new Error('offline'))).toEqual({ kind: 'unreachable' });
  });
});

describe('merging pages', () => {
  it("keeps the tab's conversations in the service's order, each root once", () => {
    const first: CampaignCommentPage = {
      threads: [
        { root: comment('c3'), replies: [], nextReplyCursor: null },
        { root: comment('c2'), replies: [], nextReplyCursor: null },
      ],
      nextCursor: 'c2',
    };
    const second: CampaignCommentPage = {
      threads: [
        // A root the first page already carried is not drawn twice.
        { root: comment('c2'), replies: [], nextReplyCursor: null },
        { root: comment('c1'), replies: [], nextReplyCursor: null },
      ],
      nextCursor: null,
    };
    expect(threadsOf([first, second]).map((thread) => thread.root.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it("joins one conversation's pages of replies after its root, oldest first, each once", () => {
    const root = comment('r');
    const pages: CampaignCommentPage[] = [
      { threads: [{ root, replies: [reply('a', 'r'), reply('b', 'r')], nextReplyCursor: 'b' }], nextCursor: null },
      { threads: [{ root, replies: [reply('b', 'r'), reply('c', 'r')], nextReplyCursor: null }], nextCursor: null },
    ];
    const conversation = conversationOf(pages);
    expect(conversation?.root.id).toBe('r');
    expect(conversation?.replies.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(conversationOf([{ threads: [], nextCursor: null }])).toBeNull();
  });

  it("pages the tab by nextCursor and one conversation by that thread's nextReplyCursor", () => {
    const page: CampaignCommentPage = {
      threads: [{ root: comment('r'), replies: [], nextReplyCursor: 'reply-cursor' }],
      nextCursor: 'tab-cursor',
    };
    expect(nextCursorOf(page, null)).toBe('tab-cursor');
    expect(nextCursorOf(page, 'r')).toBe('reply-cursor');
    expect(nextCursorOf({ threads: [], nextCursor: null }, null)).toBeUndefined();
    expect(nextCursorOf({ threads: [], nextCursor: null }, 'r')).toBeUndefined();
  });
});
