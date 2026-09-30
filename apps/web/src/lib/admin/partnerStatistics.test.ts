import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

import { authorizedFetch } from '../api/client';
import { ApiError } from '../api/problem';
import { readPartnerStatistics } from './partnerStatistics';

const fetchMock = vi.mocked(authorizedFetch);

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

afterEach(() => vi.resetAllMocks());

describe('reading the partner statistics', () => {
  it('asks for nothing but the path, so there is no parameter to widen', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ view: 'PARTNER' }), { status: 200 }));

    await readPartnerStatistics();

    // No view, percentage, account or window in the request: the service decides, from the
    // caller's roles, and this file has nothing to tamper with.
    expect(fetchMock).toHaveBeenCalledWith('/v1/admin/partner-statistics', { signal: undefined });
  });

  it('turns the one refusal a partner with no percentage gets into an answer of its own', async () => {
    fetchMock.mockResolvedValue(problem(403, 'PARTNER_NOT_CONFIGURED'));

    await expect(readPartnerStatistics()).resolves.toEqual({ kind: 'not-configured' });
  });

  it('lets every other refusal through, so it is handled as it is on every other screen', async () => {
    fetchMock.mockResolvedValue(problem(403, 'INSUFFICIENT_STAFF_CAPABILITY'));

    await expect(readPartnerStatistics()).rejects.toBeInstanceOf(ApiError);
  });
});
