import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { ApiError, TRACE_ID_HEADER, errorFrom, isTraceId, traceIdOf } from './problem';

/**
 * The trace id a refusal carries — issue #150.
 *
 * The app's failure screens print the `X-Trace-Id` of the response that failed as a reference
 * a reader can quote (§18.1). The header is gone by the time a screen sees the error, so it is
 * copied onto the `ApiError` where the response is still in hand: here.
 */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER = '0af7651916cd43dd8448eb211c80319c';

/** The Java is the authority for the header's name and the id's shape. */
const correlationJava = readFileSync(
  fileURLToPath(
    new URL(
      '../../../apps/api/src/main/java/az/ideanest/shared/observability/Correlation.java',
      import.meta.url,
    ),
  ),
  'utf8',
);

function refusal(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ title: 'Nope', status }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

describe('the trace id shape', () => {
  it('is the one Correlation.java names and mints', () => {
    expect(correlationJava).toContain(`"${TRACE_ID_HEADER}"`);
    // The trace group of the traceparent pattern the service validates against.
    expect(correlationJava).toContain('(?!0{32})([0-9a-f]{32})');
  });

  it('accepts thirty-two lower-case hex characters and nothing else', () => {
    expect(isTraceId(TRACE)).toBe(true);
    expect(isTraceId('0'.repeat(32))).toBe(false);
    expect(isTraceId(TRACE.toUpperCase())).toBe(false);
    expect(isTraceId(TRACE.slice(1))).toBe(false);
    expect(isTraceId(`${TRACE}0`)).toBe(false);
  });
});

describe('traceIdOf', () => {
  it('reads the header, and nothing when it is absent, blank or not a trace id', () => {
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': TRACE }))).toBe(TRACE);
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': ` ${TRACE} ` }))).toBe(TRACE);
    expect(traceIdOf(refusal(500))).toBeNull();
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': '  ' }))).toBeNull();
    expect(traceIdOf(refusal(500, { 'X-Trace-Id': 'call us on +994 00 000 00 00' }))).toBeNull();
  });
});

describe('the trace id on an ApiError', () => {
  it('is carried by errorFrom', async () => {
    const error = await errorFrom(refusal(503, { 'X-Trace-Id': TRACE }));
    expect(error.traceId).toBe(TRACE);
    expect(error.problem?.title).toBe('Nope');
  });

  it('is carried by a typed read that failed', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test.invalid',
      fetch: async () => refusal(500, { 'X-Trace-Id': OTHER }),
    });
    const failure = await client.get('/v1/discover').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).traceId).toBe(OTHER);
  });

  it('is null when the error was built without one', () => {
    expect(new ApiError(404).traceId).toBeNull();
  });
});
