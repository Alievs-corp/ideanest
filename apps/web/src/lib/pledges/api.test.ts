import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/problem';
import {
  createPledgeDraft,
  getPublicRewards,
  isShipped,
  type DraftPledgeRequest,
} from './api';

/**
 * What actually reaches the wire.
 *
 * The view tests stub this module and assert the arguments; that proves the
 * checkout asks for the right thing, and nothing about whether the request is
 * shaped the way the contract says. This suite closes that gap at the one place
 * it matters most — `Idempotency-Key` is a header, and a header is exactly the
 * kind of thing a mocked module cannot lose loudly.
 */

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problem(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

function requestOf(call: number): { url: unknown; init: RequestInit | undefined } {
  const entry = fetchMock.mock.calls[call];
  return { url: entry?.[0], init: entry?.[1] };
}

function headerOf(call: number, name: string): string | null {
  return new Headers(requestOf(call).init?.headers).get(name);
}

const DRAFT: DraftPledgeRequest = {
  projectId: 'project-1',
  rewardTierId: 'reward-1',
  addons: [{ rewardTierId: 'addon-1', quantity: 2 }],
  contribution: { amount: '50.00', currency: 'AZN' },
  shippingCountry: 'AZ',
  isAnonymous: false,
  referrerCode: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('token-1');
});

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('getPublicRewards', () => {
  it('reads the public list, and does not require a session to do it', async () => {
    setAccessToken(null);
    fetchMock.mockResolvedValueOnce(json({ currency: 'AZN', rewards: [], addons: [] }));

    await getPublicRewards('project-1');

    // `/public`, not the creator's list: that one returns secret tiers on purpose.
    expect(requestOf(0).url).toBe('/v1/projects/project-1/rewards/public');
    // No refresh was attempted and nothing threw, which is the whole point of
    // `publicFetch` here — the prices are what a visitor reads before deciding
    // whether to register at all.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headerOf(0, 'Authorization')).toBeNull();
  });

  it('escapes the id rather than pasting it into a path', async () => {
    fetchMock.mockResolvedValueOnce(json({ currency: 'AZN', rewards: [], addons: [] }));

    await getPublicRewards('a/b');

    expect(requestOf(0).url).toBe('/v1/projects/a%2Fb/rewards/public');
  });

  it('unlocks secret tiers with a repeated token parameter (PL-15)', async () => {
    fetchMock.mockResolvedValueOnce(json({ currency: 'AZN', rewards: [], addons: [] }));

    await getPublicRewards('project-1', { tokens: ['abc', 'def'] });

    // Repeated rather than comma-joined: a token containing a comma would
    // otherwise be unspellable, and the splitting rule would live in two places.
    expect(requestOf(0).url).toBe('/v1/projects/project-1/rewards/public?token=abc&token=def');
  });

  it('asks for no tokens at all when it holds none', async () => {
    fetchMock.mockResolvedValueOnce(json({ currency: 'AZN', rewards: [], addons: [] }));

    await getPublicRewards('project-1', { tokens: [] });

    // A bare `?` on the ordinary public list would be a second spelling of the
    // same request, and the endpoint answers with an `ETag`.
    expect(requestOf(0).url).toBe('/v1/projects/project-1/rewards/public');
  });
});

describe('createPledgeDraft', () => {
  it('sends the key as a header and the selection as the body', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'pledge-1' }, 201));

    await createPledgeDraft(DRAFT, 'key-1');

    const { url, init } = requestOf(0);
    expect(url).toBe('/v1/pledges/draft');
    expect(init?.method).toBe('POST');
    expect(headerOf(0, 'Idempotency-Key')).toBe('key-1');
    expect(headerOf(0, 'Content-Type')).toBe('application/json');
    expect(headerOf(0, 'Authorization')).toBe('Bearer token-1');

    // Money crosses as a string, never a number (§10.3).
    expect(JSON.parse(String(init?.body))).toEqual(DRAFT);
    expect(typeof JSON.parse(String(init?.body)).contribution.amount).toBe('string');
  });

  it('turns a refusal into an ApiError carrying the code and its meta', async () => {
    fetchMock.mockResolvedValueOnce(
      problem(
        {
          title: 'Reward tier exhausted',
          status: 409,
          code: 'REWARD_SOLD_OUT',
          meta: { rewardTierId: 'reward-1', availableAlternatives: ['reward-2'] },
        },
        409,
      ),
    );

    const thrown = await createPledgeDraft(DRAFT, 'key-1').catch((cause: unknown) => cause);

    expect(thrown).toBeInstanceOf(ApiError);
    if (!(thrown instanceof ApiError)) return;
    expect(thrown.status).toBe(409);
    expect(thrown.problem?.code).toBe('REWARD_SOLD_OUT');
    expect(thrown.problem?.meta?.['availableAlternatives']).toEqual(['reward-2']);
  });

  it('keeps the Retry-After a busy key was refused with', async () => {
    /*
     * `409 IDEMPOTENT_REQUEST_IN_PROGRESS` is the only refusal on these two
     * endpoints that says when to try again, and it says it in a HEADER. A
     * client that read only the body would wait for a number of its own
     * choosing — and this is the refusal a double-click produces, so the number
     * is the difference between a backer seeing nothing and being shown a
     * failure for something that was about to succeed.
     */
    fetchMock.mockResolvedValueOnce(
      problem(
        {
          title: 'Request already in progress',
          status: 409,
          code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
        },
        409,
        { 'Retry-After': '1' },
      ),
    );

    const thrown = await createPledgeDraft(DRAFT, 'key-1').catch((cause: unknown) => cause);

    expect(thrown).toBeInstanceOf(ApiError);
    if (!(thrown instanceof ApiError)) return;
    // Read onto the problem, so that a caller has one place to look whether the
    // service mirrored it into the body or not.
    expect(thrown.problem?.retryAfterSeconds).toBe(1);
  });

  it('prefers the header to the body when a proxy has rewritten one of them', async () => {
    fetchMock.mockResolvedValueOnce(
      problem(
        {
          status: 409,
          code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
          retryAfterSeconds: 1,
        },
        409,
        { 'Retry-After': '4' },
      ),
    );

    const thrown = await createPledgeDraft(DRAFT, 'key-1').catch((cause: unknown) => cause);

    if (!(thrown instanceof ApiError)) throw new Error('expected an ApiError');
    // The header describes the response that actually arrived; the body is a
    // convenience copy of what the origin meant to say.
    expect(thrown.problem?.retryAfterSeconds).toBe(4);
  });
});

describe('isShipped', () => {
  it('is the two types that have a per-country rate, and nothing else', () => {
    expect(isShipped('DOMESTIC')).toBe(true);
    expect(isShipped('INTERNATIONAL')).toBe(true);
    expect(isShipped('NONE')).toBe(false);
    expect(isShipped('DIGITAL')).toBe(false);
    // The one that reads like it ships and does not: somebody collects it.
    expect(isShipped('LOCAL_PICKUP')).toBe(false);
  });
});
