import { traceIdOf } from '@ideanest/api-client/trace';

/**
 * The `X-Trace-Id` of the most recent API response, whatever its status — issue #165.
 *
 * <p>Crash reporting tags every event with it (`lib/crash/reporting.ts`), so a crash can be
 * joined to the service's log line for the request that came just before it (§18.1). That is a
 * different question from `traceIdOfError` in `client.ts`, which answers "which request did
 * this refusal come from" and is printed on a failure screen; this one answers "what was the
 * app last doing with the service", which is what a crash with no request of its own needs.
 *
 * <p>One listener rather than a list: the crash reporter is the only reader that has to hear
 * about a change as it happens (to copy it onto the native scope, where a native crash will
 * look for it), and anything else can read {@link lastTraceId} when it needs it.
 */
let last: string | null = null;
let listener: ((traceId: string) => void) | null = null;

/** Notes the trace id of a response on its way past, and hands the response back untouched. */
export function rememberTrace(response: Response): Response {
  const traceId = traceIdOf(response);
  if (traceId !== null && traceId !== last) {
    last = traceId;
    listener?.(traceId);
  }
  return response;
}

export function lastTraceId(): string | null {
  return last;
}

/** Called with every new trace id from now on. Replaces any earlier listener. */
export function onTraceId(next: ((traceId: string) => void) | null): void {
  listener = next;
}

/** Test seam: forget the last response. */
export function resetLastTrace(): void {
  last = null;
  listener = null;
}
