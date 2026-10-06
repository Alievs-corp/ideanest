import type { components } from '@ideanest/api-client';
import {
  UNDATED,
  capitalised,
  dateTimeFormat,
  relativeTimeFormat,
} from '@ideanest/messages/formats';
import type { Locale } from '@ideanest/messages/locale';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { formatMoney } from '@ideanest/money/format';
import type { DeliveryMode, NotificationCategory, NotificationChannel } from './notifications';

/**
 * What one inbox notification says, and where opening it goes — #88, moved here from the web's
 * `lib/notifications/describe.ts` for the app's inbox (#160). Both clients build the same sentence
 * and the same destination from `type + params`.
 *
 * <h2>The copy is handed in</h2>
 *
 * This module is imported by client bundles and cannot read a catalogue, so each client passes
 * the `account.notifications` tables it resolved ({@link NotificationsCopy}). The wording echoes
 * `messages.properties`: a notification read in the inbox and again in a digest email should not
 * be two different sentences about the same thing.
 *
 * <h2>`params` arrives already parsed, and {@link readParams} only narrows it</h2>
 *
 * The service emits the `jsonb` column with `@JsonRawValue`, so `response.json()` has already
 * done the one parse this document gets. {@link readParams} never parses again and never throws:
 * anything that is not a plain object produces a row with the campaign missing rather than an
 * inbox that fails to render. Money is read as the API's `{amount, currency}` object and
 * formatted by `@ideanest/money`, never by `Number()`.
 *
 * <h2>Hrefs are locale-less</h2>
 *
 * `/projects/{creator}/{slug}` and `/settings/sessions`: the app's route names as they are, and
 * the web's `Link` adds the locale segment itself.
 */

type ContractNotification = components['schemas']['NotificationResponse'];

export type NotificationType = NonNullable<ContractNotification['type']>;

/** One row of the inbox. */
export interface InboxNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  /** What it is about — `project`, `pledge` — or absent. */
  readonly subjectType?: string;
  /** Which one. Whole or absent with `subjectType`. */
  readonly subjectId?: string;
  /**
   * The rendering document — an object, not a string, although the generated contract says
   * `string`: springdoc sees the Java field's declared type and not that `@JsonRawValue` splices
   * the column into the body. Only this module reads it.
   */
  readonly params: Record<string, unknown>;
  /** ISO-8601 instant. When the reported thing happened, not when the row was written. */
  readonly occurredAt: string;
  /** ISO-8601 instant, or absent (or null) while unread. */
  readonly readAt?: string | null;
}

/** One page of the inbox, and the badge number. */
export interface InboxPage {
  readonly notifications: readonly InboxNotification[];
  /** Send back as `?before=`. Whole or absent with `nextCursorId`. */
  readonly nextCursor?: string;
  /** Send back as `?beforeId=`. */
  readonly nextCursorId?: string;
  /** Across the whole inbox, not this page. */
  readonly unreadCount: number;
}

/**
 * The position to continue an inbox listing from. Both halves or neither: the ordering is
 * `(occurredAt, id)`, and the service refuses half a cursor with a 400 rather than guessing.
 */
export interface InboxCursor {
  readonly before: string;
  readonly beforeId: string;
}

/** The cursor a page hands back, or null on the last page. Never half of one. */
export function cursorOf(page: Pick<InboxPage, 'nextCursor' | 'nextCursorId'>): InboxCursor | null {
  return page.nextCursor !== undefined &&
    page.nextCursor !== null &&
    page.nextCursorId !== undefined &&
    page.nextCursorId !== null
    ? { before: page.nextCursor, beforeId: page.nextCursorId }
    : null;
}

/**
 * The `account.notifications` words a description needs. Two headline tables rather than one
 * sentence with a stand-in: the template that names the campaign and the one that does not are
 * different sentences in every language, as `messages.properties` splits a key from its `.named`
 * twin.
 */
export interface NotificationsCopy {
  /** Keyed by `NotificationType`. Carries `{campaign}` and, where the type has one, `{amount}`. */
  readonly headline: Readonly<Record<string, string>>;
  /** The same types, for a row whose document carries no campaign title. */
  readonly unnamed: Readonly<Record<string, string>>;
  /** What stands in for a figure the document does not carry. */
  readonly amount: Readonly<Record<string, string>>;
  /** The `{when}` of a deadline — #138. `on` carries `{date}`; `unknown` stands in for no date. */
  readonly due: { readonly on: string; readonly unknown: string };
  readonly category: Readonly<Record<string, string>>;
  readonly categoryDescription: Readonly<Record<string, string>>;
  readonly channel: Readonly<Record<string, string>>;
  readonly mode: Readonly<Record<string, string>>;
  readonly mandatorySecurity: string;
  readonly mandatoryOther: string;
}

