import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import {
  campaignHref,
  followCreator,
  isFollowing,
  listFollowing,
  listSaved,
  unfollowCreator,
  unsaveCampaign,
} from './signals';

/**
 * §4.9's C-10 — issue #288.
 *
 * WHAT THESE COVER:
 *
 *   - **the cursor is passed back unread.** It is a value the service encoded, and a client
 *     that parsed or rebuilt it is a client that breaks the day the encoding changes.
 *   - an absent `nextCursor` is the last page, expressed as `null` rather than as an empty
 *     string a caller would then fetch a page of nothing with.
 *   - the campaign link is §10.2's canonical `/projects/{creatorSlug}/{projectSlug}`, escaped.
 *   - the two removals address their target the way the service does: a campaign by id, a
 *     creator by slug.
 */

const originalFetch = globalThis.fetch;

/*
 * The stub declares its parameters: `vi.fn()` types `mock.calls` from the function it wraps,
 * so a zero-argument stub would give every call the type `[]` and the assertions below could
 * not read a method that is plainly there.
 */
function page(body: unknown, status = 200) {
  const send = vi.fn(
    async (_path: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', send);
  return send;
}

beforeEach(() => setAccessToken('a-token'));
afterEach(() => {
  setAccessToken(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('listSaved', () => {
  it('asks for the first page without a cursor', async () => {
    const send = page({ items: [], nextCursor: null });

    await listSaved();

    const path = String(send.mock.calls[0]?.[0]);
    expect(path.startsWith('/v1/me/saved?')).toBe(true);
    expect(path).not.toContain('cursor=');
  });

  it('sends the cursor back exactly as it was given', async () => {
    const send = page({ items: [], nextCursor: null });
    const opaque = 'eyJzYXZlZEF0IjoiMjAyNi0wOC0yMyJ9';

    await listSaved(opaque);

    expect(String(send.mock.calls[0]?.[0])).toContain(
      `cursor=${encodeURIComponent(opaque)}`,
    );
  });

  it('reads a missing next cursor as the last page', async () => {
    page({ items: [{ projectId: 'p1' }] });
    expect((await listSaved()).nextCursor).toBeNull();
  });

  it('reads a missing items array as an empty page rather than undefined', async () => {
    page({});
    expect((await listSaved()).items).toEqual([]);
  });
});

describe('listFollowing', () => {
  it('reads its own endpoint', async () => {
    const send = page({ items: [], nextCursor: null });
    await listFollowing();
    expect(String(send.mock.calls[0]?.[0]).startsWith('/v1/me/following?')).toBe(true);
  });
});

describe('the removals', () => {
  it('unsaves by campaign identifier and unfollows by slug', async () => {
    // 204 carries no body, and the `Response` constructor refuses one — which is exactly what
    // the service sends here.
    const send = vi.fn(async (_path: string, _init?: RequestInit) =>
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', send);

    await unsaveCampaign('p1');
    await unfollowCreator('aysel-q');

    expect(send.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ['/v1/projects/p1/save', 'DELETE'],
      ['/v1/users/aysel-q/follow', 'DELETE'],
    ]);
  });
});

describe('following — #143', () => {
  it('follows by slug and draws what the service answered', async () => {
    const send = page({ following: true });

    await expect(followCreator('aysel q')).resolves.toBe(true);

    expect(send.mock.calls[0]?.[0]).toBe('/v1/users/aysel%20q/follow');
    expect(send.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('finds a followed creator on a later page, passing the cursor back unread', async () => {
    const pages = [
      { items: [{ creatorId: 'c1', name: 'A', slug: 'a', followedAt: '2026-09-01T00:00:00Z' }], nextCursor: 'opaque' },
      { items: [{ creatorId: 'c2', name: 'B', slug: 'aysel', followedAt: '2026-09-02T00:00:00Z' }], nextCursor: null },
    ];
    const send = vi.fn(async (_path: string, _init?: RequestInit) =>
      new Response(JSON.stringify(pages.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', send);

    await expect(isFollowing('aysel')).resolves.toBe(true);

    const paths = send.mock.calls.map((call) => String(call[0]));
    expect(paths[0]).toBe('/v1/me/following?size=100');
    expect(paths[1]).toBe('/v1/me/following?size=100&cursor=opaque');
  });

  it('answers false at the end of the list', async () => {
    page({ items: [], nextCursor: null });

    await expect(isFollowing('aysel')).resolves.toBe(false);
  });

  it('stops after five pages rather than walking an unbounded list', async () => {
    const send = page({ items: [], nextCursor: 'more' });

    await expect(isFollowing('aysel')).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(5);
  });
});

describe('campaignHref', () => {
  it('is §10.2’s canonical path, with both segments escaped', () => {
    expect(campaignHref({ creatorSlug: 'aysel q', projectSlug: 'a/b' })).toBe(
      '/projects/aysel%20q/a%2Fb',
    );
  });
});
