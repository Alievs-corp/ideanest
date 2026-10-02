import { rememberAccessToken, useFlagStore } from '../../../lib/session';
import { memoryStore } from '../../../lib/storage';
import {
  cancelDeletion,
  fetchAccountExport,
  probeProfileVisibility,
  requestDeletion,
  setProfileVisibility,
} from './api';

/**
 * The privacy requests against the real client, with only `fetch` replaced — so "no bearer on the
 * probe" is asserted on the request that leaves the phone, not on which mock was called.
 */

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();

function respond(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

function headersOf(call: number): Headers {
  return new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  useFlagStore(memoryStore());
  rememberAccessToken('the signed in token');
});

describe('probeProfileVisibility', () => {
  it('asks as a stranger, with no Authorization, although somebody is signed in', async () => {
    fetchMock.mockResolvedValueOnce(respond({ slug: 'aysel', name: 'Aysel' }));

    await expect(probeProfileVisibility('aysel')).resolves.toBe('PUBLIC');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/v1\/users\/aysel$/);
    expect(headersOf(0).has('Authorization')).toBe(false);
  });

  it('reads 404 as PRIVATE, and an answer the contract does not describe as unknown', async () => {
    fetchMock.mockResolvedValueOnce(respond({ status: 404, title: 'Not Found' }, 404));
    await expect(probeProfileVisibility('aysel')).resolves.toBe('PRIVATE');

    fetchMock.mockResolvedValueOnce(respond({ status: 500, title: 'Broken' }, 500));
    await expect(probeProfileVisibility('aysel')).resolves.toBeNull();
  });

  it('lets a transport failure through, so the switch does not guess', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(probeProfileVisibility('aysel')).rejects.toThrow('Network request failed');
  });
});

describe('the writes', () => {
  it('sends the visibility with the session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await setProfileVisibility('PRIVATE');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/v1\/me\/profile-visibility$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ visibility: 'PRIVATE' });
    expect(headersOf(0).get('Authorization')).toBe('Bearer the signed in token');
  });

  it('reads a 404 on closing as an account that is already gone', async () => {
    fetchMock.mockResolvedValueOnce(respond({ status: 404, title: 'Not Found' }, 404));
    await expect(requestDeletion('a long password')).resolves.toEqual({ kind: 'already-gone' });

    fetchMock.mockResolvedValueOnce(
      respond({ requestedAt: '2026-10-02T10:00:00Z', scheduledFor: '2026-11-01T10:00:00Z' }, 202),
    );
    await expect(requestDeletion('a long password')).resolves.toEqual({
      kind: 'scheduled',
      scheduledFor: '2026-11-01T10:00:00Z',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      password: 'a long password',
    });
  });

  it('treats nothing to cancel as cancelled, and still throws a real refusal', async () => {
    fetchMock.mockResolvedValueOnce(respond({ status: 404, title: 'Not Found' }, 404));
    await expect(cancelDeletion()).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(respond({ status: 429, title: 'Too Many', detail: 'Slow down.' }, 429));
    await expect(requestDeletion('a long password')).rejects.toMatchObject({ status: 429 });
  });
});

it('turns the export into the text of the file', async () => {
  fetchMock.mockResolvedValueOnce(respond({ format: 'ideanest-account/1', account: { email: 'a@b.az' } }));
  const text = await fetchAccountExport();
  expect(JSON.parse(text)).toEqual({ format: 'ideanest-account/1', account: { email: 'a@b.az' } });
  expect(headersOf(0).get('Authorization')).toBe('Bearer the signed in token');
});
