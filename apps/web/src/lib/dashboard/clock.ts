import type { CampaignClockCopy } from '../i18n/dashboard-copy';
import type { Locale } from '../i18n/locale';
import { fillPlaceholders } from '../i18n/placeholders';
import { pluralise } from '../i18n/plurals';

/**
 * The countdown the dashboard draws, and the clock-skew correction it needs.
 *
 * <h2>Why the service sends two instants instead of a number</h2>
 *
 * `GET /v1/projects/{id}/dashboard` answers with `deadline` and `serverTime` and no
 * `secondsRemaining`. A remainder computed on the server is wrong the moment it is sent
 * and grows more wrong for as long as the page stays open — and the creator watching the
 * last hour of their campaign is exactly the reader who leaves it open.
 *
 * Two instants let this module do better than either side could alone. The difference
 * between `serverTime` and the browser's clock at the moment of the response is the
 * reader's skew; subtracting it makes every subsequent tick a countdown against the
 * service's clock rather than against a laptop that is forty minutes fast.
 *
 * <h2>Pure functions, and the reason they are not a hook</h2>
 *
 * Everything here takes the current time as an argument. A module that read `Date.now()`
 * internally would be one whose behaviour at the boundaries — the last minute, the moment
 * of expiry, a reader whose clock is a day out — could only be tested by waiting or by
 * mocking the global. These are the cases most worth testing and they are the ones that
 * arithmetic gets wrong.
 */

/** Milliseconds, named so the arithmetic below reads as time rather than as digits. */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ui-kit §8.1's threshold: a campaign closing within this is urgent. */
export const URGENT_THRESHOLD_MS = 2 * DAY;

/**
 * How far the reader's clock is from the service's.
 *
 * Positive means the browser is ahead. Measured once, from the response that carried
 * `serverTime`, and then applied to every tick — remeasuring on each render would make
 * the countdown jitter by however long the last request took.
 *
 * @param serverTime the instant the service computed its answer at
 * @param receivedAt the browser's clock when that answer arrived
 */
export function clockSkewMs(serverTime: string, receivedAt: number): number {
  const server = Date.parse(serverTime);
  // An unparseable instant means no correction rather than NaN propagating into every
  // subsequent subtraction and turning the countdown into "NaN days left".
  return Number.isNaN(server) ? 0 : receivedAt - server;
}

/**
 * How long is left, in milliseconds, corrected for skew. Never negative.
 *
 * @param deadline the campaign's deadline, or null on a campaign that has not launched
 * @param now the browser's clock
 * @param skewMs from {@link clockSkewMs}
 * @returns null when there is no deadline to count down to — which is a different thing
 *   from zero, and renders as no countdown rather than as an expired one
 */
export function remainingMs(deadline: string | null | undefined, now: number, skewMs: number): number | null {
  if (!deadline) return null;
  const ends = Date.parse(deadline);
  if (Number.isNaN(ends)) return null;
  return Math.max(0, ends - (now - skewMs));
}

/** The parts a countdown is rendered from. */
export interface Remaining {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly expired: boolean;
}

/** Splits a duration into whole days, hours, minutes and seconds. */
export function splitRemaining(ms: number): Remaining {
  return {
    days: Math.floor(ms / DAY),
    hours: Math.floor((ms % DAY) / HOUR),
    minutes: Math.floor((ms % HOUR) / MINUTE),
    seconds: Math.floor((ms % MINUTE) / SECOND),
    expired: ms <= 0,
  };
}

/**
 * The countdown as a sentence, in the page's language.
 *
 * <h2>The unit shown changes with how much is left, and that is the point</h2>
 *
 * A campaign with three weeks to go does not need seconds — a number that changes every
 * second is a number nobody can read, and on a screen a creator leaves open it is also an
 * animation running forever, which docs/motion-system.md is against. A campaign with four
 * minutes left needs exactly that.
 *
 * So: days while there are days, hours and minutes inside a day, and seconds only in the
 * last hour, when they are the thing being watched.
 *
 * <h2>The words are an argument (#79)</h2>
 *
 * This used to spell its four sentences in English, which made a module of pure arithmetic
 * the last English literal on a translated screen. It takes them now, the way
 * `lib/moderation/describe.ts` takes its reasons: `lib/i18n/dashboard-copy.ts` holds the
 * shape, the route resolves it, and `CampaignClock` passes it down with the locale.
 *
 * <p>The day count is a plural rather than a ternary — one day against two is the whole of
 * English and none of Russian, which picks between three forms by the last digit. The other
 * three sentences carry two numbers each and no language declines for either, so they are
 * templates.
 */
export function describeRemaining(
  remaining: Remaining,
  copy: CampaignClockCopy,
  locale: Locale,
): string {
  if (remaining.expired) return copy.closed;
  if (remaining.days > 0) {
    return pluralise(locale, copy.days, remaining.days);
  }
  if (remaining.hours > 0) {
    return fillPlaceholders(copy.hours, {
      hours: String(remaining.hours),
      minutes: String(remaining.minutes),
    });
  }
  if (remaining.minutes > 0) {
    return fillPlaceholders(copy.minutes, {
      minutes: String(remaining.minutes),
      seconds: String(remaining.seconds),
    });
  }
  return fillPlaceholders(copy.seconds, { seconds: String(remaining.seconds) });
}

/**
 * How often the countdown should tick, given how much is left.
 *
 * A page showing "27 days left" that re-rendered every second would wake the main thread
 * 86,400 times to change nothing. Ticking at the resolution being displayed is the whole
 * optimisation, and it falls out of {@link describeRemaining}'s own rule.
 */
export function tickIntervalMs(ms: number): number {
  if (ms <= 0) return HOUR;
  if (ms < HOUR) return SECOND;
  if (ms < DAY) return MINUTE;
  return MINUTE;
}

/** Whether the campaign is inside ui-kit §8.1's urgent window. Lime means this and only this. */
export function isUrgent(ms: number | null): boolean {
  return ms !== null && ms > 0 && ms <= URGENT_THRESHOLD_MS;
}
