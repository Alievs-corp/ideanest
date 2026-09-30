import {
  contractRetryAfterSeconds,
  maintenanceFromResponse,
  type Maintenance,
} from '@ideanest/api-client/maintenance';
import { apiOrigin } from '../api/config';

/**
 * `GET /v1/status`, read — issue #214.
 *
 * The one request the app makes to learn whether the platform is up and whether a window is
 * announced: the maintenance screen polls it (`lib/maintenance.ts`), and the upcoming-notice
 * banner reads it on launch and on return to the foreground (`lib/upcoming-maintenance.ts`).
 *
 * <h2>Without the session, and never from a cache</h2>
 *
 * Fetched directly rather than through `api/client.ts`: `sessionFetch` refreshes a missing
 * access token before the first call, and with the biometric lock on that is a Face ID prompt
 * every thirty seconds on a screen that is only waiting. The service answers it `no-store`; the
 * request says `no-store` too, and sends `Cache-Control: no-cache` for anything in between, so
 * a poll is never answered with a stored `operational` from before the window.
 *
 * <h2>What each answer means</h2>
 *
 * - **2xx** — the body's `state`. `operational` carries `upcoming` (or null); `maintenance`
 *   carries the window in force, read as `source: "api"`.
 * - **5xx with the maintenance problem** — maintenance. That is the edge answering for a
 *   service that is not running (`source: "edge"`), or anything else speaking the contract.
 * - **Any other 5xx, or no answer at all** — `unknown`: the service did not come back, and
 *   nothing is known about it. Not maintenance, and not up.
 * - **3xx or 4xx** — the service answering, without a status it can give (an API older than
 *   #214 answers 404 here). Read as `operational`, the rule #198's poll used: leaving on it
 *   is right, because whatever answered 404 is not an outage.
 */

/** A window, as `/v1/status` names one. `endsAt` null is "until further notice". */
export interface StatusWindow {
  readonly startsAt: string;
  readonly endsAt: string | null;
}

export type PlatformStatus =
  | { readonly state: 'operational'; readonly upcoming: StatusWindow | null }
  | { readonly state: 'maintenance'; readonly maintenance: Maintenance }
  | { readonly state: 'unknown' };

const UNKNOWN: PlatformStatus = { state: 'unknown' };
const OPERATIONAL: PlatformStatus = { state: 'operational', upcoming: null };

export async function readStatus(now: number = Date.now()): Promise<PlatformStatus> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}/v1/status`, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
  } catch {
    return UNKNOWN;
  }

  if (response.status >= 500) {
    const maintenance = await maintenanceFromResponse(response, now);
    return maintenance === null ? UNKNOWN : { state: 'maintenance', maintenance };
  }
  if (!response.ok) return OPERATIONAL;

  let body: { state?: unknown; maintenance?: unknown; upcoming?: unknown };
  try {
    body = ((await response.json()) ?? {}) as typeof body;
  } catch {
    return OPERATIONAL;
  }

  if (body.state === 'maintenance') {
    const window = windowOf(body.maintenance);
    const endsAt = window?.endsAt ?? null;
    return {
      state: 'maintenance',
      maintenance: {
        startsAt: window?.startsAt ?? null,
        endsAt,
        source: 'api',
        retryAfterSeconds: contractRetryAfterSeconds(endsAt, now),
      },
    };
  }
  return { state: 'operational', upcoming: windowOf(body.upcoming) };
}

/** A window from the body, or null when it is absent or its start will not parse. */
function windowOf(value: unknown): StatusWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { startsAt, endsAt } = value as { startsAt?: unknown; endsAt?: unknown };
  if (typeof startsAt !== 'string' || !Number.isFinite(Date.parse(startsAt))) return null;
  const end = typeof endsAt === 'string' && Number.isFinite(Date.parse(endsAt)) ? endsAt : null;
  return { startsAt, endsAt: end };
}
