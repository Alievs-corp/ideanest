import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-14: the record of every privileged action — issue #314.
 *
 * <p>`audit_logs` has been written to since #107 and nothing has ever read it except a psql
 * session. What this module talks to is the read that arrived with this epic, over rows the
 * database refuses to change: V21 puts a trigger on the table that raises on UPDATE, DELETE
 * and TRUNCATE, so nothing here can be a stale copy of something that has since been edited.
 *
 * <p><strong>Two callers, and the second is the reason the filter matters.</strong>
 * `/admin/audit` is the trail. `/admin/moderation/{id}` asks the same endpoint for the
 * history of one report, which is what makes AD-01's decision detail a history rather than a
 * snapshot of the current state.
 */

/** What an actor was acting as — not the same question as who they were. */
export type AuditActorType = 'USER' | 'MODERATOR' | 'SYSTEM';

/**
 * Whether the action happened or was refused.
 *
 * A refusal is a row: the attempt is what happened, and a trail holding only the successes
 * cannot show somebody trying.
 */
export type AuditOutcome = 'SUCCEEDED' | 'REFUSED';

/**
 * One privileged action.
 *
 * Optional fields are `?: T | null` because the service serialises with
 * `default-property-inclusion: non_null` — an absent source address is absent from the JSON
 * rather than present and null.
 */
export interface AuditEntry {
  id: string;
  /** ISO-8601 instant, UTC, from the database's clock rather than the application's. */
  occurredAt: string;
  actorType: AuditActorType;
  /** Absent when the actor was the platform itself. */
  actorId?: string | null;
  /**
   * Whom the action was taken for, when somebody else took it.
   *
   * Absent on effectively every row today: the column exists for AD-04's audited
   * impersonation (#299), which is unbuilt and blocked on a policy question.
   */
  onBehalfOfId?: string | null;
  /** The service's own spelling — `project.approved`, `report.upheld`, `account.suspended`. */
  action: string;
  entityType: string;
  entityId: string;
  outcome: AuditOutcome;
  /** Redacted on the way in, per §17.4. Absent where the request had none. */
  sourceAddress?: string | null;
  userAgent?: string | null;
  /** The correlation identifier this row shares with §18.1's log lines for the same request. */
  requestId?: string | null;
  traceId?: string | null;
  /** What the action recorded about itself. Prose, and only ever rendered as text. */
  detail?: string | null;
}

export interface AuditTrailPage {
  /** Echoed, and absent when the request asked about every kind. See {@link TrailRequest}. */
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  /** The earliest instant included, echoed, absent when unbounded — issue #404. */
  from?: string | null;
  /** The first instant excluded, echoed, absent when unbounded. */
  to?: string | null;
  entries: AuditEntry[];
  /**
   * Absent on the last page. Opaque, and hand it back as `after` unchanged.
   *
   * <p>It used to be the last row's identifier, on the argument that a UUID v7 carries the
   * millisecond it was minted in (§7.3). #404 is what that cost: the key is minted by the
   * application and `occurred_at` is the database's, so the two orders disagree — and this
   * screen displays the second while the query ordered by the first. A page headed "newest
   * first" opened on last month. The trail is ordered by `occurred_at` now, which is not
   * unique, so the cursor carries the instant and the identifier that breaks its tie.
   */
  nextCursor?: string | null;
}

/**
 * Under the service's default page and well under its ceiling.
 *
 * Twenty-five, matching every other console list. A first paint holding a hundred audit rows
 * is a hundred rows nobody has read.
 */
export const TRAIL_PAGE_SIZE = 25;

/**
 * What the trail may be narrowed by, which is less than a reader might expect.
 *
 * <p>The service accepts an entity kind, one entity, or one actor, and nothing else — those
 * are the three indexes V21 created, and a filter outside them is a sequential scan over the
 * one table on the platform that only ever grows and is never pruned. Still absent, and each
 * one migration away on the day somebody needs it: a filter on the action, and any search
 * over `detail`.
 *
 * <p><strong>The date range is the exception, and #404 is why it is here.</strong> Every one
 * of V21's four indexes ends in `occurred_at DESC`, so a range over that column narrows the
 * scan the shape above had already chosen rather than adding one — it is the only filter that
 * composes with all four for free. "What did this person do last Tuesday" is the question an
 * audit log exists to answer, and answering it by paging until the dates stopped being
 * interesting was not reading, it was scrolling.
 *
 * <p>An entity identifier without a kind is <strong>dropped by the service</strong> rather
 * than applied — the index leads on the kind — and the response says so by echoing an empty
 * filter. This client sends what it is given and reads back what was used.
 */
