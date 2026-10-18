/**
 * The platform's calendar, as the browser has to compute it: whole days in Baku.
 *
 * <p>Every figure screen sends the service a first and a last day, and the service reads them in
 * Baku (`PlatformAnalyticsService` refuses to start unless its calendar and the front page's are the
 * same one). A window computed from `new Date().toISOString()` is the UTC day instead: for four
 * hours a night Baku is already on the next day, and the screen asked for yesterday's window.
 *
 * <p>No imports, so either figure screen can take it without pulling the other's module into a
 * shared chunk — `lib/admin/payouts.ts` records what that cost the front page once.
 */

/** The zone a platform day belongs to. */
export const BAKU_ZONE = 'Asia/Baku';

/** Today's date in Baku as `YYYY-MM-DD`, from the browser's clock. */
export function bakuToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BAKU_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Adds whole days to a `YYYY-MM-DD` date, in calendar days and not in milliseconds of a zone. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/** The `days`-long window ending today in Baku, both ends inclusive. */
export function lastDays(days: number, today: string = bakuToday()): { readonly from: string; readonly to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}
