import type { Maintenance } from '@ideanest/api-client/maintenance';
import type { Locale } from '@ideanest/messages';
import { formatDate, formatDateTime, formatTime } from './i18n';
import type { StatusWindow } from './platform-status';

/**
 * Which `shell.maintenance` sentence to show, and what goes in its placeholders — issue #214.
 *
 * The catalogue carries the sentence with holes in it; the times arrive as ISO instants and are
 * written here in the reader's language and the phone's time zone, which is the reader's. The
 * key and the values are returned rather than a finished string so the screen resolves the
 * message through its own `useT`, typed, and re-renders when the language changes.
 *
 * <p>An end on a different day from its start carries its date, so a window from 23:00 to 01:00
 * does not read as ending before it began.
 */

export interface MaintenanceMessage<Key extends string> {
  readonly key: Key;
  readonly values: Readonly<Record<string, string>>;
}

/** The banner's sentence for an announced window. */
export function upcomingMessage(
  window: StatusWindow,
  locale: Locale,
): MaintenanceMessage<'upcoming' | 'upcomingOpenEnded'> {
  const date = formatDate(window.startsAt, locale);
  const start = formatTime(window.startsAt, locale);
  if (window.endsAt === null) return { key: 'upcomingOpenEnded', values: { date, start } };

  const sameDay = formatDate(window.endsAt, locale) === date;
  const end = sameDay ? formatTime(window.endsAt, locale) : formatDateTime(window.endsAt, locale);
  return { key: 'upcoming', values: { date, start, end } };
}

/**
 * The maintenance screen's line about the end: "Back around 02:30", or that none is announced.
 * Null from the edge, whose own wording already says all that is known.
 */
export function untilMessage(
  maintenance: Maintenance,
  locale: Locale,
  now: number = Date.now(),
): MaintenanceMessage<'until' | 'untilUnknown'> | null {
  if (maintenance.source === 'edge') return null;
  if (maintenance.endsAt === null) return { key: 'untilUnknown', values: {} };

  const today = formatDate(new Date(now).toISOString(), locale);
  const sameDay = formatDate(maintenance.endsAt, locale) === today;
  const time = sameDay
    ? formatTime(maintenance.endsAt, locale)
    : formatDateTime(maintenance.endsAt, locale);
  return { key: 'until', values: { time } };
}
