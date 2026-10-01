import { useQuery } from '@tanstack/react-query';
import { readFaqList, type CampaignFaq } from '@ideanest/campaign/faqs';
import { publicApi } from '../../../../api/client';
import { queryKeys } from '../../../../api/queries';

/**
 * The FAQ tab's read (#155): `GET /v1/projects/{projectId}/faqs`, every entry at once.
 *
 * <p>Not paged — the service caps a campaign at fifty (`CAMPAIGN_FAQ_LIMIT`) and publishes no
 * cursor — and narrowed by `@ideanest/campaign/faqs`'s `readFaqList`, the web's own reader, so a
 * half-written row is dropped here exactly as it is there and the creator's order is kept.
 *
 * <p>Under `queryKeys.projectFaqs`, the `project` root, which `lib/offline.ts` persists: the
 * answers are public and belong to the page, so a backer on a plane reads them with the rest of
 * it. `enabled` is the tab's `active` — the list is asked for when the FAQ tab opens, not before.
 *
 * <p>Read as nobody (`publicApi()`): the service answers the campaign's team with the list of a
 * campaign that is not public yet, and what this page draws and persists is the public's — the
 * web reads it anonymously too.
 */
export function useProjectFaqs(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.projectFaqs(projectId),
    enabled,
    queryFn: async ({ signal }): Promise<readonly CampaignFaq[]> =>
      readFaqList(
        await publicApi().get('/v1/projects/{projectId}/faqs', { path: { projectId }, signal }),
      ),
  });
}
