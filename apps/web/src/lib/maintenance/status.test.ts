import { describe, expect, it, vi } from 'vitest';
import { platformStatusFrom, readPlatformStatus } from './status';

/**
 * `GET /v1/status`, read — §19.6, #214.
 *
 * Two producers answer the same question, and one rule must not bend: only the service's
 * `maintenance` state or the maintenance problem `type` is maintenance. A bare `503` is an
 * incident, and "not known" is what it reads as.
 */

const NOW = Date.parse('2026-10-04T22:10:00Z');

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status === 503 ? 'application/problem+json' : 'application/json', ...headers },
  });
}

describe('the platform status', () => {
  it('reads an operational platform with an announced window', async () => {
    const status = await platformStatusFrom(
      json(200, {
        state: 'operational',
        maintenance: null,
        upcoming: { startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-04T22:30:00Z' },
      }),
      NOW,
    );

    expect(status).toEqual({
      state: 'operational',
      maintenance: null,
      upcoming: { startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-04T22:30:00Z' },
    });
  });

  it('reads a window in force as the service’s, with the contract’s wait until its end', async () => {
    const status = await platformStatusFrom(
      json(200, {
        state: 'maintenance',
        maintenance: { startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-04T22:30:00Z' },
        upcoming: null,
      }),
      NOW,
    );

    expect(status?.state).toBe('maintenance');
    expect(status?.maintenance).toEqual({
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: '2026-10-04T22:30:00Z',
      source: 'api',
      retryAfterSeconds: 1200,
    });
  });

  it('reads an open-ended window with the contract’s five minutes', async () => {
    const status = await platformStatusFrom(
      json(200, { state: 'maintenance', maintenance: { startsAt: '2026-10-04T22:00:00Z', endsAt: null } }),
      NOW,
    );

    expect(status?.maintenance?.endsAt).toBeNull();
    expect(status?.maintenance?.retryAfterSeconds).toBe(300);
  });

  it('reads the edge’s answer as maintenance from the edge, with its Retry-After', async () => {
    const status = await platformStatusFrom(
      json(
        503,
        {
          type: 'https://ideanest.az/problems/maintenance',
          title: 'Scheduled maintenance',
          status: 503,
          startsAt: null,
          endsAt: null,
          source: 'edge',
        },
        { 'Retry-After': '120' },
      ),
      NOW,
    );

    expect(status).toEqual({
      state: 'maintenance',
      maintenance: { startsAt: null, endsAt: null, source: 'edge', retryAfterSeconds: 120 },
      upcoming: null,
    });
  });

  it('never reads a bare 503 as maintenance', async () => {
    const bare = new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } });
    const otherProblem = json(503, { type: 'https://ideanest.az/problems/dependency', status: 503 });

    expect(await platformStatusFrom(bare, NOW)).toBeNull();
    expect(await platformStatusFrom(otherProblem, NOW)).toBeNull();
  });

  it('reads anything that is not the contract as not known', async () => {
    expect(await platformStatusFrom(json(200, { state: 'sleeping' }), NOW)).toBeNull();
    expect(await platformStatusFrom(json(502, { state: 'operational' }), NOW)).toBeNull();
    expect(await platformStatusFrom(new Response('<html>', { status: 200 }), NOW)).toBeNull();
  });

  it('never throws, so an unreachable service is not known rather than a broken page', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    expect(await readPlatformStatus('http://api/v1/status', {}, failing)).toBeNull();
  });
});
