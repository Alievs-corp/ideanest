import { useSyncExternalStore } from 'react';
import { maintenanceFromResponse, type Maintenance } from '@ideanest/api-client/maintenance';
import { readStatus } from './platform-status';
import { setUpcoming } from './upcoming-maintenance';

/**
 * The maintenance trigger — issues #150 and #214.
 *
 * <h2>The signal is the maintenance problem, and nothing looser</h2>
 *
 * The screen opens for a `503` whose `application/problem+json` body has
 * `type: "https://ideanest.az/problems/maintenance"` (docs/architecture.md §19.6), read by
 * `@ideanest/api-client/maintenance`. **Any other 5xx, a bare `503` included, is an ordinary
 * failure**: the screen that made the request shows its own error and its own retry. A `503`
 * also means overload, a failed dependency or a restart, and calling those "planned
 * maintenance" would hide a real incident behind a calm screen.
 *
 * <p>This replaces #198's rule, which treated every `503` as maintenance because the service
 * had no maintenance mode to say otherwise. It has one now (#219), and the proxy answers the
 * same contract when the service is not running at all (#218, `source: "edge"`). The old rule
 * also ignored a `503` while offline, because a captive portal could send one; a portal
 * cannot send this body, so that exception is gone with the rule it guarded.
 *
 * <h2>A store, like the session's</h2>
 *
 * The request that sees the problem is deep inside `api/client.ts` and has no router; the root
 * layout has a router and sees no responses. A module-level value with subscribers, read
 * through `useSyncExternalStore`, is the seam between them — the same shape as
 * `lib/session.ts` and `lib/locale.ts`. It holds the {@link Maintenance} itself, because the
 * screen's words depend on it: the announced end, or the edge's neutral wording.
 */

/** How often the maintenance screen asks again after its first check. */
export const POLL_INTERVAL_MS = 30_000;

/** The shortest first wait `Retry-After` can ask for. */
export const MIN_FIRST_POLL_MS = 5_000;

/** The longest first wait `Retry-After` can ask for. */
export const MAX_FIRST_POLL_MS = 5 * 60_000;

let current: Maintenance | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * `Retry-After`, as the delay before the first poll, in milliseconds.
 *
 * <p>The service clamps it to 30 s – 1 h; this clamps it again to
 * {@link MIN_FIRST_POLL_MS}–{@link MAX_FIRST_POLL_MS}. Above: the header is the service's
 * estimate of the window, and a phone that waited an hour on it would show "unavailable" long
 * after a window ended early — "Try again" is the only other way out, and nobody should need
 * it. Below: a `0` would ask in the same breath as the answer still on screen.
 */
export function pollDelayMs(retryAfterSeconds: number): number {
  const ms = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : POLL_INTERVAL_MS;
  return Math.min(MAX_FIRST_POLL_MS, Math.max(MIN_FIRST_POLL_MS, ms));
}

/** Whether the maintenance screen should be showing. */
export function inMaintenance(): boolean {
  return current !== null;
}

/** The maintenance showing, or null. */
export function currentMaintenance(): Maintenance | null {
  return current;
}

/** How long the screen waits before its first check, as the triggering response asked. */
export function firstPollDelayMs(): number {
  return current === null ? POLL_INTERVAL_MS : pollDelayMs(current.retryAfterSeconds);
}

/**
 * Enters maintenance, or — already in it — takes the newer word on it: a poll that learns the
 * window was extended, or that the edge is answering now, changes the screen's copy. Entering is
 * idempotent: every request on a screen fails at once, and one screen is shown.
 */
export function enterMaintenance(maintenance: Maintenance): void {
  if (
    current !== null &&
    current.source === maintenance.source &&
    current.startsAt === maintenance.startsAt &&
    current.endsAt === maintenance.endsAt
  ) {
    return;
  }
  current = maintenance;
  publish();
}

/** Leaves maintenance — the service answered. */
export function leaveMaintenance(): void {
  if (current === null) return;
  current = null;
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
 * Looks at a response from the API and enters maintenance when it is the maintenance problem.
 * Resolves to the same response, so the call site reads as a pass-through.
 *
 * <p>The body is read from a clone, so the response is handed on unconsumed and its error
 * semantics are untouched: the caller still gets the 503 and `@ideanest/api-client` still throws
 * its `ApiError`. Only a 503 is read at all; every other response passes straight through.
 */
export async function observeResponse(response: Response): Promise<Response> {
  if (response.status === 503) {
    const maintenance = await maintenanceFromResponse(response);
    if (maintenance !== null) enterMaintenance(maintenance);
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

/** The maintenance showing, or null, re-rendering when it or its details change. */
export function useCurrentMaintenance(): Maintenance | null {
  return useSyncExternalStore(subscribeToMaintenance, currentMaintenance, currentMaintenance);
}

/**
 * Whether the platform is back: `GET /v1/status` says `operational` (`lib/platform-status.ts`
 * has what each answer means, and why it is fetched without the session and never from a cache).
 *
 * <p>An answer that it is still in maintenance updates what the screen says — an extended end,
 * or the edge taking over from the service. An `operational` answer passes its `upcoming` on to
 * the banner, so the next window is known the moment this one ends.
 */
export async function serviceAnswers(now: number = Date.now()): Promise<boolean> {
  const status = await readStatus(now);
  if (status.state === 'maintenance') {
    if (current !== null) enterMaintenance(status.maintenance);
    return false;
  }
  if (status.state === 'unknown') return false;
  setUpcoming(status.upcoming);
  return true;
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
