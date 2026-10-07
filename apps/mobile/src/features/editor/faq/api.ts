import { useQuery } from '@tanstack/react-query';
import type { NewProjectFaq, ProjectFaq, ProjectFaqPatch } from '@ideanest/campaign-editor/contract';
import { api, sendJson } from '../../../api/client';
import { queryKeys } from '../../../api/queries';

/**
 * The FAQ tab's requests — the app's half of the web's question calls in `lib/projects/api.ts`
 * (#162). Writes need `MANAGE_FAQ`, which the service checks; a refusal arrives as the shared
 * `ApiError` with its `code` and `meta` (`FAQ_ORDER_INCOMPLETE` names what the order got wrong).
 */

const id = (value: string) => encodeURIComponent(value);

/** The list and the reorder both answer `{faqs: [...]}`. */
function faqsOf(body: unknown): readonly ProjectFaq[] {
  const faqs = (body as { faqs?: readonly ProjectFaq[] } | null)?.faqs;
  return faqs ?? [];
}

/** `GET /v1/projects/{id}/faqs` — every question, in the order backers read them. */
export async function listFaqs(projectId: string, signal?: AbortSignal): Promise<readonly ProjectFaq[]> {
  return faqsOf(
    await api().get('/v1/projects/{projectId}/faqs', {
      path: { projectId },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function createFaq(projectId: string, input: NewProjectFaq): Promise<ProjectFaq> {
  return (await sendJson('POST', `/v1/projects/${id(projectId)}/faqs`, input)) as ProjectFaq;
}

/** Merge-patch semantics. Never called with an empty patch. */
export async function patchFaq(faqId: string, patch: ProjectFaqPatch): Promise<ProjectFaq> {
  return (await sendJson('PATCH', `/v1/faqs/${id(faqId)}`, patch)) as ProjectFaq;
}

export async function deleteFaq(faqId: string): Promise<void> {
  await sendJson('DELETE', `/v1/faqs/${id(faqId)}`);
}

/** Every id exactly once, or `FAQ_ORDER_INCOMPLETE`. Answered with the list in the new order. */
export async function reorderFaqs(projectId: string, faqIds: readonly string[]): Promise<readonly ProjectFaq[]> {
  return faqsOf(await sendJson('PATCH', `/v1/projects/${id(projectId)}/faqs/reorder`, { faqIds }));
}

/** The tab's list, under `projectEditLists` (`lib/offline.ts`): persisted and private. */
export function useEditorFaqs(projectId: string) {
  return useQuery({
    queryKey: queryKeys.editorFaqs(projectId),
    enabled: projectId !== '',
    queryFn: ({ signal }) => listFaqs(projectId, signal),
  });
}
