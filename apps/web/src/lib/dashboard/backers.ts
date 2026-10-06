import type { components } from '@ideanest/api-client';
import {
  backerPageOf,
  backerQuery,
  exportBody,
  exportOf,
  segmentBody,
  segmentOf,
  type BackerExport,
  type BackerFilter,
  type BackerListOptions,
  type BackerPage,
  type BackerSegment,
} from '@ideanest/dashboard/backers';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';

/**
 * What the backer report and the charts ask the service — §4.7's CD-10, CD-07, CD-08 and
 * CD-11, and issues 97, 96 and 79.
 *
 * <h2>Browser reads, like the rest of the dashboard</h2>
 *
 * `lib/api/server.ts` sends no token by design, and every route here is one campaign team's
 * view of their own backers behind a bearer token that the service answers `no-store`.
 * There is nothing to render on the server, which is the argument `lib/dashboard/api.ts`
 * already makes for the overview.
 *
 * <h2>The report's types and rules are shared</h2>
 *
 * The reported states, the filter, its request body and how an export reads its headers live
 * in `@ideanest/dashboard/backers` (#163), because the app's report has to send the same
 * filter and read the same file. Only the requests stay here.
 */

type ContractList = components['schemas']['BackerListResponse'];
type ContractBreakdown = components['schemas']['BackerBreakdownResponse'];
type ContractSegment = components['schemas']['BackerSegmentResponse'];

/** One reward tier's share of the campaign — CD-07. */
export interface RewardSlice {
  readonly rewardTierId: string;
  /** Absent for a tier the campaign has since removed, whose pledges remain. */
  readonly title?: string;
  readonly price?: Money;
  readonly backerCount: number;
  readonly amount: Money;
}

/** One destination's share — CD-08. `country` absent means "named no destination". */
export interface CountrySlice {
  readonly country?: string;
  readonly backerCount: number;
  readonly amount: Money;
}

/** What the campaign sold and where it is going. */
export interface BackerBreakdown {
  /** Absent on a campaign nobody has backed. */
  readonly currency?: string;
  readonly backerCount: number;
  readonly total?: Money;
  readonly rewards: readonly RewardSlice[];
  readonly countries: readonly CountrySlice[];
}


/**
 * One page of the campaign's backers.
 *
 * @param options.segmentId a saved segment to apply instead of `filter`. The service resolves
 *   it, so a segment edited in another tab changes what this returns — which is the point of
 *   saving one
 * @throws ApiError on any refusal
 */
export async function listBackers(
  projectId: string,
  options: BackerListOptions & { readonly signal?: AbortSignal } = {},
): Promise<BackerPage> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(backerQuery(options))) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(name, String(item));
    } else if (value !== undefined) {
      query.set(name, String(value));
    }
  }

  const search = query.toString();
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backers${search === '' ? '' : `?${search}`}`,
    // The service answers `no-store` and this body is a campaign's mailing list. A cached
    // copy is one the browser keeps after the tab that was allowed to read it is gone.
    { cache: 'no-store', signal: options.signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return backerPageOf((await response.json()) as ContractList);
}

/**
 * The campaign's reward mix and destinations — the two charts.
 *
 * Takes no filter, deliberately: the splits describe the campaign rather than the current
 * search, and a chart that moved when a filter did would read as the campaign changing.
 *
 * @throws ApiError on any refusal
 */
export async function getBreakdown(
  projectId: string,
  signal?: AbortSignal,
): Promise<BackerBreakdown> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backers/breakdown`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as ContractBreakdown;
  return {
    currency: body.currency,
    backerCount: body.backerCount ?? 0,
    total: body.total as Money | undefined,
    rewards: (body.rewards ?? []) as readonly RewardSlice[],
    countries: (body.countries ?? []) as readonly CountrySlice[],
  };
}

/** Every segment saved against the campaign, newest first. @throws ApiError on any refusal */
export async function listSegments(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly BackerSegment[]> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backer-segments`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as readonly ContractSegment[];
  return body.map(segmentOf);
}

/**
 * Saves the current filter under a name.
 *
 * @throws ApiError on any refusal. 409 is a name the campaign already uses, compared folded,
 *   or a campaign already holding as many segments as the report will
 */
export async function saveSegment(
  projectId: string,
  name: string,
  filter: BackerFilter,
): Promise<BackerSegment> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backer-segments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(segmentBody(name, filter)),
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return segmentOf((await response.json()) as ContractSegment);
}

/** Forgets a segment. @throws ApiError on any refusal */
export async function deleteSegment(projectId: string, segmentId: string): Promise<void> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backer-segments/${encodeURIComponent(segmentId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw await errorFrom(response);
}

/**
 * Exports the matching backers as a CSV file.
 *
 * A POST because that is what §10.2 gives this route: the export is audited, and a GET that
 * writes an audit row is one a browser may prefetch. The file comes back as text rather than
 * as a download the browser handles on its own — the caller decides when to offer it, and
 * `truncated` has to be read before it does.
 *
 * @throws ApiError on any refusal. 429 is the per-account export budget
 */
export async function exportBackers(
  projectId: string,
  options: { readonly filter?: BackerFilter; readonly segmentId?: string } = {},
): Promise<BackerExport> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/backers/export`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportBody(options)),
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return exportOf(response.headers, await response.text());
}
