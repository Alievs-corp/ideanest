import {
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  newRequestId,
  newSpanId,
  traceparentOf,
} from './src/lib/rum/correlation';
import { propagateCorrelation } from './src/lib/rum/propagation';
import { parseSampleRate, resolveSession, type SessionHolder } from './src/lib/rum/sampling';

/**
 * The half of the correlation that cannot be done anywhere else.
 *
 * A field measurement says "this session's largest contentful paint was nine
 * seconds". The next question is always "what was the server doing", and it is
 * unanswerable unless the session's requests and the session's measurement carry
 * the same trace. §18.1's `CorrelationFilter` already reads a W3C `traceparent`
 * off an inbound request and continues that trace instead of minting one, so the
 * service is waiting to be told; nothing was telling it.
 *
 * This file tells it. Every same-origin `/v1` request made by the browser gets
 * this session's `traceId` in a `traceparent`, and a fresh `X-Request-Id` and
 * span per request. The beacon carries the same `traceId`, so `rum.metric` lines
 * and the service's request lines join on the field §18.1 already names.
 *
 * <h2>Why here</h2>
 *
 * `instrumentation-client.ts` runs after the document loads and **before React
 * hydrates**, which is the only point at which a wrapper can be in place before
 * the first API call a component makes. A React effect runs too late; a change
 * to `lib/api/client.ts` would be the tidier home and is where this belongs
 * eventually — see the gap named in `docs/observability/real-user-monitoring.md`.
 *
 * <h2>What it is careful about</h2>
 *
 * - **It runs only for a sampled session.** An unsampled visit gets no wrapper at
 *   all, so the cost of this file for most visitors is one coin flip. The session
 *   is held in memory for the page's life, never in storage (#641).
 * - **It never overwrites a header a caller set.** A future `lib/api/client.ts`
 *   that propagates the trace itself takes precedence, and this becomes dead
 *   weight rather than a conflict.
 * - **It only touches same-origin `/v1`.** A cross-origin request would need a
 *   preflight for a custom header, which would turn a monitoring nicety into a
 *   failed request.
 * - **Every failure path returns the original call.** The wrapper is wrapped in
 *   `try`/`catch` twice over. `docs/architecture.md` §4.5 runs the entire pledge
 *   flow through this function; instrumentation that could break it would be
 *   worse than no instrumentation at all.
 */
try {
  const rate = parseSampleRate(process.env.NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE);
  if (rate > 0) {
    const session = resolveSession(window as Window & SessionHolder, rate);
    if (session.sampled) {
      const original = window.fetch.bind(window);
      const origin = window.location.origin;

      window.fetch = (input, init) => {
        /*
         * The arguments are computed inside a `try` and the call is made outside
         * it, so a fault in this file can only ever cost a trace header — never
         * the request, and never a second attempt at one that had already been
         * sent.
         */
        let args: [RequestInfo | URL, RequestInit?] = [input, init];
        try {
          args = propagateCorrelation(input, init, origin, () => ({
            [REQUEST_ID_HEADER]: newRequestId(),
            [TRACEPARENT_HEADER]: traceparentOf(session.traceId, newSpanId()),
          }));
        } catch {
          args = [input, init];
        }
        return original(...args);
      };
    }
  }
} catch {
  // Instrumentation that can stop an application from booting is not
  // instrumentation. There is nothing to report to, and no user-visible
  // consequence beyond a trace that does not join.
}
