import type { ProjectEdit, StoryVersionDetail, StoryVersionSummary } from '@ideanest/campaign-editor/contract';
import { api, sendJson } from '../../../api/client';

/**
 * The story's version history — the app's half of the web's `listStoryVersions`,
 * `getStoryVersion` and `restoreStoryVersion` (#162).
 *
 * <p>Nothing here writes a version: the story is saved through `PATCH /v1/projects/{id}` with
 * everything else, and the server decides when a version is due. The shapes are the shared
 * contract's; the generated schema describes the same bodies loosely.
 */

/** `GET /v1/projects/{id}/story/versions` — the kept versions, newest first (at most fifty). */
export async function listStoryVersions(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly StoryVersionSummary[]> {
  const body = await api().get('/v1/projects/{id}/story/versions', {
    path: { id: projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  return body as unknown as readonly StoryVersionSummary[];
}

/** `GET /v1/projects/{id}/story/versions/{number}` — one version with its document, for the preview. */
export async function getStoryVersion(
  projectId: string,
  number: number,
  signal?: AbortSignal,
): Promise<StoryVersionDetail> {
  const body = await api().get('/v1/projects/{id}/story/versions/{number}', {
    path: { id: projectId, number },
    ...(signal === undefined ? {} : { signal }),
  });
  return body as unknown as StoryVersionDetail;
}

/**
 * `POST /v1/projects/{id}/story/versions/{number}/restore` — makes that version the story and
 * answers the whole project. The server keeps the replaced story as a version first.
 */
export async function restoreStoryVersion(projectId: string, number: number): Promise<ProjectEdit> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/story/versions/${number}/restore`;
  return (await sendJson('POST', path)) as ProjectEdit;
}