/** The tables out of a catalogue's `account.notifications` — the app's whole catalogue is in memory. */
export function notificationsCopyOf(tables: NotificationsCopy): NotificationsCopy {
  return {
    headline: tables.headline,
    unnamed: tables.unnamed,
    amount: tables.amount,
    due: { on: tables.due.on, unknown: tables.due.unknown },
    category: tables.category,
    categoryDescription: tables.categoryDescription,
    channel: tables.channel,
    mode: tables.mode,
    mandatorySecurity: tables.mandatorySecurity,
    mandatoryOther: tables.mandatoryOther,
  };
}

/** One notification, as a reader sees it. */
export interface NotificationView {
  /** The whole message, in one line. */
  readonly headline: string;
  /** The campaign it is about, when the document names one — #249. */
  readonly campaign: string | null;
  /** Where opening it goes, locale-less, or null when the platform has no page for it. */
  readonly href: string | null;
}

/** Whether the row is still unread. */
export function isUnread(notification: Pick<InboxNotification, 'readAt'>): boolean {
  return notification.readAt === undefined || notification.readAt === null;
}

/** The rendering document, or an empty one. */
export function readParams(params: unknown): Record<string, unknown> {
  // An array would index by number and read nothing, and a row from a build that still sent a
  // JSON string is read as absent rather than crashing the row it arrived on.
  return typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function textOf(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * An amount from the document, formatted, or null. The shape is checked: `formatMoney` splits
 * `amount` on a full stop, so an amount that arrived as a JSON number would render something
 * plausible and wrong.
 */
function moneyOf(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (typeof value !== 'object' || value === null) return null;

  const money = value as { amount?: unknown; currency?: unknown };
  if (typeof money.amount !== 'string' || typeof money.currency !== 'string') return null;

  return formatMoney({ amount: money.amount, currency: money.currency });
}

/**
 * The campaign this notification is about: what it is called, and its page. **The link needs
 * both slugs** — §10.2's campaign page is `/projects/{creatorSlug}/{projectSlug}`, so half a pair
 * is no link rather than a shorter one.
 */
export function campaignOf(params: Record<string, unknown>): {
  readonly title: string | null;
  readonly href: string | null;
} {
  const creatorSlug = textOf(params, 'creatorSlug');
  const projectSlug = textOf(params, 'projectSlug');

  return {
    title: textOf(params, 'projectTitle'),
    href:
      creatorSlug !== null && projectSlug !== null
        ? `/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`
        : null,
  };
}

/**
 * Where the row goes, in `EmailComposer`'s order so the inbox and the email land in one place:
 * the type when the message is not about a campaign (only the sign-in alert), then the campaign's
 * page, then nothing. **A row with no destination is not a link**, rather than a link to the home
 * page.
 */
export function hrefOf(
  notification: Pick<InboxNotification, 'type' | 'params'>,
  campaignHref: string | null = campaignOf(readParams(notification.params)).href,
): string | null {
  if (notification.type === 'NEW_DEVICE_SIGN_IN') return '/settings/sessions';
  return campaignHref;
}

/**
 * What this notification says. Every type yields a sentence from the catalogue; a type this build
 * has no sentence for renders its own name rather than an empty row, and
 * `inbox.test.ts` holds every catalogue to the contract's whole list so that never ships.
 */
export function describeNotification(
  notification: InboxNotification,
  copy: NotificationsCopy,
  locale: Locale,
): NotificationView {
  const params = readParams(notification.params);
  const campaign = campaignOf(params);
  const named = campaign.title;

  return {
    campaign: named,
    href: hrefOf(notification, campaign.href),
    headline: headlineOf(notification.type, params, named, copy, locale),
  };
}

function headlineOf(
  type: NotificationType,
  params: Record<string, unknown>,
  campaign: string | null,
  copy: NotificationsCopy,
  locale: Locale,
): string {
  const template = campaign === null ? copy.unnamed[type] : copy.headline[type];
  if (template === undefined) return type;

  return fillPlaceholders(template, {
    campaign: campaign ?? '',
    amount: amountFor(type, params, copy),
    when: whenFor(type, params, copy, locale),
  });
}

/**
 * The deadline a headline refers to, or the words that stand in for one — #138. `dueAt` is a
 * calendar day, read in UTC so that no reader's time zone moves it to the day before.
 */
function whenFor(
  type: NotificationType,
  params: Record<string, unknown>,
  copy: NotificationsCopy,
  locale: Locale,
): string {
  if (type !== 'UPDATE_DUE_SOON') return '';

  const day = textOf(params, 'dueAt');
  const at = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  if (at === null || Number.isNaN(at.getTime())) return copy.due.unknown;

  const date = dateTimeFormat(
    locale,
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
    'notification-due',
  ).format(at);
  return fillPlaceholders(copy.due.on, { date });
}

function amountOr(params: Record<string, unknown>, key: string, fallback: string): string {
  return moneyOf(params, key) ?? fallback;
}

/**
 * The figure a headline refers to, or the catalogue's words for it. Which key a type reads is a
 * fact about the event, so it stays here; the fallback is a sentence somebody receives, so it is
 * copy.
 */
function amountFor(
  type: NotificationType,
  params: Record<string, unknown>,
  copy: NotificationsCopy,
): string {
  switch (type) {
    case 'PLEDGE_CONFIRMED':
      return amountOr(params, 'total', copy.amount['total'] ?? '');
    case 'PLEDGE_EDITED':
      return amountOr(params, 'total', copy.amount['newTotal'] ?? '');
    case 'PAYMENT_FAILED':
    case 'PAYMENT_COLLECTED':
    case 'FINAL_PAYMENT_WARNING':
      return amountOr(params, 'amount', copy.amount['pledge'] ?? '');
    case 'GOAL_REACHED':
      return amountOr(params, 'goal', copy.amount['needed'] ?? '');
    case 'CAMPAIGN_SUCCEEDED':
      return amountOr(params, 'pledged', copy.amount['closingTotal'] ?? '');
    case 'PAYOUT_SENT':
      return amountOr(params, 'amount', copy.amount['funds'] ?? '');
    default:
      return '';
  }
}

export function categoryLabel(category: NotificationCategory, copy: NotificationsCopy): string {
  return copy.category[category] ?? category;
}

export function categoryDescription(
  category: NotificationCategory,
  copy: NotificationsCopy,
): string {
  return copy.categoryDescription[category] ?? '';
}

export function channelLabel(channel: NotificationChannel, copy: NotificationsCopy): string {
  return copy.channel[channel] ?? channel;
}

export function modeLabel(mode: DeliveryMode, copy: NotificationsCopy): string {
  return copy.mode[mode] ?? mode;
}

/**
 * Why a switch the service marks unchangeable cannot be moved. §4.10 makes only `SECURITY`
 * mandatory today; the fallback keeps a category that becomes mandatory later from claiming
 * anything about account safety.
 */
export function mandatoryReason(
  category: NotificationCategory,
  copy: Pick<NotificationsCopy, 'mandatorySecurity' | 'mandatoryOther'>,
): string {
  return category === 'SECURITY' ? copy.mandatorySecurity : copy.mandatoryOther;
}

/**
 * The calendar day an instant falls on, for grouping the inbox. Local rather than UTC: the reader
 * groups by their own day.
 */
export function dayKeyOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'unknown' : dayKeyOfDate(at);
}

function dayKeyOfDate(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
}

/**
 * "Today", "Dünən", "Вчера", or the full date — the heading above one day's rows. The two words
 * come from `Intl.RelativeTimeFormat` (`numeric: 'auto'`) rather than the catalogue, capitalised
 * in the reader's own language (`toUpperCase` would turn Turkish `içinde` into `Içinde`).
 */
export function dayLabelOf(iso: string, now: Date, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNDATED[locale];

  const relative = relativeTimeFormat(locale, { numeric: 'auto' }, 'relative');
  const key = dayKeyOfDate(at);
  if (key === dayKeyOfDate(now)) return capitalised(relative.format(0, 'day'), locale);

  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKeyOfDate(yesterday)) return capitalised(relative.format(-1, 'day'), locale);

  return dateTimeFormat(locale, { dateStyle: 'full' }, 'day-heading').format(at);
}

/** "All", or one of §4.10's seven groups. */
export type InboxFilter = NotificationCategory | 'ALL';

/**
 * The rows the two filters allow. Applied on the client to the pages already loaded — the
 * endpoint takes a cursor and nothing else — so "none" means "none in what has loaded".
 */
export function visibleNotifications<T extends Pick<InboxNotification, 'category' | 'readAt'>>(
  notifications: readonly T[],
  filter: InboxFilter,
  unreadOnly: boolean,
): readonly T[] {
  return notifications.filter(
    (row) => (filter === 'ALL' || row.category === filter) && (!unreadOnly || isUnread(row)),
  );
}

/** The rows split into consecutive runs that fall on one local calendar day. */
export function groupByDay<T extends Pick<InboxNotification, 'occurredAt'>>(
  notifications: readonly T[],
): ReadonlyArray<readonly [key: string, rows: readonly T[]]> {
  const groups: Array<[string, T[]]> = [];
  for (const row of notifications) {
    const key = dayKeyOf(row.occurredAt);
    const last = groups.at(-1);
    if (last !== undefined && last[0] === key) last[1].push(row);
    else groups.push([key, [row]]);
  }
  return groups;
}
