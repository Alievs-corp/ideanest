import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { addDays, BAKU_ZONE, bakuToday } from './baku-calendar';

export { bakuToday } from './baku-calendar';

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
  /**
   * A decimal string, or absent when the figure cannot be computed yet. The service leaves a
   * null out of the JSON rather than sending it, so "no value" arrives as a missing field and not
   * as `null`, and every reader must treat both the same.
   */
  readonly value?: string | null;
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
export const DASHBOARD_ZONE = BAKU_ZONE;

/**
 * The figures that describe <strong>now</strong> rather than the chosen period.
 *
 * <p>The page's period buttons change the money, the campaigns created and the accounts opened.
 * They do not change how many campaigns are running or how many reports are open — those are
 * counts of this moment — and a page that drew both under one sentence saying every figure
 * followed the period told the reader something false about half of them. The page groups these
 * under their own heading. A `state.` figure is always one of them.
 */
export const NOW_FIGURES: ReadonlySet<string> = new Set([
  'running',
  'awaitingModeration',
  'awaitingLaunch',
  'changesRequested',
  'openReports',
  'openTickets',
]);

/** Whether a figure counts this moment rather than the chosen period. */
export function isNowFigure(key: string): boolean {
  return NOW_FIGURES.has(key) || key.startsWith('state.');
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
