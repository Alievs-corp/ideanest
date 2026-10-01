import type { Locale } from '@ideanest/messages/locale';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise, type PluralForms } from '@ideanest/messages/plurals';

/**
 * §4.4's live countdown and the campaign's days left — the arithmetic, for both clients.
 *
 * <h2>Why the arithmetic is here and not in a component</h2>
 *
 * Two surfaces read the same instant and must never disagree about it: the countdown beside
 * the funding figures and the all-or-nothing sentence in the trust block. A campaign whose
 * header says "2 days left" beside a sentence naming a date that has passed is a page a
 * backer cannot trust with money. One function, two callers, and a test that can ask what a
 * campaign looks like ninety seconds before it closes without waiting for that minute.
 *
 * Since #155 the two callers are on two platforms as well. The app's campaign screen ticks the
 * same countdown and prints the same days-left chip, and a phone that said "1 day" where the
 * browser said "2 days" would be the same contradiction across a share link.
 *
 * `daysLeftOf` (`./days-left`) is whole days, floored at zero; the countdown is what moves. The
 * two are computed from the same `deadline` string, so they cannot drift — the floor of
 * {@link Remaining.days} is exactly `daysLeftOf`.
 *
 * <h2>What is not here: writing an instant out</h2>
 *
 * Formatting a deadline as a date is per client and stays there. The web formats it twice —
 * in UTC on the server and in the reader's zone after hydration — through `dateTimeFormat`;
 * the app formats it once, in the device zone, and on Hermes needs the part-less Azerbaijani
 * path (`@ideanest/messages/hermes`) that the web must never bundle. The arithmetic is the
 * part with one right answer, so it is the part that is shared.
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
 * that is only known in the browser (`packages/messages/src/plurals.ts`).
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
 * <strong>The locale is an argument, never the runtime's.</strong> On the web the server renders
 * the first label and `CampaignCountdown` re-renders it in the browser; both read the `[locale]`
 * segment, so they pick the same plural category and hydration sees the same string. The app
 * passes the language the reader chose, which is not necessarily the phone's.
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
 * the smallest unit shown is a minute and so is the tick. The app's countdown ticks on the same
 * interval, for the same reason and for the battery.
 */
export function countdownIntervalMs(remaining: Remaining): number {
  return remaining.totalSeconds < SECONDS_PER_HOUR ? MILLIS_PER_SECOND : SECONDS_PER_MINUTE * MILLIS_PER_SECOND;
}
