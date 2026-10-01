import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The campaign page's "now" — #155. The instant the page's clock-dependent rules are asked with:
 * days left, whether the "Last day" chip shows, and `acceptsPledges` (which closes a LIVE campaign
 * at its deadline).
 *
 * <h2>Why the page needs a clock at all</h2>
 *
 * Those rules are pure functions of an instant, and an instant taken once when the screen opened
 * is frozen: a LIVE campaign whose deadline passes while somebody is reading it would go on
 * offering "Back this campaign", the persistent bar and every "Select this reward" — a checkout for
 * a campaign that no longer takes pledges — and "3 days left" would never become "2". The service
 * moves the state on soon after; this page must not wait for a refresh to stop offering it.
 *
 * <h2>One timer, to the next moment anything changes</h2>
 *
 * While the campaign is LIVE with a deadline, a single `setTimeout` fires at the next instant the
 * page's answers change — the next whole-day boundary before the deadline (when `daysLeft` drops)
 * or the deadline itself — and is set again from there. Nothing ticks between those moments; the
 * countdown has its own, finer clock. A return to the foreground reads the time again, because a
 * timer does not run while the app is suspended. Not LIVE, or no deadline: nothing is scheduled,
 * because no answer depends on the time.
 */

const DAY_MS = 86_400_000;

/**
 * How long until `daysLeftOf` or `acceptsPledges` answers differently for this deadline, or `null`
 * once it has passed or cannot be read. One millisecond past the boundary, because both compare
 * strictly: at exactly `k` days left the count is still `k`.
 */
export function msUntilClockChange(deadline: string, now: Date): number | null {
  const closesAt = Date.parse(deadline);
  if (Number.isNaN(closesAt)) return null;
  const remaining = closesAt - now.getTime();
  if (remaining <= 0) return null;
  const toNextDay = remaining % DAY_MS;
  return (toNextDay === 0 ? DAY_MS : toNextDay) + 1;
}

/**
 * The page's current instant. `initial` is a test's way to start the page at a chosen moment; the
 * clock moves on from the device's time.
 */
export function useCampaignClock(
  deadline: string | null | undefined,
  live: boolean,
  initial?: Date,
): Date {
  const [now, setNow] = useState(() => initial ?? new Date());

  useEffect(() => {
    if (!live || deadline == null) return undefined;
    const wait = msUntilClockChange(deadline, now);
    if (wait === null) return undefined;
    const timer = setTimeout(() => setNow(new Date()), wait);
    return () => clearTimeout(timer);
  }, [deadline, live, now]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, []);

  return now;
}
