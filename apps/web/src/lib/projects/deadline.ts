import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';
import { fillPlaceholders } from '../i18n/placeholders';
import { pluralise, type PluralForms } from '../i18n/plurals';

/**
 * §4.4's live countdown and its "deadline in the viewer's timezone" — the arithmetic half.
 *
 * <h2>Why the arithmetic is here and not in the component</h2>
 *
 * Two surfaces read the same instant and must never disagree about it: the countdown beside
 * the funding figures and the all-or-nothing sentence in the trust block. A campaign whose
 * header says "2 days left" beside a sentence naming a date that has passed is a page a
 * backer cannot trust with money. One function, two callers, and a test that can ask what a
 * campaign looks like ninety seconds before it closes without waiting for that minute.
 *
 * `CampaignPage.daysLeft` already exists and is deliberately not replaced. It is whole days,
 * floored at zero, computed on the server for the badge and the structured data; what §4.4
 * asks for in addition is a countdown that moves. The two are computed from the same
 * `deadline` string, so they cannot drift — the floor of {@link Remaining.days} is exactly
 * `daysLeft`.
 *
 * <h2>Time zones, and the hydration mismatch this file exists to avoid</h2>
 *
 * The server does not know the reader's zone. Nothing carries it: it is not in a header, and
 * the cookie that could carry it would make the page uncacheable, which is the whole
 * argument of §4.4's server-rendered read.
 *
 * So the deadline is formatted <strong>twice</strong>. The server formats it in UTC and puts
 * that in the HTML, labelled as UTC, so a reader with no JavaScript and a crawler both get a
 * real, unambiguous instant. After hydration the client reformats the same instant in the
 * zone the browser reports and swaps the text. Both go through {@link formatInstant} with the
 * same fixed locale, so the only thing that differs between the two renders is the zone —
 * which is the one thing that is allowed to differ.
 *
 * <strong>The locale is passed in rather than left to the browser</strong>, and #324 is when
 * it stopped being a constant. `Intl` with an undefined locale resolves to the reader's, and
 * a server that resolved to a different one would produce a hydration mismatch on the date
 * itself rather than on the zone — which is why this was pinned to `en-GB` with a note saying
 * "when the language is chosen per reader, this constant is what a locale is threaded into".
 *
 * <p>It is threaded in now, and the hydration argument survives intact: both renders read the
 * language off the same `[locale]` path segment, so they cannot disagree about it. The zone is
 * still the only thing allowed to differ between them.
 */

const MILLIS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

export interface Remaining {
  /** True once the deadline has passed. Every other field is zero when it is. */
  readonly past: boolean;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** The whole thing as seconds, for a caller that wants to compare rather than print. */
  readonly totalSeconds: number;
}

const CLOSED: Remaining = Object.freeze({
  past: true,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  totalSeconds: 0,
});

/**
 * How long until a deadline, or `null` when the string is not an instant.
 *
 * <strong>Nothing goes negative.</strong> A campaign that closed a fortnight ago reports
 * `past` and zeroes, for the reason `daysLeftOf` gives about `daysLeft`: a negative
 * countdown is a number nobody has a sentence for, and the component decides the words.
 *
 * @param now injected so a test can ask what the last minute of a campaign looks like
 */
export function remainingUntil(deadline: string, now: Date): Remaining | null {
  const closesAt = Date.parse(deadline);
  if (Number.isNaN(closesAt)) return null;

  const millis = closesAt - now.getTime();
  if (millis <= 0) return CLOSED;

  /*
   * Floored to whole seconds rather than rounded. A countdown that rounds up prints "1
   * minute" for fifty-nine seconds and then jumps to "0" a second later; floored, every
   * number it shows is a number of units that genuinely remain.
   */
  const totalSeconds = Math.floor(millis / MILLIS_PER_SECOND);

  return {
    past: false,
    days: Math.floor(totalSeconds / SECONDS_PER_DAY),
    hours: Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
    minutes: Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    seconds: totalSeconds % SECONDS_PER_MINUTE,
    totalSeconds,
  };
}

/**
 * The countdown's words — `campaign.countdown.units` and `campaign.countdown.pair` (#142).
 *
 * Each unit is a plural group rather than a noun with an `s` glued on. The countdown used to be
 * "1 day" for one and a bare `s` for everything else, which is the whole of English and none of
 * Russian, which picks between three forms by the last digit — 1 день, 2 дня, 5 дней, 21 день —
 * while Azerbaijani and Turkish keep the noun singular after any number. `pluralise` asks
 * `Intl.PluralRules` for the category, the way the rest of the application declines a count
 * that is only known in the browser (`lib/i18n/plurals.ts`).
 *
 * Every form carries `{count}` and leaves the number unsuffixed, so an Azerbaijani unit is
 * `{count} gün` — the #104/#109 rule that no suffix is ever glued onto a value the catalogue
 * has not seen.
 */
