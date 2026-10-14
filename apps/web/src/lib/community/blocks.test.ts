import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/problem';
import { blockControlCopyFrom } from '../i18n/block-copy';
import { translatorFor } from '../../test-copy';
import {
  blockAccount,
  blockBySlug,
  blockFailureMessage,
  blockedIds,
  isBlocked,
  listBlocked,
  unblockAccount,
  unblockBySlug,
} from './blocks';

/**
 * §4.9's C-08 — issue #324.
 *
 * WHAT THESE COVER:
 *
 *   - **a comment blocks by id and a profile by slug**, because those are what each holds; the
 *     settings list unblocks by id.
 *   - **the comments tab reads every id the reader blocked**, following the cursor page by page
 *     and stopping at the bound rather than looping for ever.
 *   - **the two refusals a person can meet are said in the catalogue**, by `code`, never by the
 *     service's English prose.
 */

const COPY = blockControlCopyFrom(translatorFor('blocking'));
const originalFetch = globalThis.fetch;

function respond(...bodies: unknown[]) {
  const send = vi.fn(async (_path: string, _init?: RequestInit) => {
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', send);
  return send;
}

function pathOf(send: ReturnType<typeof respond>, call = 0): string {
  return String(send.mock.calls[call]?.[0]);
}

function methodOf(send: ReturnType<typeof respond>, call = 0): string | undefined {
  return send.mock.calls[call]?.[1]?.method;
}

beforeEach(() => setAccessToken('a-token'));
afterEach(() => {
  setAccessToken(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('the writes', () => {
  it('blocks and unblocks a comment author by account id', async () => {
    const send = respond({ blocked: true });

    await blockAccount('a b');
    await unblockAccount('a b');

    expect(pathOf(send, 0)).toMatch(/\/v1\/me\/blocks\/a%20b$/u);
    expect(methodOf(send, 0)).toBe('POST');
    expect(pathOf(send, 1)).toMatch(/\/v1\/me\/blocks\/a%20b$/u);
    expect(methodOf(send, 1)).toBe('DELETE');
  });

  it('blocks from a profile by slug, and answers the state the service reports', async () => {
    const send = respond({ blocked: true }, { blocked: false }, { blocked: true });

    expect(await blockBySlug('aysel')).toBe(true);
    expect(await unblockBySlug('aysel')).toBe(false);
    expect(await isBlocked('aysel')).toBe(true);

    expect(pathOf(send, 0)).toMatch(/\/v1\/users\/aysel\/block$/u);
    expect(methodOf(send, 0)).toBe('POST');
    expect(methodOf(send, 1)).toBe('DELETE');
    expect(methodOf(send, 2)).toBeUndefined();
  });
});

describe('the list', () => {
  it('passes the cursor back unread and reads an absent avatar as null', async () => {
    const send = respond({
      items: [{ userId: 'u1', name: 'Aysel', slug: 'aysel', blockedAt: '2026-10-01T09:00:00Z' }],
      nextCursor: 'opaque',
    });

    const page = await listBlocked('previous');

    expect(pathOf(send)).toContain('cursor=previous');
    expect(page.nextCursor).toBe('opaque');
    expect(page.items[0]).toEqual({
      userId: 'u1',
      name: 'Aysel',
      slug: 'aysel',
      avatarUrl: null,
      blockedAt: '2026-10-01T09:00:00Z',
    });
  });

  it('collects every blocked id across pages for the comments tab', async () => {
    const send = respond(
      { items: [{ userId: 'u1', slug: 'a' }], nextCursor: 'next' },
      { items: [{ userId: 'u2', slug: 'b' }], nextCursor: null },
    );

    const ids = await blockedIds();

    expect([...ids]).toEqual(['u1', 'u2']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(pathOf(send, 1)).toContain('cursor=next');
  });

  it('stops after a bounded number of pages rather than following a cursor for ever', async () => {
    const send = respond({ items: [{ userId: 'u1', slug: 'a' }], nextCursor: 'again' });

    await blockedIds();

    expect(send).toHaveBeenCalledTimes(10);
  });
});

describe('blockFailureMessage', () => {
  it.each([
    ['CANNOT_BLOCK_STAFF', COPY.failures.staff],
    ['CANNOT_BLOCK_YOURSELF', COPY.failures.self],
    ['SOMETHING_ELSE', COPY.failures.refused],
  ])('says %s in the catalogue’s words', (code, expected) => {
    const cause = new ApiError(422, { code, detail: 'The service’s English.' });
    expect(blockFailureMessage(cause, COPY.failures)).toBe(expected);
  });

  it('tells an unreachable service apart from a refusal', () => {
    expect(blockFailureMessage(new TypeError('Failed to fetch'), COPY.failures)).toBe(
      COPY.failures.unreachable,
    );
  });
});
