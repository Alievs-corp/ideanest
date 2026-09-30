/**
 * §10.4's error shape, once, for every client.
 *
 * The service answers failures with RFC 9457 problem details, on
 * `application/problem+json`. Some failures do not reach a handler at all — Spring Security
 * refuses an unauthenticated request in the filter chain, and the session endpoints return a
 * deliberately bare 404 — so a body is never assumed to exist.
 *
 * **This lives here rather than in `apps/web`, and that is CLAUDE.md §3's rule rather than a
 * preference:** a type shared between packages belongs to a shared package. It was written
 * in the web application first, because the web application was the only client; #136 gives
 * the mobile client the same contract, and two hand-maintained copies of an error shape is
 * two clients that eventually branch on different spellings of the same code.
 * `apps/web/src/lib/api/problem.ts` now re-exports this and keeps its own name.
 */
export interface Problem {
  type?: string;
  title?: string;
  detail?: string;
  status?: number;
  /** Field name to message, on a validation failure. */
  errors?: Record<string, string>;
  /**
   * The stable machine-readable reason, e.g. `PROJECT_TRANSITION_NOT_ALLOWED`
   * (docs/architecture.md §10.4).
   *
   * A client branches on this and never on `detail`, which is prose written for a human and
   * may be reworded or localised at any time.
   */
  code?: string;
  /** Reason-specific context, keyed by `code`. §10.4 carries it on a refusal. */
  meta?: Record<string, unknown>;
  /**
   * Mirrors the `Retry-After` header, in seconds.
   *
   * Two refusals carry it: `429` from the rate limiter, and the `409
   * IDEMPOTENT_REQUEST_IN_PROGRESS` a client meets when its own first attempt is still
   * running. Both are set by the same handler that sets the header, and `errorFrom` fills
   * this in from the header when a body arrives without it — see there for why the header is
   * the one to believe.
   */
  retryAfterSeconds?: number;
}

/**
 * The header the service names a request's trace in (`Correlation.TRACE_ID_HEADER`, §18.1).
 *
 * `problem.test.ts` pins it, and the trace shape below, against `Correlation.java` itself.
 */
export const TRACE_ID_HEADER = 'X-Trace-Id';

/**
 * A W3C trace id: thirty-two lower-case hex characters, never all zeros — the trace group of
 * `Correlation.TRACEPARENT`, and the web's `isTraceId` rule (`lib/rum/correlation.ts`).
 */
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/;

/** Whether a string is shaped like a trace id the service would have minted. */
export function isTraceId(candidate: string): boolean {
  return TRACE_ID.test(candidate);
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;
  /**
   * The `X-Trace-Id` the refusal came back with, or null when it carried none.
   *
   * On the error rather than on the problem because it is a header, not part of §10.4's body,
   * and because a refusal with no body at all — Spring Security's bare 401, a proxy's 503 —
   * can still carry one. A failure screen prints it as the reference a reader can quote.
   */
  readonly traceId: string | null;

  constructor(
    status: number,
    problem: Problem | null = null,
    message?: string,
    traceId: string | null = null,
  ) {
    super(
      message ?? problem?.detail ?? problem?.title ?? `The request failed with status ${status}.`,
    );
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.traceId = traceId;
  }
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

/** Reads the problem body, or returns null when there is nothing to read. */
export async function problemFrom(response: Response): Promise<Problem | null> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null;

  try {
    return (await response.json()) as Problem;
  } catch {
    // A truncated or empty body is not worth failing over — the status code already carries
    // the part the caller acts on.
    return null;
  }
}

/**
 * `Retry-After`, in seconds, or null when the response did not carry one.
 *
 * Delta-seconds only. RFC 9110 also allows an HTTP-date and this service never sends one; a
 * date is therefore read as "no advice" rather than guessed at, and the caller falls back to
 * the `retryAfterSeconds` the same handler puts in the body.
 */
function retryAfterOf(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (header === null || !/^\d+$/.test(header.trim())) return null;

  const seconds = Number(header.trim());
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The thrown form of a refused response.
 *
 * THE HEADER IS THE ONE TO BELIEVE. `Retry-After` is what an intermediary reads and
 * rewrites, and the body's `retryAfterSeconds` is a convenience mirror of it; when the two
 * disagree the header describes the response that actually arrived. It is copied onto the
 * problem rather than onto a field of its own so that a caller has one place to read it, and
 * so that a refusal carrying only the mirror — a proxy that stripped the header — still
 * tells a client how long to wait.
 */
export async function errorFrom(response: Response): Promise<ApiError> {
  const problem = await problemFrom(response);
  const retryAfter = retryAfterOf(response);

  if (problem !== null && retryAfter !== null) problem.retryAfterSeconds = retryAfter;

  return new ApiError(response.status, problem, undefined, traceIdOf(response));
}
