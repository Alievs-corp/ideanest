import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { readStatus, type StatusWindow } from './platform-status';
import { deviceStore, type KeyValueStore } from './storage';

/**
 * The announced window, for the banner under the header — issue #214.
 *
 * <h2>Where the app learns of it, and why so rarely</h2>
 *
 * `GET /v1/status` on launch and on each return to the foreground, at most once every
 * {@link REFRESH_EVERY_MS}, plus whatever the maintenance screen's own poll learns. A window is
 * announced a day ahead by default (`announce_from = starts_at − 24h`), so a phone that asks when
 * it is opened hears about it many times over; a timer running while the app is open would be a
 * request every few minutes, from every phone, to learn the same thing. The endpoint is served
 * from the service's ten-second snapshot and costs it no database read, but the radio's wake-up
 * costs the phone.
 *
 * <h2>Dismissed per window</h2>
 *
 * Closing the banner hides it for that window and no other. The public status carries no window
 * id, so the window's `startsAt` is its key: a new window starts at a different instant, and one
 * rescheduled to a new start is, to a reader, a new announcement worth reading. Kept in the
 * device store, so it stays closed across launches; one value, because only the window being
 * announced now can be dismissed.
 *
 * <h2>Not after it starts</h2>
 *
 * The banner says "planned", and from `startsAt` on it would be wrong. It hides at the start by
 * the phone's clock, and the reads that begin to meet the maintenance problem open the screen.
 */

/** The fewest milliseconds between two launch-or-foreground checks. */
export const REFRESH_EVERY_MS = 10 * 60_000;

const DISMISSED_KEY = 'maintenance.dismissedUpcoming';

let upcoming: StatusWindow | null = null;
let store: KeyValueStore = deviceStore;
let dismissed: string | null | undefined;
let lastAsked: number | null = null;
let asking = false;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function dismissedStart(): string | null {
  if (dismissed === undefined) dismissed = store.getString(DISMISSED_KEY) ?? null;
  return dismissed;
}

/** Replaces the device store and forgets everything in memory. For tests, and for nothing else. */
export function useUpcomingStore(next: KeyValueStore): void {
  store = next;
  dismissed = undefined;
  upcoming = null;
  lastAsked = null;
  asking = false;
  publish();
}

/** What `/v1/status` last said is announced. Null clears it. */
export function setUpcoming(window: StatusWindow | null): void {
  if (window?.startsAt === upcoming?.startsAt && window?.endsAt === upcoming?.endsAt) return;
  upcoming = window;
  publish();
}

/** The window the banner shows: announced, not dismissed, and not yet started. */
export function visibleUpcoming(now: number = Date.now()): StatusWindow | null {
  if (upcoming === null) return null;
  if (dismissedStart() === upcoming.startsAt) return null;
  return Date.parse(upcoming.startsAt) > now ? upcoming : null;
}

/** Closes the banner for the window it shows, for good. */
export function dismissUpcoming(): void {
  if (upcoming === null) return;
  dismissed = upcoming.startsAt;
  store.set(DISMISSED_KEY, upcoming.startsAt);
  publish();
}

/** Subscribes to changes. Returns the unsubscribe. */
export function subscribeToUpcoming(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The window to announce, or null, re-rendering when that changes. */
export function useUpcomingMaintenance(): StatusWindow | null {
  const snapshot = () => visibleUpcoming();
  return useSyncExternalStore(subscribeToUpcoming, snapshot, snapshot);
}

/**
 * Asks `/v1/status`, unless it was asked within {@link REFRESH_EVERY_MS} or is being asked.
 * During maintenance the announcement is moot and is cleared; with no answer it is kept.
 */
export async function refreshUpcoming(now: number = Date.now()): Promise<void> {
  if (asking || (lastAsked !== null && now - lastAsked < REFRESH_EVERY_MS)) return;
  asking = true;
  lastAsked = now;
  try {
    const status = await readStatus(now);
    if (status.state === 'operational') setUpcoming(status.upcoming);
    else if (status.state === 'maintenance') setUpcoming(null);
  } finally {
    asking = false;
  }
}

/** Checks on launch and on each return to the foreground. Returns the stop. Used by the root. */
export function watchUpcoming(): () => void {
  void refreshUpcoming();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void refreshUpcoming();
  });
  return () => subscription.remove();
}
