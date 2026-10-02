import { capitalised, dateTimeFormat, relativeTimeFormat, UNDATED } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import type { NotificationsCopy } from '../i18n/notifications-copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { formatMoney, type Money } from '../money';
import type {
  DeliveryMode,
  InboxNotification,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from './api';

/**
 * What one notification says, and where opening it goes — #88.
 *
 * <h2>The copy lives here, not in the component</h2>
 *
 * A row is a sentence, and the sentence depends on the type and on what the rendering
 * document happens to carry. Keeping that in a pure function is what lets it be tested
 * against every type without mounting anything, which matters because there are
 * twenty-two of them and thirteen have no producer yet — a template that renders a hole is
 * discovered here rather than by whoever eventually receives the first one.
 *
 * The wording deliberately echoes `messages.properties`. A notification a person reads in
 * the inbox and then again in a digest email should not be two different sentences about
 * the same thing.
 *
 * <h2>`params` arrives already parsed, and {@link readParams} only narrows it</h2>
 *
 * The service emits the `jsonb` column with `@JsonRawValue`, splicing it into the response
 * body as an object rather than encoding it as a nested string — `NotificationResponse`
 * argues why: a decode-and-re-serialise would put every money amount in it through a
 * `double`. `response.json()` on the client has therefore already done the one parse this
 * document gets; {@link readParams} never calls `JSON.parse` again, and it never throws:
 * anything that is not a plain object — `undefined`, `null`, an array, a stray primitive —
 * produces a row with the campaign missing rather than an inbox that fails to render. Money
 * is read as the API's `{amount, currency}` object and formatted by `lib/money`, never by
 * `Number()`.
 */

/** One notification, as a reader sees it. */
export interface NotificationView {
  /** The whole message, in one line. */
  readonly headline: string;
  /** The campaign it is about, when the document names one — #249. */
  readonly campaign: string | null;
  /** Where opening it goes, or null when the platform has no page for it yet. */
  readonly href: string | null;
}

/** The rendering document, or an empty one. */
export function readParams(params: unknown): Record<string, unknown> {
  // `notifications_params_is_an_object` keeps the column an object on the service side, so
  // this is the second lock. An array would otherwise index by number below and read
  // nothing, and a row from a build that still sent a JSON string is read as absent rather
  // than crashing the row it arrived on.
  return typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function textOf(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * An amount from the document, formatted, or null.
 *
 * The shape is checked rather than assumed: `formatMoney` splits `amount` on a full stop,
 * so a document whose amount arrived as a JSON number would render something plausible and
 * wrong. §10.3 says an amount crosses the API as a string; a document that disagrees is one
 * this function declines to read.
 */
function moneyOf(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (typeof value !== 'object' || value === null) return null;

  const money = value as Partial<Money>;
  if (typeof money.amount !== 'string' || typeof money.currency !== 'string') return null;

  return formatMoney({ amount: money.amount, currency: money.currency });
}

/**
 * The campaign this notification is about: what it is called, and its page.
 *
 * Both come from the document, which has carried them since #249. A row written before
 * that has neither, and this answers nulls — which is why every sentence below still reads
 * correctly with `campaign` absent.
 *
 * **The link needs both slugs.** §10.2's campaign page is
 * `/projects/{creatorSlug}/{projectSlug}`; a path built from the identifier matches no
 * route, so half a pair is no link rather than a shorter one.
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
 * A fact the sentence needs, or the phrase that stands in for it.
 *
 * A missing amount is possible on any row — a malformed document, a producer that changed
 * its payload — and "your pledge of  is confirmed" is worse than a vaguer sentence. So
 * every use below has a fallback and none of them is a blank.
 */
function amountOr(params: Record<string, unknown>, key: string, fallback: string): string {
  return moneyOf(params, key) ?? fallback;
}

/**
 * What this notification says.
 *
 * The switch is exhaustive over `NotificationType` and has no `default`, so a type added to
 * the contract fails to compile here until somebody has decided what the inbox says about
 * it — the same property `EmailComposer`'s switch has on the service side, and for the same
 * reason: the alternative is a row that renders an empty line, found by a reader.
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
  /*
   * TWO TABLES, NOT ONE SENTENCE WITH A STAND-IN — issue #324. The template that names the
   * campaign and the one that does not are different sentences in every language, and in some
   * of them the campaign is not at the front. `lib/i18n/notifications-copy.ts` carries the
   * argument; it is the same one `messages.properties` makes about its `.named` keys.
   */
  const template = campaign === null ? copy.unnamed[type] : copy.headline[type];

  /* A type this build has no sentence for renders its own name rather than an empty row. */
  if (template === undefined) return type;

  return fillPlaceholders(template, {
    campaign: campaign ?? '',
    amount: amountFor(type, params, copy),
    when: whenFor(type, params, copy, locale),
  });
}

/**
 * The deadline a headline refers to, or the words that stand in for one — #138.
 *
 * <p>`dueAt` is a calendar day (`2026-10-05`), not an instant: `NotificationEventListener`
 * formats it before it is stored, because the day is what the creator agreed to. It is read
 * as that day in UTC so that no reader's time zone moves it to the day before.
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

/**
 * The figure a headline refers to, or the words that stand in for one.
 *
 * <p>Which key in the document a type reads is a fact about the event rather than copy, so it
 * stays here. What is printed when the document does not carry it is a sentence somebody
 * receives, so that is in the catalogue.
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
      /* Every other type's sentence carries no {amount}, so nothing is looked up for it. */
      return '';
  }
}

