import { api, publicApi, saveAccountLocale } from './client';
import {
  hasStoredSession,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from '../lib/session';
import { memoryStore } from '../lib/storage';

/**
 * The session, as every read carries it — §17.1 and §4.12 MB-03.
 *
 * <p>Four properties, and each one is a request somebody would otherwise spend
 * or a session somebody would otherwise lose:
 *
 * <ul>
 *   <li>A cold start refreshes <em>before</em> the first call rather than paying
 *       a guaranteed 401 to discover it has no token.
 *   <li>An expired token is refreshed and the request retried once.
 *   <li>A second 401 is a refusal, not an expiry, and is returned rather than
 *       retried for ever.
 *   <li>A signed-out reader sends no `Authorization` at all — discovery works
 *       without an account, and a header left over from a dead session would be
 *       a credential sent to the service on every public read.
 * </ul>
 */

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersOf(call: number): Headers {
  return new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
}

function urlOf(call: number): string | undefined {
  return fetchMock.mock.calls[call]?.[0];
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  useFlagStore(memoryStore());
  rememberAccessToken(null);
});

it('sends no Authorization when nobody is signed in', async () => {
  fetchMock.mockResolvedValueOnce(json({ items: [] }));

  await api().get('/v1/discover');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(headersOf(0).has('Authorization')).toBe(false);
  // Still negotiated. The service varies four data surfaces on this header.
  expect(headersOf(0).get('Accept-Language')).toBe('az');
});

it('refreshes before the first call on a cold start', async () => {
  await storeRefreshToken('refresh-1');
  fetchMock
    .mockResolvedValueOnce(json({ accessToken: 'access-1', refreshToken: 'refresh-2' }))
    .mockResolvedValueOnce(json({ items: [] }));

  await api().get('/v1/me/saved');

  expect(urlOf(0)).toBe('https://api.test.invalid/v1/auth/refresh');
  expect(headersOf(1).get('Authorization')).toBe('Bearer access-1');
});

it('refreshes and retries once when the token has expired', async () => {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('stale');
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(json({ accessToken: 'fresh', refreshToken: 'refresh-2' }))
    .mockResolvedValueOnce(json({ items: [] }));

  await api().get('/v1/me/saved');

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(headersOf(0).get('Authorization')).toBe('Bearer stale');
  // The retry carries the token the refresh produced. A client that fixed its
  // headers at construction would resend the one that had just been refused.
  expect(headersOf(2).get('Authorization')).toBe('Bearer fresh');
});

it('gives up after one retry rather than looping', async () => {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('stale');
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(json({ accessToken: 'fresh', refreshToken: 'refresh-2' }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));

  // A 401 carrying a token minted moments ago is the service saying this
  // account may not have that resource, and it will say so again for ever.
  await expect(api().get('/v1/me/saved')).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('stops carrying a credential once the session is gone', async () => {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('stale');
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));

  await expect(api().get('/v1/me/saved')).rejects.toMatchObject({ status: 401 });

  // The refresh was refused, so the session ended and nothing was retried with
  // a token that no longer exists.
  expect(hasStoredSession()).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

describe('publicApi', () => {
  it('reads as nobody while somebody is signed in, and still negotiates the language', async () => {
    // The campaign page's updates and FAQ (#155): a team member's token would bring back what
    // the public cannot see, onto a public page and into the unencrypted offline cache.
    rememberAccessToken('team-member-token');
    fetchMock.mockResolvedValueOnce(json({ updates: [], nextCursor: null }));
    fetchMock.mockResolvedValueOnce(json({ updates: [], nextCursor: null }));

    await publicApi().get('/v1/projects/{projectId}/updates', { path: { projectId: 'p1' } });
    await api().get('/v1/projects/{projectId}/updates', { path: { projectId: 'p1' } });

    expect(headersOf(0).has('Authorization')).toBe(false);
    expect(headersOf(0).get('Accept-Language')).toBe('az');
    // The same read through the session client does carry it — the difference is the point.
    expect(headersOf(1).get('Authorization')).toBe('Bearer team-member-token');
  });
});

describe('saveAccountLocale', () => {
  it('PATCHes /v1/me/locale with the chosen language and reports success', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'access-1', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    expect(await saveAccountLocale('ru')).toBe(true);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/v1/me/locale');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ locale: 'ru' }));
  });

  it('reports failure instead of throwing when the network is down', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await saveAccountLocale('ru')).toBe(false);
  });
});
