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
  /**
   * Keyed by `NotificationType`. Carries `{campaign}` and, where the type has one, `{amount}`; a
   * creator's plan (#450) carries `{plan}` in its place.
   */
  readonly headline: Readonly<Record<string, string>>;
  /** The same types, for a row whose document carries no campaign title. */
  readonly unnamed: Readonly<Record<string, string>>;
  /** What stands in for a figure the document does not carry. */
  readonly amount: Readonly<Record<string, string>>;
  /** The `{when}` of a deadline — #138. `on` carries `{date}`; `unknown` stands in for no date. */
  readonly due: { readonly on: string; readonly unknown: string };
  /**
   * The `{when}` of money paid out — #418: `on` carries `{date}`, `onTo` adds the masked `{account}`
   * it went to when the document has one, and `unknown` stands in for no date.
   */
  readonly sent: { readonly on: string; readonly onTo: string; readonly unknown: string };
  /**
   * The `{when}` of a creator's plan — #450: `on` carries the `{date}` it ends or ended, `until` the
   * `{date}` a payment runs it to, and `unknown` stands in for the second when the document has no date.
   */
  readonly period: { readonly on: string; readonly until: string; readonly unknown: string };
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
    sent: { on: tables.sent.on, onTo: tables.sent.onTo, unknown: tables.sent.unknown },
    period: { on: tables.period.on, until: tables.period.until, unknown: tables.period.unknown },
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
 * the type when the message is not about a campaign (the sign-in alert, since #399 a refund
 * waiting for the backer's bank account, which goes to their pledge, and since #411 the reminder
 * to enter an IBAN, which goes to the payout settings; since #418 a paid payout goes to the payout
 * settings too and a refund sent by bank to the pledge; since #450 a message about the creator's own
 * plan goes to the pricing page, where it is renewed; since #589 a campaign that did not open at
 * its launch time goes to its editor's review tab, where the refusal is explained and the campaign
 * launched — it is not public, so its page is nothing its creator can act on), then the campaign's
 * page, then nothing. **A row with no destination is not a link**, rather than a link to the home
 * page.
 */
export function hrefOf(
  notification: Pick<InboxNotification, 'type' | 'params'>,
  campaignHref: string | null = campaignOf(readParams(notification.params)).href,
): string | null {
  if (notification.type === 'NEW_DEVICE_SIGN_IN') return '/settings/sessions';
  if (isAboutAPlan(notification.type)) return '/pricing';
  if (notification.type === 'PAYOUT_DETAILS_NEEDED' || notification.type === 'PAYOUT_SENT') {
    return '/settings/payout';
  }
  if (notification.type === 'REFUND_NEEDS_BANK_DETAILS' || notification.type === 'REFUND_SENT_BY_BANK') {
    const pledge = textOf(readParams(notification.params), 'pledgeId');
    if (pledge !== null) return `/pledges/${encodeURIComponent(pledge)}`;
  }
  if (notification.type === 'SCHEDULED_LAUNCH_REFUSED') {
    const project = textOf(readParams(notification.params), 'projectId');
    if (project !== null) return `/projects/${encodeURIComponent(project)}/edit/review`;
  }
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
  // A creator's plan is about no campaign (#450), whatever else the document carries.
  const named = isAboutAPlan(notification.type) ? null : campaign.title;

  return {
    campaign: named,
    href: hrefOf(notification, campaign.href),
    headline: headlineOf(notification.type, params, named, copy, locale),
  };
}

/**
 * Whether the row is about the creator's own plan rather than a campaign — #450. Such a row names
 * the plan where another names the campaign, so the `headline` table is the one that names it and
 * `unnamed` the one for a document that carries no plan name.
 *
 * <p>Exported for the application (#452): it does not sell or renew plans (Apple 3.1.1 and Play
 * Billing, #164), so it opens such a row's `/pricing` on the website, in the browser, rather than
 * on its own pricing screen.
 */
export function isAboutAPlan(type: NotificationType): boolean {
  return (
    type === 'SUBSCRIPTION_RENEWAL_DUE' ||
    type === 'SUBSCRIPTION_LAPSED' ||
    type === 'SUBSCRIPTION_RENEWED'
  );
}

function headlineOf(
  type: NotificationType,
  params: Record<string, unknown>,
  campaign: string | null,
  copy: NotificationsCopy,
  locale: Locale,
): string {
  const plan = isAboutAPlan(type) ? textOf(params, 'planName') : null;
  const named = isAboutAPlan(type) ? plan : campaign;
  const template = named === null ? copy.unnamed[type] : copy.headline[type];
  if (template === undefined) return type;

  return fillPlaceholders(template, {
    campaign: campaign ?? '',
    plan: plan ?? '',
    amount: amountFor(type, params, copy),
    when: whenFor(type, params, copy, locale),
  });
}

/**
 * The day a headline refers to, or the words that stand in for one: a deadline's (#138), the day
 * money was paid out and the masked account it went to (#418), or the day a creator's plan ends,
 * ended or is paid until (#450). All are calendar days, read in UTC so that no reader's time zone
 * moves them to the day before.
 */
function whenFor(
  type: NotificationType,
  params: Record<string, unknown>,
  copy: NotificationsCopy,
  locale: Locale,
): string {
  if (type === 'UPDATE_DUE_SOON') {
    const date = dayOf(params, 'dueAt', locale);
    return date === null ? copy.due.unknown : fillPlaceholders(copy.due.on, { date });
  }
  if (type === 'PAYOUT_SENT' || type === 'REFUND_SENT_BY_BANK') {
    const date = dayOf(params, 'sentOn', locale);
    if (date === null) return copy.sent.unknown;
    const account = textOf(params, 'accountHint');
    return account === null
      ? fillPlaceholders(copy.sent.on, { date })
      : fillPlaceholders(copy.sent.onTo, { date, account });
  }
  if (type === 'SUBSCRIPTION_RENEWAL_DUE' || type === 'SUBSCRIPTION_LAPSED') {
    // The day the plan ends, or ended. Without one, the words a deadline and a past payment use.
    const date = dayOf(params, 'periodEnd', locale);
    if (date !== null) return fillPlaceholders(copy.period.on, { date });
    return type === 'SUBSCRIPTION_RENEWAL_DUE' ? copy.due.unknown : copy.sent.unknown;
  }
  if (type === 'SUBSCRIPTION_RENEWED') {
    const date = dayOf(params, 'periodEnd', locale);
    return date === null ? copy.period.unknown : fillPlaceholders(copy.period.until, { date });
  }
  return '';
}

/** A `YYYY-MM-DD` day from the document, written out in the reader's language, or null. */
function dayOf(params: Record<string, unknown>, key: string, locale: Locale): string | null {
  const day = textOf(params, key);
  const at = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  if (at === null || Number.isNaN(at.getTime())) return null;

  return dateTimeFormat(
    locale,
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
    'notification-due',
  ).format(at);
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
    case 'REFUND_SENT_BY_BANK':
      return amountOr(params, 'amount', copy.amount['refund'] ?? '');
    case 'SUBSCRIPTION_RENEWAL_DUE':
    case 'SUBSCRIPTION_LAPSED':
      return amountOr(params, 'price', copy.amount['price'] ?? '');
    case 'SUBSCRIPTION_RENEWED':
      return amountOr(params, 'amount', copy.amount['price'] ?? '');
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
