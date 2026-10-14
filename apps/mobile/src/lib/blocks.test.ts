import { ApiError } from '@ideanest/api-client';
import type { CampaignComment, CampaignCommentThread } from '@ideanest/campaign/comments';
import { blockFailureOf, withoutBlocked } from './blocks';

/**
 * #324 — the two pure halves of blocking in the app: what the Comments tab leaves out, and which
 * sentence a failed block shows.
 */

function comment(id: string, authorId: string | null, parentId: string | null = null): CampaignComment {
  return {
    id,
    threadId: parentId ?? id,
    parentId,
    authorId,
    author: null,
    body: authorId === null ? null : `Comment ${id}`,
    byCreator: false,
    deleted: authorId === null,
    depth: parentId === null ? 0 : 1,
    createdAt: '2026-10-01T09:00:00Z',
    acceptsReplies: parentId === null,
  };
}

function thread(root: CampaignComment, replies: CampaignComment[] = []): CampaignCommentThread {
  return { root, replies, nextReplyCursor: null };
}

describe('withoutBlocked', () => {
  const threads = [
    thread(comment('a', 'blocked'), [comment('a1', 'other', 'a')]),
    thread(comment('b', 'other'), [comment('b1', 'blocked', 'b'), comment('b2', 'other', 'b')]),
    thread(comment('c', null), [comment('c1', 'other', 'c')]),
  ];

  it('leaves out a blocked account’s conversation whole and each of its replies alone', () => {
    const kept = withoutBlocked(threads, new Set(['blocked']));
    expect(kept.map((t) => t.root.id)).toEqual(['b', 'c']);
    expect(kept[0]?.replies.map((r) => r.id)).toEqual(['b2']);
  });

  it('keeps a tombstone, which names nobody', () => {
    expect(withoutBlocked(threads, new Set(['blocked'])).some((t) => t.root.id === 'c')).toBe(true);
  });

  it('returns the same list when nobody is blocked', () => {
    expect(withoutBlocked(threads, new Set())).toBe(threads);
  });
});

describe('blockFailureOf', () => {
  it.each([
    ['CANNOT_BLOCK_STAFF', 'staff'],
    ['CANNOT_BLOCK_YOURSELF', 'self'],
    ['ANYTHING_ELSE', 'refused'],
  ])('reads %s by its code', (code, expected) => {
    expect(blockFailureOf(new ApiError(422, { code, detail: 'English prose' }))).toBe(expected);
  });

  it('tells an unreachable service apart from a refusal', () => {
    expect(blockFailureOf(new TypeError('Network request failed'))).toBe('unreachable');
  });
});
