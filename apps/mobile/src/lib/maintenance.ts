import { useSyncExternalStore } from 'react';
import { apiOrigin } from '../api/config';
import { currentlyOnline } from './connectivity';
import { currentLocale } from './locale';

/**
 * The maintenance trigger — issue #150.
 *
 * <h2>The signal is a 503, and that is a decision rather than a discovery</h2>
 *
 * The service has no maintenance mode: nothing in `apps/api` answers "down for maintenance",
 * and the web's `/maintenance` page says in its own comment that whatever switches traffic to
 * it is a deployment concern. What a planned outage looks like from a phone is therefore
 * whatever the edge returns while the service is away — and a reverse proxy's maintenance
 * page, like a load balancer with no healthy upstream, answers `503 Service Unavailable`,
 * usually with a `Retry-After`. So **any 503 from the API is treated as maintenance.** No
 * handler in the service returns 503 for a reason of its own, so the rule has no false
 * positive today; if one ever does, it must carry a problem `code` and this is where the rule
 * narrows to "503 without one".
 *
 * <p>Not while offline. A 503 that arrives while the platform says there is no internet is a
 * captive portal or a carrier proxy speaking, and telling somebody on hotel Wi-Fi that
 * IdeyaNest is under maintenance would be a false statement about the service.
 *
 * <h2>A store, like the session's</h2>
 *
 * The request that sees the 503 is deep inside `api/client.ts` and has no router; the root
 * layout has a router and sees no responses. A module-level flag with subscribers, read
 * through `useSyncExternalStore`, is the seam between them — the same shape as
 * `lib/session.ts` and `lib/locale.ts`.
 */

/** How often the maintenance screen asks again when the edge gave no advice. */
export const POLL_INTERVAL_MS = 30_000;

/** Whether maintenance is showing, and how long the edge asked us to wait before asking again. */
let firstPollDelay: number | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * `Retry-After`, as the delay before the first poll, in milliseconds.
 *
 * <p>Both of RFC 9110's forms: delay-seconds (`120`) and an HTTP-date. `@ideanest/api-client`'s
 * reader takes only the first because the service never sends a date — but this header comes
 * from the edge, not the service, and a proxy's maintenance page is exactly where a date
 * appears. Absent or unreadable is {@link POLL_INTERVAL_MS}.
 *
 * <p>Clamped to {@link MIN_FIRST_POLL_MS}–{@link MAX_FIRST_POLL_MS}. Below: a `0`, or a date
 * already past, would ask in the same breath as the 503 that is still on screen. Above: the
 * header is the edge's guess at the window, and a phone that waited an hour on a guess would
 * show "unavailable" long after the service came back — "Try again" is the only other way out,
 * and nobody should need it.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number {
  const value = header?.trim() ?? '';
  const clamp = (ms: number) => Math.min(MAX_FIRST_POLL_MS, Math.max(MIN_FIRST_POLL_MS, ms));
  if (/^\d+$/.test(value)) return clamp(Number(value) * 1000);

  // `Date.parse` alone would read "5" or "tomorrow-ish" as something; an HTTP-date names a day.
  if (/^[A-Za-z]{3}, /.test(value)) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return clamp(at - now);
  }
  return POLL_INTERVAL_MS;
}

/** The shortest first wait `Retry-After` can ask for. */
export const MIN_FIRST_POLL_MS = 5_000;

/** The longest first wait `Retry-After` can ask for. */
export const MAX_FIRST_POLL_MS = 5 * 60_000;

/** Whether the maintenance screen should be showing. */
export function inMaintenance(): boolean {
  return firstPollDelay !== null;
}

/** How long the screen waits before its first check, as the triggering response asked. */
export function firstPollDelayMs(): number {
  return firstPollDelay ?? POLL_INTERVAL_MS;
}

/** Enters maintenance. Idempotent: every request on a screen fails at once, and one screen is shown. */
export function enterMaintenance(delayMs: number): void {
  if (firstPollDelay !== null) return;
  firstPollDelay = delayMs;
  publish();
}

/** Leaves maintenance — the service answered. */
export function leaveMaintenance(): void {
  if (firstPollDelay === null) return;
  firstPollDelay = null;
  publish();
}

let deferred: (() => void) | null = null;

