import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { BillingPeriod } from '../plans/api';

/**
 * AD-11's third screen: what the subscriptions actually brought in — #23.
 *
 * <h2>Three reads, one question</h2>
 *
 * The totals, the payments behind them, and those payments as a file. They take the same
 * period and the same three filters, which is what makes the screen coherent: the list is the
 * rows behind the figures above it, and the file is what is on screen rather than a different
 * question with a similar name. {@link revenueQuery} is the one place that shape is built, and
 * all three call it.
 *
 * <h2>Per currency, never added up across one</h2>
 *
 * There is deliberately no grand total anywhere in these types. §21.2 gives no rate at which
 * one currency balances another for anything that moves money, so "revenue this month" is a
 * figure per currency. Everything is AZN today and nothing here depends on that staying true.
 *
 * <h2>Money is a string, both ways</h2>
 *
 * `"49.00"`, never `49`. A JSON number is an IEEE 754 double in every mainstream parser, and a
 * revenue total is the last place a rounding error should be allowed to appear silently. A
 * reversal's amount is `"-49.00"`, signed, as it is stored.
 */

export type PaymentMethod = 'BANK_TRANSFER' | 'CARD' | 'CASH' | 'OTHER';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'];

/** How many payments one page holds. The service clamps anything larger. */
export const REVENUE_PAGE_SIZE = 25;

/** One currency's three figures. `gross + reversed = net`, and the screen shows all three. */
export interface RevenueCurrencyTotal {
  readonly currency: string;
  /** What arrived, reversals excluded. */
  readonly gross: string;
  /** What was given back. Zero or negative, as stored. */
  readonly reversed: string;
  /** What the platform kept. */
  readonly net: string;
  readonly payments: number;
  readonly reversals: number;
}

/**
 * One plan's net under one name.
 *
 * A plan renamed during the period is two of these with one `planCode`. Both names were true
 * when that money arrived, and choosing one for the group would retitle the other month.
 */
export interface RevenuePlanTotal {
  readonly planCode: string;
  readonly planName: string;
  readonly billingPeriod: BillingPeriod;
  readonly currency: string;
  readonly net: string;
  readonly entries: number;
}

export interface RevenueMethodTotal {
  readonly method: PaymentMethod;
  readonly currency: string;
  readonly net: string;
  readonly entries: number;
}

export interface RevenueReport {
  /** The window the figures cover — echoed, because a request that named none got this month. */
  readonly from: string;
  /** Exclusive. */
  readonly to: string;
  readonly filter: {
    readonly planCode?: string | null;
    readonly accountId?: string | null;
    readonly method?: PaymentMethod | null;
  };
  readonly currencies: readonly RevenueCurrencyTotal[];
  readonly plans: readonly RevenuePlanTotal[];
  readonly methods: readonly RevenueMethodTotal[];
}

/** One payment, or one reversal of a payment. */
export interface SubscriptionPayment {
  readonly id: string;
  readonly subscriptionId: string;
  readonly accountId: string;
  /** Null when the account has been closed or anonymised. The payment still counts. */
  readonly accountEmail?: string | null;
  readonly accountName?: string | null;
  readonly planId: string;
  readonly planCode: string;
  /** The plan's name when the money arrived, which may not be its name now. */
  readonly planName: string;
  readonly billingPeriod: BillingPeriod;
  /** Signed: negative on a reversal. */
  readonly amount: string;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly reference?: string | null;
  readonly note?: string | null;
  /** When the money arrived. What every total is grouped by. */
  readonly receivedAt: string;
  /** When somebody typed it in. Later than `receivedAt` on a backdated payment. */
  readonly recordedAt: string;
  readonly recordedBy?: string | null;
  readonly reverses?: string | null;
  readonly reversal: boolean;
}

export interface SubscriptionPaymentList {
  readonly payments: readonly SubscriptionPayment[];
  /** Null at the end of the list. Hand it back verbatim; never construct one. */
  readonly nextCursor?: string | null;
}

/** What one question to the report is about. Every field is optional and means "any" when absent. */
export interface RevenueRequest {
  /** Inclusive, as an ISO instant. */
  readonly from?: string | null;
  /** Exclusive, as an ISO instant. */
  readonly to?: string | null;
  readonly planCode?: string | null;
  readonly accountId?: string | null;
  readonly method?: PaymentMethod | null;
}

/**
 * The query string all three reads share.
 *
 * An empty string is treated as absent rather than sent, because the service reads `planCode=`
 * as a filter for a plan with no code — which matches nothing, and a screen showing zero
 * revenue for a cleared field is a screen somebody believes.
 */
export function revenueQuery(
  request: RevenueRequest,
  page: { readonly after?: string | null; readonly limit?: number } = {},
): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => {
    if (value != null && value !== '') params.set(key, value);
  };
  set('from', request.from);
  set('to', request.to);
  set('planCode', request.planCode);
  set('accountId', request.accountId);
  set('method', request.method);
  if (page.limit !== undefined) params.set('limit', String(page.limit));
  set('after', page.after);
  return params.toString();
}

/** The totals for one period. */
export async function readRevenue(request: RevenueRequest, signal?: AbortSignal): Promise<RevenueReport> {
  const response = await authorizedFetch(`/v1/admin/subscription/revenue?${revenueQuery(request)}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as RevenueReport;
}

/** One page of the payments behind those totals, newest first by when the money arrived. */
export async function readSubscriptionPayments(
  request: RevenueRequest,
  page: { readonly after?: string | null; readonly limit?: number } = {},
  signal?: AbortSignal,
): Promise<SubscriptionPaymentList> {
  const query = revenueQuery(request, { limit: page.limit ?? REVENUE_PAGE_SIZE, after: page.after });
  const response = await authorizedFetch(`/v1/admin/subscription/payments?${query}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as SubscriptionPaymentList;
}

export interface RevenueExport {
  readonly filename: string;
  readonly csv: string;
  readonly rows: number;
  /** Whether the service's cap was reached and the file is short. Read before offering it. */
  readonly truncated: boolean;
}

/**
 * The payment list as a CSV file.
 *
 * Fetched rather than linked, because the route needs the bearer token and a plain link
 * cannot carry one. The file comes back as text so the caller can read `truncated` before it
 * offers anything: a revenue export missing its tail looks exactly like a complete one, and it
 * will be added up.
 *
 * @throws ApiError on any refusal
 */
export async function exportSubscriptionPayments(request: RevenueRequest): Promise<RevenueExport> {
  const response = await authorizedFetch(`/v1/admin/subscription/payments/export?${revenueQuery(request)}`, {
    headers: { Accept: 'text/csv' },
  });
  if (!response.ok) throw await errorFrom(response);

  return {
    filename: filenameOf(response.headers.get('Content-Disposition')),
    csv: await response.text(),
    rows: Number(response.headers.get('X-Export-Rows') ?? '0'),
    // Compared against the string rather than coerced: `Boolean('false')` is true, which would
    // report every export as short.
    truncated: response.headers.get('X-Export-Truncated') === 'true',
  };
}

/**
 * The filename the service chose, so the file on disk is the one the audit row describes.
 *
 * Handles both forms Spring writes: `filename="…"` and, for a name outside ASCII,
 * `filename*=UTF-8''…`. The encoded form wins when both are present, because it is the exact
 * one. A header that is missing or unparseable falls back to something safe rather than to
 * `undefined`, which would save the file under the route's name.
 */
export function filenameOf(disposition: string | null): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed escape is a broken header, not a reason to lose the file.
    }
  }
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'subscription-revenue.csv';
}