export interface TrailRequest {
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  /** ISO-8601 instant. Inclusive: a reader who asks for Tuesday means from its midnight. */
  from?: string | null;
  /**
   * ISO-8601 instant. **Exclusive**, so two adjacent days partition the rows between them
   * rather than both claiming midnight. {@link dayBounds} is what turns a chosen day into
   * this pair.
   */
  to?: string | null;
  /** The previous page's `nextCursor`. */
  after?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * A day the reader chose, as the pair of instants the service wants — issue #404.
 *
 * <p><strong>The reader's day and not UTC's.</strong> An `<input type="date">` yields
 * `2026-09-02` with no zone, and a moderator asking about the second of September means the
 * second of September where they are. `new Date(year, month, day)` reads the browser's
 * timezone, which is the only definition of "that day" the reader would recognise; parsing
 * the string as UTC would give somebody in Baku a window running from three in the morning.
 *
 * <p>The upper bound is the *next* day's midnight, because the service's `to` is exclusive.
 * That is what makes "from the 2nd to the 2nd" one whole day rather than one instant.
 *
 * @param day `YYYY-MM-DD`, or empty for no bound
 * @param edge which end of the range this value is
 * @returns the instant, or null when there is no bound and for a value that is not a date
 */
export function dayBounds(day: string, edge: 'from' | 'to'): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (parts === null) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const date = Number(parts[3]);

  // Local midnight, then one day later for the exclusive end. The constructor rolls a day
  // past the end of its month over, so the 31st of a 31-day month gives the 1st of the next.
  const moment = new Date(year, month - 1, edge === 'to' ? date + 1 : date);
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}

export function trailQuery(request: TrailRequest): string {
  const params = new URLSearchParams();
  params.set('limit', String(request.limit ?? TRAIL_PAGE_SIZE));
  if (request.entityType != null && request.entityType !== '')
    params.set('entityType', request.entityType);
  if (request.entityId != null && request.entityId !== '') params.set('entityId', request.entityId);
  if (request.actorId != null && request.actorId !== '') params.set('actorId', request.actorId);
  if (request.from != null && request.from !== '') params.set('from', request.from);
  if (request.to != null && request.to !== '') params.set('to', request.to);
  if (request.after != null && request.after !== '') params.set('after', request.after);
  return params.toString();
}

/** One page of the trail, newest first. */
export async function readTrail(request: TrailRequest = {}): Promise<AuditTrailPage> {
  const response = await authorizedFetch(`/v1/admin/audit?${trailQuery(request)}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AuditTrailPage;
}

/**
 * The entity kinds the trail is worth narrowing to.
 *
 * <p>Taken from `AuditAction.entityType()` on the service side — the values are open text in
 * the column and a closed set on the writing side, so this list is what the platform can
 * actually produce rather than a guess. A kind that stopped being written would show as an
 * empty page rather than as a missing option, which is the honest failure of the two.
 *
 * <p><strong>Values only since #324.</strong> This used to be a list of pairs carrying the
 * English word for each kind, which put a translatable sentence in a module a server renders
 * and a client imports. The words are `admin.screens.audit.entity` now, keyed by these same
 * values, and this array stays the one place that says which kinds exist.
 */
export const AUDIT_ENTITY_TYPES: readonly string[] = Object.freeze([
  'project',
  'account',
  'report',
  'collaborator',
  'session',
  'collection',
  'maintenance_window',
]);

/**
 * The action table, in the shape the catalogue has to hold it: the group, then the rest.
 *
 * <p>`project.approved` is two nodes in the message file rather than one key, because
 * next-intl reads a `.` in a key as nesting and refuses a key that carries one.
 */
export type AuditActionLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The action, in words, from a table the caller resolved.
 *
 * <p>A lookup with a fallback rather than an exhaustive map, and the fallback is the point:
 * the service's set grows with every feature that adds a privileged action, and a screen that
 * rendered nothing for an action it had not been taught would be hiding exactly the row
 * somebody is looking for. An unknown action shows its wire spelling, which is readable.
 *
 * <p>The table is a parameter rather than a constant here because this module is imported by a
 * client component, and a catalogue cannot be read from one. The screen resolves it on the
 * server and hands it down, which is what every other translated component in this application
 * does.
 *
 * <p><strong>The wire spelling is split rather than looked up whole.</strong> The service
 * spells an action `project.approved`, and next-intl refuses a catalogue key carrying a `.` -
 * the character expresses nesting there, so a flat key is an INVALID_KEY error rather than a
 * message. The two halves are two levels in {@link AuditActionLabels}, and an action carrying
 * no `.` at all cannot be in the table, so it falls straight through to its wire spelling.
 */
export function actionLabel(action: string, labels: AuditActionLabels): string {
  const separator = action.indexOf('.');
  if (separator < 0) return action;

  return labels[action.slice(0, separator)]?.[action.slice(separator + 1)] ?? action;
}
