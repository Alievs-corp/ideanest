import { authorizedFetch } from '../api/client';
import { ApiError, errorFrom } from '../api/problem';

/**
 * The financial statistics, scaled to whoever is asking — #206, part of #202.
 *
 * <p>Mirrors `GET /v1/admin/partner-statistics`. The request takes no parameters on purpose:
 * which figures a caller receives is decided by the service from their roles and their
 * percentage, so there is nothing here for a developer tools session to widen. The response
 * says which view it is, and this file never computes one.
 *
 * <p>Money and counts are decimal **strings** with two places. A count can be fractional for a
 * partner (7 subscriptions at 50% is `"3.50"`), so it is never parsed into an integer.
 */

/** `REAL` for a super admin, `PARTNER` for a partner. */
export type StatisticsView = 'REAL' | 'PARTNER';

export interface CurrencyFigures {
  readonly currency: string;
  /** What the platform kept: payments plus reversals, such as `"250.00"`. */
  readonly revenue: string;
  /** Payments received, such as `"3.50"`. */
  readonly subscriptions: string;
  readonly reversals: string;
}

export interface DayStatistics {
  /** `YYYY-MM-DD`, in Baku. */
  readonly date: string;
  readonly currencies: readonly CurrencyFigures[];
}

export interface MonthStatistics {
  /** `YYYY-MM`, in Baku. */
  readonly month: string;
  readonly currencies: readonly CurrencyFigures[];
}

export interface PlanStatistics {
  readonly planCode: string;
  readonly planName: string;
  readonly currency: string;
  readonly revenue: string;
  readonly subscriptions: string;
  readonly reversals: string;
}

export interface PartnerStatistics {
  readonly view: StatisticsView;
  /** `"100.00"` for the real view, the partner's percentage otherwise. */
  readonly sharePercentage: string;
  readonly generatedAt: string;
  readonly timeZone: string;
  readonly today: DayStatistics;
  readonly thisMonth: MonthStatistics;
  readonly daily: readonly DayStatistics[];
  readonly monthly: readonly MonthStatistics[];
  readonly byPlan: readonly PlanStatistics[];
}

/**
 * What the read came to.
 *
 * <p>A partner with no percentage is refused by the service with a 403 that carries no
 * capability, which the console's generic handling would render as "you do not work here". That
 * is wrong and unhelpful: they work here, and the fix is a super admin setting their share. So
 * this one refusal is an answer of its own, `not-configured`, and every other failure still
 * throws and is handled as it is on every other screen.
 */
export type PartnerStatisticsResult =
  | { readonly kind: 'ready'; readonly statistics: PartnerStatistics }
  | { readonly kind: 'not-configured' };

/** Needs `VIEW_PARTNER_STATISTICS`. A partner with no percentage is never shown the real figures. */
export async function readPartnerStatistics(signal?: AbortSignal): Promise<PartnerStatisticsResult> {
  const response = await authorizedFetch('/v1/admin/partner-statistics', { signal });
  if (!response.ok) {
    const failure = await errorFrom(response);
    if (failure instanceof ApiError && failure.problem?.code === 'PARTNER_NOT_CONFIGURED') {
      return { kind: 'not-configured' };
    }
    throw failure;
  }

  return { kind: 'ready', statistics: (await response.json()) as PartnerStatistics };
}
