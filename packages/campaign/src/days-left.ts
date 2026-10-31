/**
 * Whole days left in a campaign — the figure beside "of goal" and in the urgency chip.
 *
 * <h2>Why this is not in `./deadline`</h2>
 *
 * It is the same arithmetic over the same `deadline` string, and `./deadline`'s tests hold the two
 * level. It is a module of its own because of where each is read. On the web the days left are
 * computed on the server, inside `readCampaignPage`, and the countdown in a client component; a
 * module both import is a module the bundler cannot fold into the countdown's own code, so the
 * campaign route shipped every export of `./deadline` — this function included — and went over
 * its First Load JS budget. Apart, each side carries only what it calls. The app reads both.
 */

const MILLIS_PER_DAY = 86_400_000;

/**
 * Whole days from now until the deadline, floored at zero, or `null` when there is none.
 *
 * Floored rather than allowed to go negative: a campaign that closed a fortnight ago has no
 * days left, and a negative countdown is a number nobody has a sentence for. Whether a zero
 * means "last day" or "closed" is the state's to say, which is why this returns the number
 * and the component decides the words — the same split `ProjectCard` makes.
 *
 * <p>The response does not carry it: `ProjectPageResponse` has a deadline and no `daysLeft`, so
 * each client computes it, and this is the one computation both use (#155).
 *
 * @param now injected so a test can ask what a campaign looks like the day before it closes
 */
export function daysLeftOf(deadline: string | null, now: Date): number | null {
  if (deadline === null) return null;

  const closesAt = Date.parse(deadline);
  if (Number.isNaN(closesAt)) return null;

  const millis = closesAt - now.getTime();
  return millis <= 0 ? 0 : Math.floor(millis / MILLIS_PER_DAY);
}

/**
 * The instant a campaign stops taking pledges, as far as a reader is told — #618.
 *
 * The extension's end while the campaign is `EXTENDED`, and the deadline otherwise. The
 * service keeps `deadline` as the *first* deadline once a campaign is extended, because the
 * extension window and its sixty-day limit are measured from it; every clock, every days-left
 * figure and the trust block's date count to this instead. A page that printed the first
 * deadline beside an "Extended" badge would give a backer two dates for one promise.
 *
 * An `EXTENDED` campaign with no `extendedUntil` (a response from before #618) falls back to
 * the deadline rather than to nothing, which is what every surface showed before.
 */
export function fundingEndsAt(
  state: string,
  deadline: string | null | undefined,
  extendedUntil: string | null | undefined,
): string | null {
  if (state === 'EXTENDED' && typeof extendedUntil === 'string' && extendedUntil !== '') {
    return extendedUntil;
  }
  return deadline ?? null;
}
