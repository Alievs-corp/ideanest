import { useQuery } from '@tanstack/react-query';
import type { ProjectChecklist, ProjectEdit } from '@ideanest/campaign-editor/contract';
import { api, sendJson } from '../../../api/client';
import { queryKeys } from '../../../api/queries';

/**
 * The Review tab's requests — the app's half of the web's `getProjectChecklist`, `submitProject`
 * and `launchProject` (#162). The shapes are `@ideanest/campaign-editor/contract`'s.
 */

/**
 * The checklist's cache key: under the project's own `projectEdit` root, so it is persisted with
 * it (offline, the tab shows the checklist as last read) and erased with it at sign-out.
 */
export function checklistKey(projectId: string) {
  return [...queryKeys.projectEdit(projectId), 'checklist'] as const;
}

/** `GET /v1/projects/{id}/checklist` — how complete the campaign is, and what moderation said. */
export async function fetchChecklist(projectId: string, signal?: AbortSignal): Promise<ProjectChecklist> {
  const body = await api().get('/v1/projects/{id}/checklist', {
    path: { id: projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  // The generated schema describes the same body loosely; the contract is the shared type.
  return body as unknown as ProjectChecklist;
}

/**
 * The checklist, read when the tab opens and re-read on "Check again" and after a submit or a
 * launch. Not retried: a refusal is the tab's error with "Try again", and the server, never this
 * client, decides whether the campaign may be submitted.
 */
export function useProjectChecklist(projectId: string) {
  return useQuery({
    queryKey: checklistKey(projectId),
    enabled: projectId !== '',
    retry: false,
    queryFn: ({ signal }) => fetchChecklist(projectId, signal),
  });
}

/** `POST /v1/projects/{id}/submit` — sends the campaign to moderation; answers the project. */
export async function submitProject(projectId: string): Promise<ProjectEdit> {
  return (await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/submit`)) as ProjectEdit;
}

/** `POST /v1/projects/{id}/launch` — `APPROVED` or `SCHEDULED` → `LIVE`; answers the project. */
export async function launchProject(projectId: string): Promise<ProjectEdit> {
  return (await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/launch`)) as ProjectEdit;
}