/**
 * Where the row goes.
 *
 * Three sources, in this order — and it is `EmailComposer`'s order, so that a notification
 * opened from the inbox and the same one opened from an email land in the same place.
 *
 * 1. The type, when the message is not about a campaign. Only the sign-in alert is.
 * 2. The campaign's public path, from the two slugs in the document.
 * 3. Nothing. **A row with no destination is not a link**, rather than a link to the home
 *    page: the platform's own rule is that a live-looking control which goes nowhere useful
 *    is worse than a plain line of text, and unlike an email — where the reader has already
 *    left the application and needs a way back — an inbox row is already inside it.
 */
function hrefOf(notification: InboxNotification, campaignHref: string | null): string | null {
  if (notification.type === 'NEW_DEVICE_SIGN_IN') return '/settings/sessions';
  return campaignHref;
}

/*
 * `CATEGORIES`, `CHANNELS` and `modesFor` — the table's order and the modes a switch offers —
 * are `@ideanest/account/notifications` now, shared with the app (#161).
 */

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

/**
 * Why a switch the service marks unchangeable cannot be moved.
 *
 * Per category rather than one sentence, because a disabled control with no reason is a
 * control that looks broken — and the reason differs. §4.10 makes only `SECURITY`
 * mandatory today; the fallback is here so that a category that becomes mandatory later
 * shows something true rather than a claim about account safety.
 */
export function mandatoryReason(
  category: NotificationCategory,
  copy: NotificationsCopy,
): string {
  return category === 'SECURITY' ? copy.mandatorySecurity : copy.mandatoryOther;
}

export function modeLabel(mode: DeliveryMode, copy: NotificationsCopy): string {
  return copy.mode[mode] ?? mode;
}

/**
 * The calendar day an instant falls on, for grouping the inbox.
 *
 * Local rather than UTC: the reader groups by their own day, so a notification that arrived
 * at half past midnight belongs under today for them even where it is still yesterday in
 * UTC.
 */
export function dayKeyOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'unknown' : dayKeyOfDate(at);
}

function dayKeyOfDate(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
}

/**
 * "Today", "Dünən", "Вчера", or the date — the heading above one group of rows.
 *
 * `now` is a parameter for `formatRelativeTime`'s reason: a function that reads the clock
 * cannot be tested without freezing it.
 *
 * <h2>The two words come from `Intl` rather than from the catalogue — #324</h2>
 *
 * `RelativeTimeFormat` with `numeric: 'auto'` already knows every language's word for today
 * and for yesterday, and it is the same formatter the rest of the application's relative
 * times come out of. Two keys in `messages/*.json` would be two translations to keep in step
 * with a library that ships them — and would be one more thing for this module, which is
 * imported by a client component with no provider above it, to have to be handed.
 *
 * <p>The output is lower case in all four languages and this is a heading, so it goes through
 * `capitalised`, which upper-cases in the reader's own language. That distinction is not
 * pedantry: `toUpperCase` turns Turkish `içinde` into `Içinde`, which is a different word.
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
