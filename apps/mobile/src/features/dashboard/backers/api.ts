import type { components, GetQueryParams } from '@ideanest/api-client';
import { ApiError } from '@ideanest/api-client';
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
import { api, sendJson, sendJsonForFile } from '../../../api/client';
import type { Translate } from '../../../lib/i18n';

/**
 * The backer report's requests — the web's `lib/dashboard/backers.ts` (#163). The rules (the
 * filter, its bodies, the export's headers) are `@ideanest/dashboard/backers`'s; only the
 * transport is the app's.
 */

type ContractSegment = components['schemas']['BackerSegmentResponse'];
type ListQuery = NonNullable<GetQueryParams<'/v1/projects/{projectId}/backers'>>;

/** One page of the campaign's backers — `GET /v1/projects/{id}/backers`. */
export async function listBackers(
  projectId: string,
  options: BackerListOptions,
  signal?: AbortSignal,
): Promise<BackerPage> {
  const body = await api().get('/v1/projects/{projectId}/backers', {
    path: { projectId },
    query: backerQuery(options) as ListQuery,
    ...(signal === undefined ? {} : { signal }),
  });
  return backerPageOf(body);
}

/** Every segment saved against the campaign, newest first. */
export async function listSegments(projectId: string, signal?: AbortSignal): Promise<readonly BackerSegment[]> {
  const body = await api().get('/v1/projects/{projectId}/backer-segments', {
    path: { projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  return body.map(segmentOf);
}

/** Saves the filter under a name. 409: a name the campaign already uses, or no room for more. */
export async function saveSegment(projectId: string, name: string, filter: BackerFilter): Promise<BackerSegment> {
  const body = await sendJson(
    'POST',
    `/v1/projects/${encodeURIComponent(projectId)}/backer-segments`,
    segmentBody(name, filter),
  );
  return segmentOf((body ?? {}) as ContractSegment);
}

export async function deleteSegment(projectId: string, segmentId: string): Promise<void> {
  await sendJson(
    'DELETE',
    `/v1/projects/${encodeURIComponent(projectId)}/backer-segments/${encodeURIComponent(segmentId)}`,
  );
}

/** The matching backers as a CSV file — audited, so a POST. 429 is the per-account budget. */
export async function exportBackers(
  projectId: string,
  options: { readonly filter?: BackerFilter; readonly segmentId?: string },
): Promise<BackerExport> {
  const file = await sendJsonForFile(
    `/v1/projects/${encodeURIComponent(projectId)}/backers/export`,
    exportBody(options),
  );
  return exportOf(file.headers, file.text);
}

/** A refusal as a sentence, the web's `messageFor`, branched on status rather than prose. */
export function backerFailure(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return t('dashboard.failures.signedOut');
    if (cause.status === 403) return t('dashboard.backers.notGranted');
    if (cause.status === 404) return t('dashboard.failures.noCampaign');
    if (cause.status === 429) return t('dashboard.backers.tooManyExports');
  }
  return t('dashboard.backers.unavailable');
}

/** A refused save: 409 is the only one a creator can act on directly. */
export function saveFailure(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError && cause.status === 409) return t('dashboard.backers.saveConflict');
  return t('dashboard.backers.saveFailed');
}
