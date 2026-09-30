/**
 * The trace id a response carries — issue #150. `@ideanest/api-client/trace`.
 *
 * The app's failure screens print the `X-Trace-Id` of the response that failed as a reference a
 * reader can quote (§18.1). This is the reading of that header, shared so the name and the shape
 * are written once for the clients that want them.
 *
 * <h2>A subpath of its own, and not re-exported from the root</h2>
 *
 * The web's route bundles import the package root, and `apps/web/performance/budgets.json`
 * measures them to the tenth of a KiB. The web does not print trace ids from here (it has its
 * own `lib/rum/correlation.ts`), so it must not pay for these bytes — and a module it never
 * imports is the one way to be sure it does not. `ApiError` is untouched for the same reason:
 * the app attaches the id to the error itself (`apps/mobile/src/api/client.ts`).
 */

/**
 * The header the service names a request's trace in (`Correlation.TRACE_ID_HEADER`).
 * `trace.test.ts` pins it, and the shape below, against `Correlation.java` itself.
 */
export const TRACE_ID_HEADER = 'X-Trace-Id';

/**
 * A W3C trace id: thirty-two lower-case hex characters, never all zeros — the trace group of
 * `Correlation.TRACEPARENT`, and the web's `isTraceId` rule.
 */
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/;

/** Whether a string is shaped like a trace id the service would have minted. */
export function isTraceId(candidate: string): boolean {
  return TRACE_ID.test(candidate);
}

/**
 * The response's trace id, or null when the header is absent or is not one.
 *
 * Checked rather than trusted: a failure screen prints it for a reader to quote, and a proxy or
 * a hostile network in between can put anything in a header — a sentence, a URL, a megabyte.
 * Only a value shaped like the service's own trace ids is worth showing.
 */
export function traceIdOf(response: Response): string | null {
  const value = response.headers.get(TRACE_ID_HEADER)?.trim();
  return value !== undefined && isTraceId(value) ? value : null;
}
