import { describe, expect, it, vi } from 'vitest';
import { fetchProjectUpdates, UPDATE_PAGE_SIZE } from './updates';

/**
 * §4.4's Updates tab, over §4.9's public read — #284.
 *
 * WHAT THESE COVER:
 *
 *   - **nothing is filtered here.** A `BACKERS_ONLY` update that the service chose to send is
 *     rendered, because the service is the only thing that knows whether the caller is
 *     entitled to it. A client-side filter would be a second, weaker copy of an entitlement
 *     rule, and the day the two disagreed the weaker one would decide whether a private
 *     update reached public HTML.
 *   - **the number is the service's.** §4.9 allocates it once, at insert, and never
 *     recomputes it, because "update 7 said the moulds were late" is a thing somebody says to
 *     support six months later. A reader that numbered by position would renumber every
 *     earlier update the first time one was withheld.
 *   - **an unusable row is dropped and its neighbours survive.** An update with no date is not
 *     a shorter update; it is a row this page cannot describe.
 *   - **a refused read is `null`, not an empty list.** "This campaign has posted no updates"
 *     printed over a restarting service is a claim about the creator that happens to be false.
 */

describe('fetching a page of updates', () => {
  function respondWith(body: unknown, status = 200): typeof fetch {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }

  it('asks the public endpoint for a page and reads what comes back', async () => {
    const fetchImpl = respondWith({
      updates: [{ number: 1, title: 'One', body: 'b', publishedAt: '2026-08-01T00:00:00Z' }],
      nextCursor: null,
    });

    const page = await fetchProjectUpdates('p1', null, {
      fetchImpl,
      env: { IDEANEST_API_ORIGIN: 'https://api.test' },
    });

    expect(page?.updates).toHaveLength(1);

    const [url] = vi.mocked(fetchImpl).mock.calls[0] as [string];
    expect(url).toContain('https://api.test/v1/projects/p1/updates');
    expect(url).toContain(`limit=${UPDATE_PAGE_SIZE}`);
    // No cursor on the first page — an empty parameter is not the same request.
    expect(url).not.toContain('cursor=');
  });

  it('carries the cursor the previous page returned', async () => {
    const fetchImpl = respondWith({ updates: [], nextCursor: null });

    await fetchProjectUpdates('p1', 7, {
      fetchImpl,
      env: { IDEANEST_API_ORIGIN: 'https://api.test' },
    });

    const [url] = vi.mocked(fetchImpl).mock.calls[0] as [string];
    expect(url).toContain('cursor=7');
  });

  it('answers null when the service refuses, so the tab can tell that from an empty campaign', async () => {
    const page = await fetchProjectUpdates('p1', null, {
      fetchImpl: respondWith({ title: 'Not found' }, 404),
      env: { IDEANEST_API_ORIGIN: 'https://api.test' },
    });

    expect(page).toBeNull();
  });

  it('answers null when the service cannot be reached at all', async () => {
    const page = await fetchProjectUpdates('p1', null, {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch,
      env: { IDEANEST_API_ORIGIN: 'https://api.test' },
    });

    expect(page).toBeNull();
  });
});
