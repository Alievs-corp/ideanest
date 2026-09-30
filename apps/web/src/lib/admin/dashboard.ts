import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * The console's front page — #222.
 *
 * <p>Mirrors `GET /v1/admin/dashboard`. The service decides which sections a caller receives from
 * their roles, so this file has no rule about who sees what and nothing to keep in step with it:
 * a section the reader may not see is simply absent, and one this file has no copy for is drawn
 * from its key rather than dropped (see `ConsoleDashboard`).
 *
 * <p>Every value is a decimal **string**. Money, counts and the one ratio all cross the wire that
 * way, because a client that parsed `1200.10` into a binary double and summed a column would be
 * producing the rounding error the platform's rule against floating-point money exists to keep
 * out. Nothing here parses one into a number except to print a count.
 */

export type FigureKind = 'COUNT' | 'MONEY' | 'RATIO';

export interface DashboardFigure {
  /** A stable name such as `pledgeVolume` or `state.LIVE`; the label is keyed on it. */
  readonly key: string;
  readonly kind: FigureKind;
  /** A decimal string, or null when the figure cannot be computed yet. */
  readonly value: string | null;
  /** Present for `MONEY`. */
  readonly currency?: string | null;
  /** For a queue: when its oldest item arrived. */
  readonly since?: string | null;
}

export interface DashboardPoint {
  /** `YYYY-MM-DD`, in Baku. */
  readonly date: string;
  readonly amount: string;
  readonly count: number;
}

export type SectionStatus = 'READY' | 'UNAVAILABLE';

export interface DashboardSectionData {
  readonly key: string;
  readonly status: SectionStatus;
  readonly figures: readonly DashboardFigure[];
  readonly series: readonly DashboardPoint[];
}

export interface Dashboard {
  readonly from: string;
  readonly to: string;
  readonly computedAt: string;
  readonly timeZone: string;
  /** Only what the caller's capabilities allow, in page order. Empty for staff who hold none. */
  readonly sections: readonly DashboardSectionData[];
}

/** Whole days in Baku's calendar, both ends inclusive. Absent means the service's default. */
export interface DashboardWindow {
  readonly from?: string;
  readonly to?: string;
}

/** The front page for the signed-in member of staff. */
export async function readDashboard(window: DashboardWindow, signal?: AbortSignal): Promise<Dashboard> {
  const query = new URLSearchParams();
  if (window.from) query.set('from', window.from);
  if (window.to) query.set('to', window.to);

  const text = query.toString();
  const suffix = text === '' ? '' : `?${text}`;
  const response = await authorizedFetch(`/v1/admin/dashboard${suffix}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Dashboard;
}

/** The periods the page offers. */
export type PeriodPreset = 'today' | 'week' | 'month30' | 'thisMonth';

export const PERIOD_PRESETS: readonly PeriodPreset[] = ['today', 'week', 'month30', 'thisMonth'];

/** The calendar the platform's days are in. The service's own, and the one a bank statement is dated in. */
export const DASHBOARD_ZONE = 'Asia/Baku';

/**
 * Today's date in Baku as `YYYY-MM-DD`, from the browser's clock.
 *
 * <p>`Intl` with an explicit zone rather than `new Date().toISOString()`, which is UTC: for four
 * hours a night Baku is already on the next day, and a "today" that read the wrong one would ask
 * for yesterday's window.
 */
export function bakuToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Adds whole days to a `YYYY-MM-DD` date, in calendar days and not in milliseconds of a zone. */
function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * The window a preset means, as the two ends the service takes.
 *
 * <p>`month30` is the service's own default (thirty days ending today), so it sends nothing and
 * lets the server say what that is; the other three name their days.
 */
export function windowFor(preset: PeriodPreset, today: string = bakuToday()): DashboardWindow {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'month30':
    default:
      return {};
  }
}

/**
 * How long ago something arrived, as a whole number and a unit, so the page can say how long the
 * longest wait in a queue is. Days when it is a day or more, then hours, then minutes.
 */
export function waitedFor(
  since: string,
  now: Date = new Date(),
): { readonly unit: 'days' | 'hours' | 'minutes'; readonly amount: number } {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes >= 24 * 60) return { unit: 'days', amount: Math.floor(minutes / (24 * 60)) };
  if (minutes >= 60) return { unit: 'hours', amount: Math.floor(minutes / 60) };
  return { unit: 'minutes', amount: minutes };
}
