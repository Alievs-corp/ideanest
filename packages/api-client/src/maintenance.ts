import type { ApiError, Problem } from './problem';

/**
 * The maintenance contract, read — issue #214. `@ideanest/api-client/maintenance`.
 *
 * A maintenance response is a `503` whose `application/problem+json` body has
 * `type: "https://ideanest.az/problems/maintenance"`. **Nothing else is maintenance.** A `503`
 * without that type is an overload, a dependency outage or a restart, and a client that shows
 * "planned maintenance" for it hides an incident behind a calm screen. So every client branches
 * on the type through {@link isMaintenanceProblem}, and on nothing looser.
 *
 * The body has two producers (docs/architecture.md §19.6):
 *
 * - **`source: "api"`** — the service, with a window switched on in the console. `startsAt` is
 *   set and `endsAt` is the announced end or null ("until further notice").
 * - **`source: "edge"`** — the proxy, answering because the service is not running at all.
 *   Both instants are null: the edge cannot know them, and it cannot tell a planned stop from a
 *   crash, which is why clients word it neutrally.
 *
 * The body carries no prose. The client renders its own catalogue copy
 * (`shell.maintenance.*`, `shell.failure.pages.maintenance.*`), in the reader's language.
 *
 * <h2>A subpath of its own, and not re-exported from the root</h2>
 *
 * The same reason as `./trace`: the web's route bundles import the package root and are
 * budgeted to the tenth of a KiB. Only the code that handles maintenance imports this, and a
 * route that never does pays nothing for it. The one import from `./problem` is a type.
 */

/** The problem type of a maintenance response. `maintenance.test.ts` pins it to the Java. */
export const MAINTENANCE_PROBLEM_TYPE = 'https://ideanest.az/problems/maintenance';

/** Who answered: the service with a window on, or the proxy with the service away. */
export type MaintenanceSource = 'api' | 'edge';

/** A maintenance response, as a client acts on it. */
export interface Maintenance {
  /** When the window began, as an ISO instant. Null from the edge, which cannot know. */
  readonly startsAt: string | null;
  /** The announced end, as an ISO instant. Null means "until further notice". */
  readonly endsAt: string | null;
  readonly source: MaintenanceSource;
  /**
   * How long to wait before asking again, in seconds: the `Retry-After` the response carried
   * when the caller could see it, otherwise what the service would have sent — seconds until
   * `endsAt`, clamped to {@link MIN_RETRY_AFTER_SECONDS}–{@link MAX_RETRY_AFTER_SECONDS}, and
   * {@link UNKNOWN_END_RETRY_AFTER_SECONDS} with no end. Always a number, so a caller has one
   * place to read it. A client may clamp it further to its own polling policy.
   */
  readonly retryAfterSeconds: number;
}

/** The contract's shortest `Retry-After` (`ActiveMaintenance.MIN_RETRY_AFTER_SECONDS`). */
export const MIN_RETRY_AFTER_SECONDS = 30;

/** The contract's longest `Retry-After` (`ActiveMaintenance.MAX_RETRY_AFTER_SECONDS`). */
export const MAX_RETRY_AFTER_SECONDS = 3600;

/** The contract's `Retry-After` with no announced end (`UNKNOWN_END_RETRY_AFTER_SECONDS`). */
export const UNKNOWN_END_RETRY_AFTER_SECONDS = 300;

const SERVICE_UNAVAILABLE = 503;

/**
 * Whether this is the maintenance problem.
 *
 * Takes what a client has to hand: an `ApiError` (or anything shaped like one, `{ status,
 * problem }` — duck-typed so that two copies of the class in two bundles still agree), or a
 * problem body on its own. True only for the maintenance `type`, and only on a `503` when a
 * status is present — a maintenance body on any other status is not the contract.
 */
export function isMaintenanceProblem(error: unknown): boolean {
  return bodyOf(error) !== null;
}

/**
 * The maintenance an error or a problem body describes, or null when it is not one.
 *
 * `retryAfterSeconds` comes from the problem's `retryAfterSeconds` when `errorFrom` copied the
 * header there; `createApiClient` does not, so from its errors it is derived from `endsAt`
 * (see {@link Maintenance.retryAfterSeconds}). `now` is injectable for that derivation.
 */
export function maintenanceOf(error: unknown, now: number = Date.now()): Maintenance | null {
  const body = bodyOf(error);
  if (body === null) return null;
  const reported = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : null;
  return notice(body, reported, now);
}

/**
 * The maintenance a raw response describes, or null when it is not one.
 *
 * For a client that sees responses before they become errors — the app's `fetch` wrapper. The
 * body is read from a **clone**, so the response is handed on unconsumed. The `Retry-After`
 * header wins over any body value: it is what the response actually says (`problem.ts`).
 */
export async function maintenanceFromResponse(
  response: Response,
  now: number = Date.now(),
): Promise<Maintenance | null> {
  if (response.status !== SERVICE_UNAVAILABLE) return null;
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null;

  let parsed: unknown;
  try {
    parsed = await response.clone().json();
  } catch {
    return null;
  }
  const body = bodyOf(parsed);
  if (body === null) return null;
  return notice(body, retryAfterHeader(response.headers.get('Retry-After')), now);
}

/**
 * The contract's `Retry-After` for a window ending at `endsAt`, in seconds — the same rule as
 * `ActiveMaintenance.retryAfterSeconds`, rounded up and clamped.
 */
export function contractRetryAfterSeconds(endsAt: string | null, now: number = Date.now()): number {
  const end = endsAt === null ? Number.NaN : Date.parse(endsAt);
  if (!Number.isFinite(end)) return UNKNOWN_END_RETRY_AFTER_SECONDS;
  return clamp(Math.ceil((end - now) / 1000));
}

type MaintenanceBody = Problem & {
  readonly startsAt?: unknown;
  readonly endsAt?: unknown;
  readonly source?: unknown;
};

function bodyOf(candidate: unknown): MaintenanceBody | null {
  if (typeof candidate !== 'object' || candidate === null) return null;

  // An ApiError, or anything carrying one's two fields.
  if ('problem' in candidate && 'status' in candidate) {
    const error = candidate as Pick<ApiError, 'status' | 'problem'>;
    if (error.status !== SERVICE_UNAVAILABLE) return null;
    return bodyOf(error.problem);
  }

  const body = candidate as MaintenanceBody;
  if (body.type !== MAINTENANCE_PROBLEM_TYPE) return null;
  if (body.status !== undefined && body.status !== SERVICE_UNAVAILABLE) return null;
  return body;
}

function notice(body: MaintenanceBody, reported: number | null, now: number): Maintenance {
  const endsAt = instant(body.endsAt);
  return {
    startsAt: instant(body.startsAt),
    endsAt,
    // Anything but a clear "api" gets the edge's neutral wording: it claims the least.
    source: body.source === 'api' ? 'api' : 'edge',
    retryAfterSeconds:
      reported !== null && Number.isFinite(reported) && reported >= 0
        ? reported
        : contractRetryAfterSeconds(endsAt, now),
  };
}

/** An ISO instant the platform can read, or null. A garbled one is treated as absent. */
function instant(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Delta-seconds only, as `problem.ts` reads it; the contract never sends a date. */
function retryAfterHeader(header: string | null): number | null {
  const value = header?.trim() ?? '';
  return /^\d+$/.test(value) ? Number(value) : null;
}

function clamp(seconds: number): number {
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, seconds));
}
