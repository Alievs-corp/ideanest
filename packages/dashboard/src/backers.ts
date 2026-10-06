import type { components } from '@ideanest/api-client';
import type { Money } from '@ideanest/money';

/**
 * The backer report's rules with one right answer — §4.7's CD-10 and CD-11, shared by
 * `apps/web` and `apps/mobile` (#163). Moved here from the web's `lib/dashboard/backers.ts`;
 * the endpoints stay with each client's own fetch.
 *
 * <h2>The types are the contract's, narrowed</h2>
 *
 * springdoc marks every field optional because Java cannot tell it otherwise. These bodies
 * are serialised with the service's `non_null` default, so an absent key genuinely means
 * absent — but only for the fields that can be: a tier a pledge did not take, a destination
 * it did not name, a cursor when the page is the last one. Everything else is always
 * present, and narrowing here is what keeps the screens free of `?.` on fields that cannot
 * be missing.
 */

type ContractBacker = components['schemas']['Backer'];
type ContractList = components['schemas']['BackerListResponse'];
type ContractSegment = components['schemas']['BackerSegmentResponse'];

/**
 * The five pledge states the report covers.
 *
 * Narrowed from the contract's twelve by hand, because springdoc publishes the whole
 * `PledgeState` enum — the service refuses the other seven with a 400, and a filter control
 * offering a state that cannot be asked for would be a control that only ever fails.
 */
export const REPORTED_STATES = [
  'CONFIRMED',
  'CHARGE_PENDING',
  'CHARGE_FAILED',
  'COLLECTED',
  'FULFILLED',
] as const;

export type ReportedState = (typeof REPORTED_STATES)[number];

/** The longest name a segment may be saved under. */
export const SEGMENT_NAME_MAX = 80;

/** One backer, as the campaign team sees them. */
export interface Backer {
  readonly pledgeId: string;
  /** The account's display name. Present even when `anonymous` — see `BackerPage` on the service. */
  readonly name: string;
  readonly email: string;
  /** Whether they asked not to be named on the public page. Never a reason to hide the name here. */
  readonly anonymous: boolean;
  /** Absent for support that took no reward. */
  readonly rewardTierId?: string;
  /** Absent for support that took no reward, and for a tier the campaign has since removed. */
  readonly rewardTitle?: string;
  readonly amount: Money;
  readonly state: ReportedState;
  /** Absent where the pledge named no destination. */
  readonly country?: string;
  /** ISO-8601 instant. */
  readonly backedAt: string;
}

/** One page of the report. */
export interface BackerPage {
  readonly backers: readonly Backer[];
  /** Send back as `?cursor=`. Absent on the last page. */
  readonly nextCursor?: string;
  /** How many the filter matches on the campaign, not on this page. */
  readonly matched: number;
  /** Absent when nothing matched. */
  readonly currency?: string;
}

/** The four axes the report filters on. Empty means "any", never "none". */
export interface BackerFilter {
  readonly states: readonly ReportedState[];
  readonly rewardTierIds: readonly string[];
  readonly countries: readonly string[];
  readonly term: string;
}

/** No filter at all: the whole campaign. */
export const NO_FILTER: BackerFilter = {
  states: [],
  rewardTierIds: [],
  countries: [],
  term: '',
};

/** Whether a filter narrows anything, which is what decides if it is worth saving. */
export function isNarrowed(filter: BackerFilter): boolean {
  return (
    filter.states.length > 0 ||
    filter.rewardTierIds.length > 0 ||
    filter.countries.length > 0 ||
    filter.term.trim() !== ''
  );
}

/** The filter with `state` switched on or off, keeping the order the others were chosen in. */
export function toggleState(filter: BackerFilter, state: ReportedState): BackerFilter {
  const states = filter.states.includes(state)
    ? filter.states.filter((each) => each !== state)
    : [...filter.states, state];
  return { ...filter, states };
}

