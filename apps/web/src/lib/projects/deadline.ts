import { dateTimeFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';

/**
 * §4.4's live countdown and its "deadline in the viewer's timezone".
 *
 * <h2>The arithmetic moved; the formatting stayed</h2>
 *
 * `remainingUntil`, `countdownLabel`, `countdownIntervalMs` and `daysLeftOf` are
 * `@ideanest/campaign/deadline` since #155, so the app's countdown is this countdown. They are
 * re-exported below under the same names, so no caller here changed. Writing an instant out is
 * still this file's, because the two clients do it differently for reasons the package
 * module states.
 *
 * <h2>Why the arithmetic is a module and not in the component</h2>
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

export {
  countdownIntervalMs,
  countdownLabel,
  remainingUntil,
  type CountdownUnits,
  type Remaining,
} from '@ideanest/campaign/deadline';
export { daysLeftOf } from '@ideanest/campaign/days-left';

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
