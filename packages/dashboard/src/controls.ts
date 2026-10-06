import Decimal from 'decimal.js';

/**
 * The creator's two decisions under IDN-EXT-01 §5.1 — extend the deadline once, or withdraw the
 * funds — as rules both clients draw the same controls from (#44, shared since #163).
 *
 * <h2>The service decides; this only decides what to offer</h2>
 *
 * The window around the first deadline is not visible from the dashboard, so a refusal still
 * comes back with a reason and is worded by {@link refusalOf}. What is offered here is the part
 * that can be known beforehand: the state, the share of the goal raised, and the date bounds.
 *
 * <h2>Percentages compared as decimals</h2>
 *
 * The thresholds sit exactly on 50% and 80%, where a float that reads 79.99999999999999 is a
 * withdraw button missing from a campaign that qualifies. The service sends the percentage as a
 * JSON number rounded down at two places; it is read through its own digits into `decimal.js`
 * and compared there.
 */

/** The states a creator can withdraw from (the service's `WithdrawalNotAvailableException`). */
export const CONTROL_STATES: ReadonlySet<string> = new Set([
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'SUCCESSFUL',
]);

/** The states a campaign takes pledges in and has not been extended from. */
export const EXTENDABLE_STATES: ReadonlySet<string> = new Set(['LIVE', 'CLOSING_WINDOW']);

export const EXTEND_AT_PERCENT = new Decimal(50);
export const WITHDRAW_AT_PERCENT = new Decimal(80);
/** The latest new deadline, in days after the first one — "even if extended on the seventh day after". */
export const MAX_EXTENSION_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A percentage as the wire carries it, as a decimal; `null` when there is no goal to measure. */
export function percentOf(percentFunded: number | string | null | undefined): Decimal | null {
  if (percentFunded === null || percentFunded === undefined) return null;
  try {
    const value = new Decimal(String(percentFunded));
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

/** What the controls card offers for a campaign. */
export interface ControlsOffer {
  /** Whether the card is drawn at all. */
  readonly shown: boolean;
  readonly canExtend: boolean;
  readonly canWithdraw: boolean;
  /** Withdrawal is the state's to offer, but the campaign has not reached 80%: say when it will be. */
  readonly belowThreshold: boolean;
}

export function controlsOffer(
  state: string,
  percentFunded: number | string | null | undefined,
  deadline: string | null | undefined,
): ControlsOffer {
  const shown = CONTROL_STATES.has(state);
  // No goal is nothing raised against one: the service refuses both actions for it.
  const percent = percentOf(percentFunded) ?? new Decimal(0);
  const reachedWithdraw = percent.greaterThanOrEqualTo(WITHDRAW_AT_PERCENT);
  return {
    shown,
    canExtend:
      EXTENDABLE_STATES.has(state) &&
      percent.greaterThanOrEqualTo(EXTEND_AT_PERCENT) &&
      extensionWindow(deadline) !== null,
    canWithdraw: shown && reachedWithdraw,
    belowThreshold: shown && !reachedWithdraw,
  };
}

/** The days an extension may end on, as UTC calendar days, and the deadline's time of day. */
export interface ExtensionWindow {
  /** The current deadline's day. A new deadline must be after it. */
  readonly deadlineDay: string;
  /** The earliest day offered: the deadline + 1 day. */
  readonly firstDay: string;
  /** The latest day offered: the first deadline + {@link MAX_EXTENSION_DAYS} days. */
  readonly latestDay: string;
  /** `T12:00:00.000Z` — the new deadline keeps the current one's time of day. */
  readonly timeOfDay: string;
}

/**
 * The new deadline's bounds. Measured from the deadline the dashboard reports, which for a
 * campaign that can still be extended is its first one.
 */
export function extensionWindow(deadline: string | null | undefined): ExtensionWindow | null {
  if (deadline == null) return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  const iso = new Date(at).toISOString();
  return {
    deadlineDay: iso.slice(0, 10),
    firstDay: new Date(at + DAY_MS).toISOString().slice(0, 10),
    latestDay: new Date(at + MAX_EXTENSION_DAYS * DAY_MS).toISOString().slice(0, 10),
    timeOfDay: iso.slice(10),
  };
}

/** Whether a `YYYY-MM-DD` day is one the window offers. Checked again before anything is sent. */
export function isExtensionDay(day: string, window: ExtensionWindow | null): boolean {
  return (
    window !== null &&
    DAY.test(day) &&
    day >= window.firstDay &&
    day <= window.latestDay
  );
}

/** The instant sent as `{until}`: the chosen day at the current deadline's time of day. */
export function extensionUntil(day: string, window: ExtensionWindow): string {
  return `${day}${window.timeOfDay}`;
}

/**
 * Which sentence of the catalogue's `dashboardControls` a refusal is worded with. The names are
 * the catalogue's own keys, so a client translates the answer directly.
 */
export type ControlsRefusal =
  | 'extendAlready'
  | 'extendOutsideWindow'
  | 'extendBelow'
  | 'extendWrongState'
  | 'extendDate'
  | 'belowThreshold'
  | 'withdrawWrongState'
  | 'failed';

/** The part of a §10.4 problem a refusal is read from. */
export interface RefusalProblem {
  readonly code?: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * The service's reason, as a catalogue key. A refusal without one is the generic failure, not a
 * guess at which rule was broken.
 */
export function refusalOf(problem: RefusalProblem | null | undefined): ControlsRefusal {
  const code = problem?.code;
  const reason = typeof problem?.meta?.reason === 'string' ? problem.meta.reason : null;
  if (code === 'EXTENSION_NOT_AVAILABLE') {
    switch (reason) {
      case 'ALREADY_EXTENDED':
        return 'extendAlready';
      case 'OUTSIDE_WINDOW':
        return 'extendOutsideWindow';
      case 'BELOW_THRESHOLD':
        return 'extendBelow';
      default:
        return 'extendWrongState';
    }
  }
  // The only field the extension carries: a date outside §5.1's bounds.
  if (code === 'PROJECT_FIELD_INVALID') return 'extendDate';
  if (code === 'WITHDRAWAL_NOT_AVAILABLE') {
    return reason === 'BELOW_THRESHOLD' ? 'belowThreshold' : 'withdrawWrongState';
  }
  return 'failed';
}