/** A filter with a name, saved against the campaign. */
export interface BackerSegment {
  readonly id: string;
  readonly name: string;
  readonly filter: BackerFilter;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The file the export answered with, and what it says about itself. */
export interface BackerExport {
  readonly filename: string;
  readonly csv: string;
  readonly rows: number;
  /** Whether the row cap was reached, so the file is short. Never inferred from the row count. */
  readonly truncated: boolean;
}

/** What a list read asks for: a saved segment, or a filter, and where to start. */
export interface BackerListOptions {
  readonly filter?: BackerFilter;
  /**
   * A saved segment to apply instead of `filter`. The service resolves it, so a segment edited
   * elsewhere changes what the read returns — which is the point of saving one.
   */
  readonly segmentId?: string;
  readonly cursor?: string;
  readonly size?: number;
}

/** `GET /v1/projects/{id}/backers`'s query: list axes repeat, empty axes are left out. */
export interface BackerQuery {
  readonly segment?: string;
  readonly state?: readonly ReportedState[];
  readonly rewardTier?: readonly string[];
  readonly country?: readonly string[];
  readonly q?: string;
  readonly cursor?: string;
  readonly size?: number;
}

/**
 * The list read's query parameters.
 *
 * A segment wins over a filter: the two are alternatives, and sending both would leave the
 * service to decide which one the creator meant.
 */
export function backerQuery(options: BackerListOptions): BackerQuery {
  const query: {
    segment?: string;
    state?: readonly ReportedState[];
    rewardTier?: readonly string[];
    country?: readonly string[];
    q?: string;
    cursor?: string;
    size?: number;
  } = {};
  if (options.segmentId !== undefined) {
    query.segment = options.segmentId;
  } else if (options.filter !== undefined) {
    const { states, rewardTierIds, countries, term } = options.filter;
    if (states.length > 0) query.state = states;
    if (rewardTierIds.length > 0) query.rewardTier = rewardTierIds;
    if (countries.length > 0) query.country = countries;
    if (term.trim() !== '') query.q = term.trim();
  }
  if (options.cursor !== undefined) query.cursor = options.cursor;
  if (options.size !== undefined) query.size = options.size;
  return query;
}

/** The filter as the request body shape. Empty axes are omitted, which the service reads as "any". */
export function filterBody(filter: BackerFilter): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (filter.states.length > 0) body.states = filter.states;
  if (filter.rewardTierIds.length > 0) body.rewardTierIds = filter.rewardTierIds;
  if (filter.countries.length > 0) body.countries = filter.countries;
  if (filter.term.trim() !== '') body.term = filter.term.trim();
  return body;
}

/** `POST /v1/projects/{id}/backer-segments`'s body. */
export function segmentBody(name: string, filter: BackerFilter): Record<string, unknown> {
  return { name: name.trim(), filter: filterBody(filter) };
}

/** `POST /v1/projects/{id}/backers/export`'s body: the segment's identifier, or the filter. */
export function exportBody(options: {
  readonly filter?: BackerFilter;
  readonly segmentId?: string;
}): Record<string, unknown> {
  return options.segmentId !== undefined
    ? { segmentId: options.segmentId }
    : { filter: filterBody(options.filter ?? NO_FILTER) };
}

export function backerOf(backer: ContractBacker): Backer {
  return {
    pledgeId: backer.pledgeId ?? '',
    name: backer.name ?? '',
    email: backer.email ?? '',
    anonymous: backer.anonymous ?? false,
    rewardTierId: backer.rewardTierId,
    rewardTitle: backer.rewardTitle,
    amount: backer.amount as Money,
    state: (backer.state ?? 'CONFIRMED') as ReportedState,
    country: backer.country,
    backedAt: backer.backedAt ?? '',
  };
}

export function backerPageOf(body: ContractList): BackerPage {
  return {
    backers: (body.backers ?? []).map(backerOf),
    nextCursor: body.nextCursor,
    matched: body.matched ?? 0,
    currency: body.currency,
  };
}

export function segmentOf(segment: ContractSegment): BackerSegment {
  return {
    id: segment.id ?? '',
    name: segment.name ?? '',
    filter: {
      states: (segment.filter?.states ?? []) as readonly ReportedState[],
      rewardTierIds: segment.filter?.rewardTierIds ?? [],
      countries: segment.filter?.countries ?? [],
      term: segment.filter?.term ?? '',
    },
    createdBy: segment.createdBy ?? '',
    createdAt: segment.createdAt ?? '',
    updatedAt: segment.updatedAt ?? '',
  };
}

/**
 * The filename the service chose.
 *
 * Parsed rather than reconstructed, so that the name the creator saves is the one the audit
 * row describes. A header that is missing or unparseable falls back to something safe rather
 * than to `undefined`, which would save the file as the route.
 */
export function filenameOf(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? 'backers.csv';
}

/** What an export response says about itself, read from its headers. */
export function exportOf(
  headers: { get(name: string): string | null },
  csv: string,
): BackerExport {
  const rows = Number(headers.get('X-Export-Rows') ?? '0');
  return {
    filename: filenameOf(headers.get('Content-Disposition')),
    csv,
    rows: Number.isFinite(rows) ? rows : 0,
    // Compared against the string rather than coerced: `Boolean('false')` is true, which
    // would report every export as short.
    truncated: headers.get('X-Export-Truncated') === 'true',
  };
}
