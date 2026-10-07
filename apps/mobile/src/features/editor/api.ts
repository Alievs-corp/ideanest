import { useQuery } from '@tanstack/react-query';
import {
  categoriesFrom,
  type Category,
  type ProjectEdit,
  type ProjectPatch,
  type RawTaxon,
} from '@ideanest/campaign-editor/contract';
import { api, sendJson } from '../../api/client';
import { queryKeys } from '../../api/queries';

/**
 * The editor's requests — the app's half of the web's `lib/projects/api.ts` (#162).
 *
 * Only the requests live here; the shapes they carry are `@ideanest/campaign-editor/contract`,
 * shared with the web so the two clients cannot disagree about a body. Writes go through
 * `sendJson` (the session's fetch, refusals as the shared `ApiError`); reads through `api()`.
 */

/** `GET /v1/projects/{id}/edit` — the creator's projection of one project. */
export async function fetchProjectEdit(projectId: string, signal?: AbortSignal): Promise<ProjectEdit> {
  const body = await api().get('/v1/projects/{id}/edit', {
    path: { id: projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  // The generated schema describes the same body loosely; the contract is the shared type.
  return body as unknown as ProjectEdit;
}

/**
 * The project every editor tab reads: its title for the header, its state for the tag, its
 * `lockedFields`, and the fields themselves. Persisted under `projectEdit` (`lib/offline.ts`), so
 * offline the editor still shows what was last loaded, read-only.
 */
export function useProjectEdit(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectEdit(projectId),
    enabled: projectId !== '',
    queryFn: ({ signal }) => fetchProjectEdit(projectId, signal),
  });
}

/** `POST /v1/projects {title}` — starts a draft and answers with it. */
export async function createProject(title: string): Promise<ProjectEdit> {
  return (await sendJson('POST', '/v1/projects', { title })) as ProjectEdit;
}

/**
 * `PATCH /v1/projects/{id}` with merge-patch semantics, answered with the whole project. Sent as
 * `application/json`, as the web sends it: the semantics are the contract, the media type is not.
 */
export async function patchProject(projectId: string, patch: ProjectPatch): Promise<ProjectEdit> {
  return (await sendJson('PATCH', `/v1/projects/${encodeURIComponent(projectId)}`, patch)) as ProjectEdit;
}

/**
 * The category tree as the editor's pickers read it (`categoriesFrom`). The same key as the
 * discovery screens' `useCategories`, so the taxonomy is read once; each reads it through its own
 * `select`. Not retried: a failure here never blocks the rest of the form.
 */
export function useEditorCategories() {
  return useQuery({
    queryKey: queryKeys.categories(),
    retry: false,
    queryFn: ({ signal }) => api().get('/v1/categories', { signal }),
    select: (raw): readonly Category[] => categoriesFrom(raw as unknown as readonly RawTaxon[]),
  });
}
