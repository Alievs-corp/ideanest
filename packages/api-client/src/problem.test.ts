import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { ApiError, errorFrom, traceIdOf } from './problem';

/**
 * The trace id a refusal carries — issue #150.
 *
 * The app's failure screens print the `X-Trace-Id` of the response that failed as a reference
 * a reader can quote (§18.1). The header is gone by the time a screen sees the error, so it is
 * copied onto the `ApiError` where the response is still in hand: here.
 */

function refusal(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ title: 'Nope', status }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

describe('traceIdOf', () => {
  it('reads the header, and nothing when it is absent or blank', () => {
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': '4bf92f3577b34da6a3ce929d0e0e4736' }))).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
    expect(traceIdOf(refusal(500))).toBeNull();
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': '  ' }))).toBeNull();
  });
});

describe('the trace id on an ApiError', () => {
  it('is carried by errorFrom', async () => {
    const error = await errorFrom(refusal(503, { 'X-Trace-Id': 'abc123' }));
    expect(error.traceId).toBe('abc123');
    expect(error.problem?.title).toBe('Nope');
  });

  it('is carried by a typed read that failed', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test.invalid',
      fetch: async () => refusal(500, { 'X-Trace-Id': 'def456' }),
    });
    const failure = await client.get('/v1/discover').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).traceId).toBe('def456');
  });

  it('is null when the error was built without one', () => {
    expect(new ApiError(404).traceId).toBeNull();
  });
});
