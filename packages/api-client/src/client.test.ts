import { describe, expect, it } from 'vitest';
import { createApiClient, type Fetch } from './client';
import { ApiError } from './problem';

/** A read refused the way the rate limiter refuses one, with the header and the body mirror. */
function refused(init: { headers?: Record<string, string>; body?: unknown }): Fetch {
  return async () =>
    new Response(init.body === undefined ? null : JSON.stringify(init.body), {
      status: 429,
      headers: { 'content-type': 'application/problem+json', ...init.headers },
    });
}

async function rejectionOf(fetch: Fetch): Promise<ApiError> {
  const client = createApiClient({ fetch });
  const error: unknown = await client
    .get('/v1/projects/{creatorSlug}/{projectSlug}', {
      path: { creatorSlug: 'aysel', projectSlug: 'solar-oven' },
    })
    .catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error('The read did not reject with an ApiError.');
  return error;
}

describe('a refused read', () => {
  it('takes the wait from the Retry-After header', async () => {
    const error = await rejectionOf(
      refused({ headers: { 'Retry-After': '42' }, body: { status: 429, title: 'Too Many Requests' } }),
    );

    expect(error.status).toBe(429);
    expect(error.problem?.retryAfterSeconds).toBe(42);
  });

  it('believes the header over the body mirror when they disagree', async () => {
    const error = await rejectionOf(
      refused({ headers: { 'Retry-After': '90' }, body: { status: 429, retryAfterSeconds: 30 } }),
    );

    expect(error.problem?.retryAfterSeconds).toBe(90);
  });

  it('falls back to the body mirror when a proxy stripped the header', async () => {
    const error = await rejectionOf(refused({ body: { status: 429, retryAfterSeconds: 30 } }));

    expect(error.problem?.retryAfterSeconds).toBe(30);
  });

  it('keeps the body mirror when the header is an HTTP date', async () => {
    const error = await rejectionOf(
      refused({
        headers: { 'Retry-After': 'Wed, 14 Oct 2026 12:00:00 GMT' },
        body: { status: 429, retryAfterSeconds: 30 },
      }),
    );

    expect(error.problem?.retryAfterSeconds).toBe(30);
  });

  it('carries no wait when neither the header nor the body has one', async () => {
    const error = await rejectionOf(refused({ body: { status: 429, title: 'Too Many Requests' } }));

    expect(error.problem?.title).toBe('Too Many Requests');
    expect(error.problem?.retryAfterSeconds).toBeUndefined();
  });
});
