import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRACE_ID_HEADER, isTraceId, traceIdOf } from './trace';

/** The trace id a response carries — issue #150. See `trace.ts`. */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

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

function response(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 500, headers });
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
    expect(traceIdOf(response({ 'X-Trace-Id': TRACE }))).toBe(TRACE);
    expect(traceIdOf(response({ 'X-Trace-Id': ` ${TRACE} ` }))).toBe(TRACE);
    expect(traceIdOf(response())).toBeNull();
    expect(traceIdOf(response({ 'X-Trace-Id': '  ' }))).toBeNull();
    expect(traceIdOf(response({ 'X-Trace-Id': 'call us on +994 00 000 00 00' }))).toBeNull();
  });
});