export interface CountdownUnits {
  readonly day: PluralForms;
  readonly hour: PluralForms;
  readonly minute: PluralForms;
  readonly second: PluralForms;
  /** Carries `{larger}` and `{smaller}` — the two units, in the language's own order. */
  readonly pair: string;
}

/**
 * The countdown as a reader sees it, in the reader's language.
 *
 * <strong>Two units, never four.</strong> "12 days, 4 hours, 9 minutes, 31 seconds" is a
 * clock rather than a deadline: the last two digits change while somebody is reading the
 * first two, and neither of them changes what the reader is about to decide. So the label
 * shows the largest unit that is not zero and the one below it, and drops to seconds only in
 * the final hour — which is the one hour in a campaign where a second is a fact somebody is
 * acting on.
 *
 * The wording of a closed campaign belongs to the caller, not here: "Closed", "This campaign
 * has ended" and the outcome notice are three different sentences on three different
 * surfaces, and a default returned from this function would be a fourth that nobody chose.
 *
 * <strong>The locale is an argument, never the runtime's.</strong> The server renders the
 * first label and `CampaignCountdown` re-renders it in the browser; both read the `[locale]`
 * segment, so they pick the same plural category and hydration sees the same string.
 */
export function countdownLabel(
  remaining: Remaining,
  units: CountdownUnits,
  locale: Locale,
): string | null {
  if (remaining.past) return null;

  const of = (forms: PluralForms, count: number) => pluralise(locale, forms, count);
  const pair = (larger: string, smaller: string) => fillPlaceholders(units.pair, { larger, smaller });

  if (remaining.days >= 1) {
    return pair(of(units.day, remaining.days), of(units.hour, remaining.hours));
  }
  if (remaining.hours >= 1) {
    return pair(of(units.hour, remaining.hours), of(units.minute, remaining.minutes));
  }
  return pair(of(units.minute, remaining.minutes), of(units.second, remaining.seconds));
}

/**
 * How often a countdown showing {@link countdownLabel} has anything new to say, in
 * milliseconds.
 *
 * A page that repainted every second to change a number that changes every hour is a page
 * doing eighty-six thousand pointless renders a day on the route #119 exists to keep fast.
 * Inside the final hour the label carries seconds and the interval is a second; above it,
 * the smallest unit shown is a minute and so is the tick.
 */
export function countdownIntervalMs(remaining: Remaining): number {
  return remaining.totalSeconds < SECONDS_PER_HOUR ? MILLIS_PER_SECOND : SECONDS_PER_MINUTE * MILLIS_PER_SECOND;
}

/**
 * An instant, written out in a named time zone.
 *
 * The zone is a parameter with no default, deliberately: a default would be the runtime's,
 * which is the reader's browser in one render and the server's container in the other, and
 * the whole point of this function is that its two callers each say which they mean.
 *
 * `timeZoneName` is asked for explicitly, so the string always names the zone it is in.
 * "29 August 2026 at 13:00" is ambiguous by exactly the number of hours that decides whether
 * somebody still has time to pledge.
 *
 * Returns `null` for an unparseable instant or a zone the runtime rejects — a browser can
 * report a zone name a given ICU build does not know — so the caller falls back to what the
 * server already rendered rather than to the string "Invalid Date".
 */
export function formatInstant(instant: string, timeZone: string, locale: Locale): string | null {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) return null;

  try {
    return dateTimeFormat(
      locale,
      {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone,
      },
      `instant:${timeZone}`,
    ).format(new Date(parsed));
  } catch {
    return null;
  }
}

/** A date with no time — for an update's publication day, where the hour says nothing. */
export function formatDay(instant: string, timeZone: string, locale: Locale): string | null {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) return null;

  try {
    return dateTimeFormat(
      locale,
      { day: 'numeric', month: 'long', year: 'numeric', timeZone },
      `day:${timeZone}`,
    ).format(new Date(parsed));
  } catch {
    return null;
  }
}

/** What the server formats in, and the label it is given. */
export const SERVER_TIME_ZONE = 'UTC';

/**
 * The reader's zone, or {@link SERVER_TIME_ZONE} when the runtime will not say.
 *
 * Only ever called from an effect. Calling it during a render would be reading a value the
 * server cannot see and producing markup that disagrees with the HTML being hydrated, which
 * is precisely the mismatch the module comment describes.
 */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || SERVER_TIME_ZONE;
  } catch {
    return SERVER_TIME_ZONE;
  }
}
