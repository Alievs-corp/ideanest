import {
  contractRetryAfterSeconds,
  maintenanceFromResponse,
  type Maintenance,
} from '@ideanest/api-client/maintenance';

/**
 * `GET /v1/status`, read — §19.6, issue #214.
 *
 * <h2>Two producers, one answer</h2>
 *
 * The service answers `200` with `{ state, maintenance, upcoming }` from a ten-second snapshot,
 * during a window as well as outside one. When the service is not running at all the edge
 * answers instead, with the maintenance problem itself (`503`, `source: "edge"`, no times).
 * Both become one {@link PlatformStatus}, so the proxy, the maintenance page and the console
 * strip each ask one question.
 *
 * Anything else — a bare `503`, a `502`, a body that is not the contract, a network failure —
 * is `null`: *not known*. It is never read as maintenance, for the reason the contract gives
 * (a calm "planned maintenance" screen must not cover an incident), and never as operational
 * either; each caller decides what not knowing means where it stands.
 *
 * <h2>Server and client alike, and kept out of the shared chunk</h2>
 *
 * Nothing here reaches for `next/*`, and the one dependency is the api-client's
 * `./maintenance` subpath, which no route bundle carries unless it imports this file. Today
 * only server code does — the proxy, the maintenance page, `SiteShell` and the console shell —
 * so the public routes' First Load JS does not grow by a byte.
 */

/** A window's two instants, as the status endpoint publishes them. */
export interface StatusWindow {
  readonly startsAt: string;
  /** Null: until further notice. */
  readonly endsAt: string | null;
}

export interface PlatformStatus {
  readonly state: 'operational' | 'maintenance';
  /** Set exactly when `state` is `maintenance`. */
  readonly maintenance: Maintenance | null;
  /** The window announced and not yet started. Never set during a window. */
  readonly upcoming: StatusWindow | null;
}

/** The address, relative to the service's origin. */
export const STATUS_PATH = '/v1/status';

export async function platformStatusFrom(
  response: Response,
  now: number = Date.now(),
): Promise<PlatformStatus | null> {
  if (response.status === 503) {
    const maintenance = await maintenanceFromResponse(response, now);
    return maintenance === null ? null : { state: 'maintenance', maintenance, upcoming: null };
  }
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;

  const record = body as Record<string, unknown>;
  if (record['state'] === 'operational') {
    return { state: 'operational', maintenance: null, upcoming: windowOf(record['upcoming']) };
  }
  if (record['state'] === 'maintenance') {
    const window = windowOf(record['maintenance']);
    return {
      state: 'maintenance',
      maintenance: {
        startsAt: window?.startsAt ?? null,
        endsAt: window?.endsAt ?? null,
        source: 'api',
        retryAfterSeconds: contractRetryAfterSeconds(window?.endsAt ?? null, now),
      },
      upcoming: null,
    };
  }
  return null;
}

/**
 * Asks, and never throws: a network failure, a timeout or an abort is `null` like any other
 * answer that is not the contract.
 */
export async function readPlatformStatus(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformStatus | null> {
  try {
    return await platformStatusFrom(await fetchImpl(url, init));
  } catch {
    return null;
  }
}

function windowOf(value: unknown): StatusWindow | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const startsAt = instant(record['startsAt']);
  if (startsAt === null) return null;
  return { startsAt, endsAt: instant(record['endsAt']) };
}

function instant(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
