import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { submitReport } from './report';

/**
 * §4.9's C-06 and C-07 — issue #286.
 *
 * The vocabulary and the body builder are tested in `packages/campaign` since #155; what is here
 * is the request this page sends with them.
 *
 * WHAT THESE COVER:
 *
 *   - **each target goes to its own path.** Three endpoints share one rate-limit budget on the
 *     service, and a client that sent a comment report to the campaign path would file a
 *     complaint against the wrong object — which a moderator cannot tell from a genuine one.
 *   - the reasons this screen offers are exactly the taxonomy the queue reads back, so a
 *     reporter and a moderator are looking at the same nine values — the same nine CATALOGUE
 *     KEYS since #85, rather than two tables a test held level.
 *   - `OTHER` is the one reason that needs a sentence, because it is the one a moderator
 *     cannot act on without one.
 *   - an empty detail is omitted rather than sent as `""`.
 */

const originalFetch = globalThis.fetch;

function accept(): ReturnType<typeof vi.fn> {
  const send = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: 'report-1',
          target: { type: 'PROJECT', id: 'p1' },
          reason: 'SPAM',
          state: 'OPEN',
          createdAt: '2026-08-23T09:00:00Z',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
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

describe('submitReport', () => {
  it('sends each target to its own endpoint', async () => {
    const send = accept();

    await submitReport({ kind: 'campaign', id: 'p1' }, 'SPAM', '');
    await submitReport({ kind: 'account', slug: 'ayan q' }, 'SPAM', '');
    await submitReport({ kind: 'comment', id: 'c1' }, 'SPAM', '');

    expect(send.mock.calls.map((call) => call[0])).toEqual([
      '/v1/projects/p1/report',
      // By slug, escaped — #143. The profile carries no account id.
      '/v1/users/ayan%20q/report',
      '/v1/comments/c1/report',
    ]);
  });

  it('omits an empty detail rather than sending an empty string', async () => {
    const send = accept();

    await submitReport({ kind: 'campaign', id: 'p1' }, 'FRAUD', '   ');

    const [, init] = send.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'FRAUD' });
  });

  it('trims the detail it does send', async () => {
    const send = accept();

    await submitReport({ kind: 'comment', id: 'c1' }, 'OTHER', '  they posted my address  ');

    const [, init] = send.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      reason: 'OTHER',
      detail: 'they posted my address',
    });
  });

  it('escapes an identifier rather than pasting it into the path', async () => {
    const send = accept();

    await submitReport({ kind: 'campaign', id: 'p 1/../admin' }, 'SPAM', '');

    expect(send.mock.calls[0]?.[0]).toBe('/v1/projects/p%201%2F..%2Fadmin/report');
  });
});