/**
 * Holds a navigation until the service is back, when it is away. Returns whether it held it.
 *
 * <p>For a link or a tapped notification that arrives during maintenance. Followed at once, it
 * would push a screen over the maintenance screen — a screen whose reads can only fail — and
 * leave the reader one back-press from the broken stack. Dropped, the link somebody tapped would
 * vanish. Held, it opens the moment the service answers. Only the latest is kept: two links
 * tapped during an outage mean the reader changed their mind.
 */
export function deferUntilUp(navigate: () => void): boolean {
  if (!inMaintenance()) return false;
  deferred = navigate;
  return true;
}

/** The navigation held during maintenance, once, or null. */
export function takeDeferred(): (() => void) | null {
  const navigate = deferred;
  deferred = null;
  return navigate;
}

/**
 * Looks at a response from the API and enters maintenance when it is one. Returns the response,
 * so the call site reads as a pass-through.
 *
 * <p>The response is not consumed and its error semantics are untouched: the caller still gets
 * the 503, `@ideanest/api-client` still throws its `ApiError`, and the screen underneath still
 * renders its own error for the instant before the maintenance screen covers it.
 */
export function observeResponse(response: Response): Response {
  if (response.status === 503 && currentlyOnline()) {
    enterMaintenance(retryAfterMs(response.headers.get('Retry-After')));
  }
  return response;
}

/** Subscribes to maintenance changes. Returns the unsubscribe. */
export function subscribeToMaintenance(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Whether maintenance is showing, re-rendering when that changes. */
export function useMaintenance(): boolean {
  return useSyncExternalStore(subscribeToMaintenance, inMaintenance, inMaintenance);
}

/**
 * Whether the service answers again: any status below 500 from `GET /v1/categories`.
 *
 * <h2>Why that endpoint, and why not through `api/client.ts`</h2>
 *
 * Public, small, and cheap for the service — the cheapest read in the contract that goes
 * through the whole stack rather than stopping at a health probe the edge might answer on its
 * own. It is fetched **without** the session: `sessionFetch` refreshes a missing access token
 * before the first call, and with the biometric lock on that is a Face ID prompt every thirty
 * seconds on a screen that is only waiting. A thrown `fetch` is "not yet": the connection went,
 * the service did not come back.
 *
 * <h2>Never from a cache</h2>
 *
 * The service marks this response `public, max-age=3600`, so the platform's HTTP cache
 * (OkHttp's, `NSURLCache`) or a CDN would happily answer the poll with the 200 it stored before
 * the outage. The screen would leave, the next real read would meet the 503, and it would be
 * pushed again — a loop. So the request says `no-store`, sends `Cache-Control: no-cache` for
 * the intermediaries, and carries a query string no cache has seen.
 *
 * <p>Below 500 rather than "not 503": a 502 or 504 is the edge saying the service is still not
 * there, and leaving on one would send the reader straight into it.
 */
export async function serviceAnswers(now: number = Date.now()): Promise<boolean> {
  try {
    const response = await fetch(`${apiOrigin()}/v1/categories?_=${now}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'Accept-Language': currentLocale(),
        'Cache-Control': 'no-cache',
      },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Asks again on a timer until the service answers. */
export interface Poller {
  /** Asks after `delayMs`, cancelling any ask already scheduled. `start(0)` is "now". */
  start(delayMs: number): void;
  /** Stops asking. A check already in flight is ignored when it lands. */
  stop(): void;
}

/**
 * The maintenance screen's timer, apart from the screen so it can be driven with fake timers.
 *
 * <p>One check at a time: `start` while a check is in flight lets that check decide what comes
 * next, rather than stacking a second request behind it. After a "not yet" it asks again every
 * {@link POLL_INTERVAL_MS}; the delay passed to `start` is only for the first ask, which is
 * where `Retry-After` belongs.
 */
export function createPoller(check: () => Promise<boolean>, onRecovered: () => void): Poller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let inFlight = false;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const ask = async () => {
    timer = undefined;
    inFlight = true;
    const up = await check().catch(() => false);
    inFlight = false;
    if (!running) return;
    if (up) {
      running = false;
      onRecovered();
      return;
    }
    timer = setTimeout(() => void ask(), POLL_INTERVAL_MS);
  };

  return {
    start(delayMs) {
      running = true;
      cancel();
      if (!inFlight) timer = setTimeout(() => void ask(), delayMs);
    },
    stop() {
      running = false;
      cancel();
    },
  };
}
