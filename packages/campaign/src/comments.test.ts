import { describe, expect, it } from 'vitest';
import { COMMENT_PAGE_SIZE, isSubmittableComment, readComment, readCommentPage } from './comments';

/**
 * §4.4's Comments tab, as the public read narrows — #285, shared since #155.
 *
 * WHAT THESE COVER:
 *
 *   - **a tombstone is a row, not an absence.** §4.9 keeps the row so that replies are not
 *     orphaned, so a moderator holding a report can still read what it said, and so that
 *     "removed" is never printed beside a name.
 *   - **`byCreator` and `acceptsReplies` are read, never derived.**
 *   - **a thread with no readable root is dropped; a single bad reply is not.**
 */

function comment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    threadId: 'c1',
    parentId: null,
    authorId: 'u1',
    body: 'Will this ship to Georgia?',
    byCreator: false,
    deleted: false,
    depth: 0,
    createdAt: '2026-08-01T10:00:00Z',
    acceptsReplies: true,
    ...overrides,
  };
}
describe('reading a page of conversations', () => {
  it('keeps a withdrawn comment as a tombstone rather than dropping the row', () => {
    const page = readCommentPage({
      threads: [
        {
          root: comment({ id: 'c1', deleted: true, body: null, authorId: null }),
          replies: [comment({ id: 'c2', parentId: 'c1', depth: 1, acceptsReplies: false })],
        },
      ],
    });

    const root = page.threads[0]?.root;
    expect(root?.deleted).toBe(true);
    expect(root?.body).toBeNull();
    expect(root?.authorId).toBeNull();
    // The reply is still there, which is the whole reason the tombstone exists.
    expect(page.threads[0]?.replies).toHaveLength(1);
  });

  it('reads the creator highlight from the row and never from the depth or the author', () => {
    const page = readCommentPage({
      threads: [
        {
          root: comment({ byCreator: false }),
          replies: [comment({ id: 'c2', depth: 1, byCreator: true })],
        },
      ],
    });

    expect(page.threads[0]?.root.byCreator).toBe(false);
    expect(page.threads[0]?.replies[0]?.byCreator).toBe(true);
  });

  /**
   * A root at depth 0 that the service says takes no more replies — a thread it has closed —
   * must not sprout a reply control because the depth happens to be zero.
   */
  it('reads acceptsReplies from the row rather than inferring it from the depth', () => {
    const page = readCommentPage({
      threads: [{ root: comment({ depth: 0, acceptsReplies: false }), replies: [] }],
    });

    expect(page.threads[0]?.root.depth).toBe(0);
    expect(page.threads[0]?.root.acceptsReplies).toBe(false);
  });

  it('drops a thread whose root cannot be read', () => {
    const page = readCommentPage({
      threads: [
        { root: { id: 'c1' }, replies: [] },
        { root: comment({ id: 'c9' }), replies: [] },
      ],
    });

    expect(page.threads.map((thread) => thread.root.id)).toEqual(['c9']);
  });

  it('drops one unreadable reply and keeps the conversation', () => {
    const page = readCommentPage({
      threads: [
        {
          root: comment(),
          replies: [{ id: 'bad' }, comment({ id: 'c3', depth: 1 })],
        },
      ],
    });

    expect(page.threads[0]?.replies.map((reply) => reply.id)).toEqual(['c3']);
  });

  /**
   * The service sends a body or a deletion flag on every row it serves, so neither is a
   * malformed response rather than an empty comment — and a blank speech bubble under
   * somebody's campaign is worse than nothing.
   */
  it('drops a row that is neither withdrawn nor readable', () => {
    const page = readCommentPage({
      threads: [{ root: comment({ body: null, deleted: false }), replies: [] }],
    });

    expect(page.threads).toEqual([]);
  });

  it('carries the reply cursor, which is what "show more replies" links from', () => {
    const page = readCommentPage({
      threads: [{ root: comment(), replies: [], nextReplyCursor: 'c99' }],
      nextCursor: 'c50',
    });

    expect(page.threads[0]?.nextReplyCursor).toBe('c99');
    expect(page.nextCursor).toBe('c50');
  });

  it('answers an empty page for a body that is not one', () => {
    expect(readCommentPage(undefined).threads).toEqual([]);
    expect(readCommentPage({ threads: 'no' }).nextCursor).toBeNull();
  });
});

describe('reading one row', () => {
  it('reads the row a write answers with', () => {
    expect(readComment(comment())?.id).toBe('c1');
    expect(readComment({ id: 'c1' })).toBeNull();
  });

  it('pages ten conversations at a time', () => {
    expect(COMMENT_PAGE_SIZE).toBe(10);
  });
});

/**
 * Only "something was typed". §10.2 publishes no length bound on a comment body, so a maximum
 * invented on this side would refuse a long comment the platform would have accepted, and
 * nobody could find the rule that refused it.
 */
describe('what the composer will send', () => {
  it('refuses nothing at all and accepts everything else', () => {
    expect(isSubmittableComment('')).toBe(false);
    expect(isSubmittableComment('   \n ')).toBe(false);
    expect(isSubmittableComment('?')).toBe(true);
    expect(isSubmittableComment('x'.repeat(5000))).toBe(true);
  });
});
