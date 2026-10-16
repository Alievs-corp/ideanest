import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { numberFormat } from '../i18n/formats';
import type { Locale } from '../i18n/locale';

/**
 * §4.11's AD-11: what the platform charges — §9, issue #311.
 *
 * <h2>There is no edit, only a replacement</h2>
 *
 * A rate is a term, not a setting. Editing one in place would silently rewrite what every
 * past payout should have been, and §22.1 asks that question with a seven-year retention
 * rule attached — so a change closes the schedule in force and opens a new one beginning
 * now. The screen says so, because it looks like a create where an operator expects an
 * update.
 *
 * <h2>The rates are strings and are fractions</h2>
 *
 * `"0.05000"` is five percent. Two decisions, both about the same failure: a JSON number is
 * an IEEE 754 double in every mainstream parser, and a percentage would be divided by a
 * hundred somewhere — the call site that forgets charges a fee a hundred times too large.
 * The wire carries the number that gets multiplied, as text.
 */

export type FeeScope = 'PLATFORM' | 'CATEGORY' | 'PROJECT';

export interface FeeSchedule {
  id: string;
  scope: FeeScope;
  /** Which category or which campaign. Absent exactly when the scope is `PLATFORM`. */
  scopeRef?: string | null;
  /** A fraction, as text. `"0.05000"` is five percent. */
  platformRate: string;
  processingRate: string;
  /** The processor's fixed amount per transaction, as text. */
  processingFixed: string;
  currency: string;
  effectiveFrom: string;
  /** Absent while this schedule is the one in force. */
  effectiveTo?: string | null;
  /** Derivable from `effectiveTo` and sent anyway — the screen sorts and badges on it. */
  open: boolean;
  note: string;
  createdAt: string;
  createdBy: string;
}

/** The terms a payout is priced at when no platform schedule is open, from the service's configuration. */
export interface DefaultFeeTerms {
  platformRate: string;
  processingRate: string;
  currency: string;
}

export interface FeeHistory {
  schedules: FeeSchedule[];
  /** Absent from a service that has not been redeployed since the console started reading it. */
  defaults?: DefaultFeeTerms | null;
}

/** A category an exception can name, with its parent's name in front when it is a subcategory. */
export interface CategoryChoice {
  readonly id: string;
  readonly name: string;
}

interface WireTaxon {
  readonly id?: string | null;
  readonly slug?: string | null;
  readonly name?: string | null;
  readonly subcategories?: readonly WireTaxon[] | null;
}

/**
 * Every category and subcategory, named in the reader's language — `GET /v1/categories`, which the
 * service localises by `Accept-Language`. Read here rather than through `lib/projects/api`, which would
 * bring the campaign editor's client into the console's fee route for one list.
 */
export async function readCategoryChoices(signal?: AbortSignal): Promise<CategoryChoice[]> {
  const response = await authorizedFetch('/v1/categories', { signal });
  if (!response.ok) throw await errorFrom(response);

  const tree = (await response.json()) as readonly WireTaxon[];
  const choices: CategoryChoice[] = [];
  for (const category of tree) {
    if (category.id == null) continue;
    const name = category.name ?? category.slug ?? category.id;
    choices.push({ id: category.id, name });
    for (const sub of category.subcategories ?? []) {
      if (sub.id == null) continue;
      choices.push({ id: sub.id, name: `${name} › ${sub.name ?? sub.slug ?? sub.id}` });
    }
  }
  return choices;
}

/**
 * A rate as typed, as the service takes it: a fraction from 0 to 1 with at most five decimals — the
 * column's scale. A comma is read as the decimal mark, because that is how an Azerbaijani writes it.
 *
 * @returns the rate to send, or `undefined` when the input is not one
 */
export function rateFrom(input: string): string | undefined {
  const typed = input.trim().replace(',', '.');
  return /^(0(\.\d{1,5})?|1(\.0{1,5})?|\.\d{1,5})$/.test(typed) ? (typed.startsWith('.') ? `0${typed}` : typed) : undefined;
}

/** The fixed amount per payout as typed: not negative, at most four decimals — the column's scale. */
export function fixedFrom(input: string): string | undefined {
  const typed = input.trim().replace(',', '.');
  return /^\d{1,15}(\.\d{1,4})?$/.test(typed) ? typed : undefined;
}

/** A stored rate without the column's trailing zeroes: `"0.15000"` reads `"0.15"`. */
export function plainRate(rate: string): string {
  if (!rate.includes('.')) return rate;
  const trimmed = rate.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * The fixed amount with every decimal that is not a trailing zero, and never fewer than two:
 * `"0.3000"` is `0.30 AZN` and `"0.0025"` is `0.0025 AZN`, where `formatMoney` would print `0.00`.
 */
export function formatFixedAmount(amount: string, currency: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  const kept = fraction.replace(/0+$/, '').padEnd(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${kept} ${currency}`;
}

/** Every window ever written, newest first — closed ones included. */
export async function readFeeHistory(signal?: AbortSignal): Promise<FeeHistory> {
  const response = await authorizedFetch('/v1/admin/fees', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as FeeHistory;
}

export interface ReplaceFeeRequest {
  readonly scope: FeeScope;
  readonly scopeRef: string | null;
  readonly platformRate: string;
  readonly processingRate: string;
  readonly processingFixed: string;
  readonly currency: string;
  readonly note: string;
  readonly signal?: AbortSignal;
}

/** Closes what is in force for this scope and opens the terms in the body. */
export async function replaceFeeSchedule(request: ReplaceFeeRequest): Promise<FeeSchedule> {
  const response = await authorizedFetch('/v1/admin/fees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: request.scope,
      scopeRef: request.scopeRef,
      platformRate: request.platformRate,
      processingRate: request.processingRate,
      processingFixed: request.processingFixed,
      currency: request.currency,
      note: request.note,
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as FeeSchedule;
}

/**
 * A fraction rendered as a percentage, in the reader's language.
 *
 * <strong>Display only.</strong> Nothing on this screen multiplies a rate by money — that
 * is the service's, on `BigDecimal` — so this is allowed to be a float. The moment
 * something here computes a fee, it uses `decimal.js` instead, which is what CLAUDE.md
 * requires of the frontend.
 *
 * <h2>The language decides the separator and the sign's side — issue #403</h2>
 *
 * <p>This built the string by hand and always rendered `2.9%`, next to a note somebody had
 * typed as `2,9%`; on an Azerbaijani screen the generated half was the wrong one. Nor is the
 * separator the whole of it — Turkish writes `%2,9`, with the sign in front — so the
 * percentage is a formatter's job rather than a template's.
 *
 * <p>Three decimal places, because the service stores five and a rate of 0.00125 is a real
 * eighth of a percent somebody may have negotiated. Trailing zeroes are dropped, so the
 * ordinary five percent reads as "5%" rather than "5.000%".
 */
export function asPercentage(rate: string, locale: Locale): string {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed)) return rate;

  return numberFormat(locale, { style: 'percent', maximumFractionDigits: 3 }, 'rate').format(parsed);
}
