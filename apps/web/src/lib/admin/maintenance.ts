import type { components } from '@ideanest/api-client/schema';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * Maintenance windows, as the console operates them — §19.6, issue #214.
 *
 * <h2>A window, not a switch</h2>
 *
 * A window has a start, an end that may be unknown, and an announcement period before it in
 * which readers are warned. The service decides every state from the clock (`SCHEDULED` until
 * the announcement, `ANNOUNCED` until the start, `ACTIVE` until the end, then `ENDED` or
 * `CANCELLED`), so this module never computes one: it renders what it was sent and asks again
 * after every change. An edit reaches every instance of the service within ten seconds.
 *
 * <h2>Which verb applies to which state</h2>
 *
 * The service refuses the wrong verb with a code (`MAINTENANCE_WINDOW_ALREADY_STARTED`,
 * `_NOT_ACTIVE`, `_OVER`), and the screen only offers the verbs {@link actionsFor} allows, so
 * a refusal means the window moved on between the read and the click rather than a button
 * that should not have been there.
 */

export type MaintenanceWindowState = NonNullable<components['schemas']['MaintenanceWindowView']['state']>;

/** One window, as `GET /v1/admin/maintenance` describes it. Times are ISO instants. */
export interface MaintenanceWindow {
  readonly id: string;
  readonly state: MaintenanceWindowState;
  readonly startsAt: string;
  /** Null: until further notice. */
  readonly endsAt: string | null;
  readonly announceFrom: string;
  /** Internal only. Readers never see it. */
  readonly note: string | null;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface MaintenanceOverview {
  /** The window in force, or null. */
  readonly current: MaintenanceWindow | null;
  /** Scheduled or announced, soonest first. */
  readonly upcoming: readonly MaintenanceWindow[];
  /** The last twenty that ended or were cancelled. */
  readonly recent: readonly MaintenanceWindow[];
}

type WireWindow = components['schemas']['MaintenanceWindowView'];
type WireOverview = components['schemas']['MaintenanceOverview'];

/*
 * The generated types mark every field optional, because the service's records are read
 * through springdoc without `@Schema(requiredMode)`. The service always sends them; the
 * defaults below are what a missing one would honestly mean rather than a claim that it can
 * be missing.
 */
function windowFrom(wire: WireWindow): MaintenanceWindow {
  return {
    id: wire.id ?? '',
    state: wire.state ?? 'SCHEDULED',
    startsAt: wire.startsAt ?? '',
    endsAt: wire.endsAt ?? null,
    announceFrom: wire.announceFrom ?? wire.startsAt ?? '',
    note: wire.note ?? null,
    createdAt: wire.createdAt ?? '',
    endedAt: wire.endedAt ?? null,
    cancelledAt: wire.cancelledAt ?? null,
  };
}

export function overviewFrom(wire: WireOverview): MaintenanceOverview {
  return {
    current: wire.current ? windowFrom(wire.current) : null,
    upcoming: (wire.upcoming ?? []).map(windowFrom),
    recent: (wire.recent ?? []).map(windowFrom),
  };
}

const BASE = '/v1/admin/maintenance';

export async function readMaintenance(signal?: AbortSignal): Promise<MaintenanceOverview> {
  const response = await authorizedFetch(BASE, { signal });
  if (!response.ok) throw await errorFrom(response);

  return overviewFrom((await response.json()) as WireOverview);
}

export interface ScheduleWindowRequest {
  /** ISO instants. */
  readonly startsAt: string;
  readonly endsAt: string | null;
  /** Null: the service's default, a day before the start. */
  readonly announceFrom: string | null;
  readonly note: string | null;
}

export async function scheduleWindow(request: ScheduleWindowRequest): Promise<MaintenanceWindow> {
  const body: Record<string, string> = { startsAt: request.startsAt };
  if (request.endsAt !== null) body['endsAt'] = request.endsAt;
  if (request.announceFrom !== null) body['announceFrom'] = request.announceFrom;
  if (request.note !== null) body['note'] = request.note;

  return send(BASE, 'POST', body);
}

/** Starts a scheduled or announced window at once. */
export function startWindowNow(id: string): Promise<MaintenanceWindow> {
  return send(`${BASE}/${encodeURIComponent(id)}/start-now`, 'POST');
}

/** Ends the window in force at once. */
export function endWindowNow(id: string): Promise<MaintenanceWindow> {
  return send(`${BASE}/${encodeURIComponent(id)}/end-now`, 'POST');
}

/**
 * Moves the end — later, earlier, or to "until further notice".
 *
 * `null` is sent as JSON `null`, which the service reads as "no announced end"; leaving the
 * field out would mean "leave the end alone", and that is the difference `Patched` exists to
 * carry on the other side.
 */
export function changeWindowEnd(id: string, endsAt: string | null): Promise<MaintenanceWindow> {
  return send(`${BASE}/${encodeURIComponent(id)}`, 'PATCH', { endsAt });
}

/** Cancels a window that has not started. One that has is ended instead. */
export async function cancelWindow(id: string): Promise<void> {
  const response = await authorizedFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw await errorFrom(response);
}

async function send(
  path: string,
  method: string,
  body?: Readonly<Record<string, string | null>>,
): Promise<MaintenanceWindow> {
  const response = await authorizedFetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await errorFrom(response);

  return windowFrom((await response.json()) as WireWindow);
}

/** What the screen offers for a window, by the state the service says it is in. */
export interface WindowActions {
  readonly startNow: boolean;
  readonly endNow: boolean;
  readonly changeEnd: boolean;
  readonly cancel: boolean;
}

export function actionsFor(state: MaintenanceWindowState): WindowActions {
  const upcoming = state === 'SCHEDULED' || state === 'ANNOUNCED';
  return {
    startNow: upcoming,
    endNow: state === 'ACTIVE',
    changeEnd: upcoming || state === 'ACTIVE',
    cancel: upcoming,
  };
}

/**
 * A `datetime-local` value as an instant.
 *
 * The control has no zone: its value is wall-clock time, and the browser's own zone is what
 * the person typing it meant. `new Date('2026-10-04T02:00')` reads it in exactly that zone —
 * the one form of the constructor that does — so the instant sent is the one they saw.
 * `null` for an empty or unparseable value.
 */
export function instantFromLocal(value: string): string | null {
  if (value.trim() === '') return null;

  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** An instant as a `datetime-local` value in the browser's zone, to the minute. */
export function localFromInstant(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}
