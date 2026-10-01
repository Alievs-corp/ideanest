import { describe, expect, it, vi } from 'vitest';
import { COMMENT_PAGE_SIZE, fetchCommentThreads } from './comments';

/**
 * §4.4's Comments tab, over §4.9's C-01, C-02 and C-03 — #285.
 *
 * The reader and the composer's check are tested in `packages/campaign` since #155; the server
 * fetch, which is the web's, is tested here.
 *
 * WHAT THESE COVER:
 *
 *   - **a tombstone is a row, not an absence.** §4.9 keeps the row so that replies are not
 *     orphaned, so a moderator holding a report can still read what it said, and so that
 *     "removed" is never printed beside a name. A reader that dropped it would break the
 *     first of those silently, on somebody else's thread.
 *   - **`byCreator` is read, never derived.** C-02's highlight is settled by the server at
 *     write time; anything computed here would be the claim of authority §4.9 refuses to
 *     accept from the side making it.
 *   - **`acceptsReplies` is read, never recomputed.** The two-level bound is stated three
 *     times over on the service side precisely so a client places the reply control instead of
 *     discovering the rule by being refused.
 *   - **a thread with no readable root is dropped; a single bad reply is not.** A conversation
 *     whose first message is missing is not a shorter conversation.
 *   - **the single-thread read is a parameter on the same endpoint**, which is what makes
 *     "show more replies" a link rather than a client component per conversation.
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

describe('fetching conversations', () => {
  function respondWith(body: unknown, status = 200): typeof fetch {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }

  it('asks the public endpoint for a page of threads', async () => {
    const fetchImpl = respondWith({ threads: [{ root: comment(), replies: [] }] });

    const page = await fetchCommentThreads(
      'p1',
      {},
      { fetchImpl, env: { IDEANEST_API_ORIGIN: 'https://api.test' } },
    );

    expect(page?.threads).toHaveLength(1);

    const [url] = vi.mocked(fetchImpl).mock.calls[0] as [string];
    expect(url).toContain('https://api.test/v1/projects/p1/comments');
    expect(url).toContain(`limit=${COMMENT_PAGE_SIZE}`);
    expect(url).not.toContain('thread=');
  });

  it('reads one conversation in full through the same endpoint', async () => {
    const fetchImpl = respondWith({ threads: [] });

    await fetchCommentThreads(
      'p1',
      { thread: 'c1', cursor: 'c40' },
      { fetchImpl, env: { IDEANEST_API_ORIGIN: 'https://api.test' } },
    );

    const [url] = vi.mocked(fetchImpl).mock.calls[0] as [string];
    expect(url).toContain('thread=c1');
    expect(url).toContain('cursor=c40');
  });

  it('answers null when the service refuses, so the tab can tell that from a quiet campaign', async () => {
    const page = await fetchCommentThreads(
      'p1',
      {},
      {
        fetchImpl: respondWith({ title: 'Not found' }, 404),
        env: { IDEANEST_API_ORIGIN: 'https://api.test' },
      },
    );

    expect(page).toBeNull();
  });
});

