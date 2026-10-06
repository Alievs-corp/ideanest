import { useQuery } from '@tanstack/react-query';
import { readFinance, type CampaignFinance } from '@ideanest/dashboard/finance';
import { api } from '../../../api/client';
import { queryKeys } from '../../../api/queries';

/** The financial summary — `GET /v1/projects/{id}/finance`, guarded by `VIEW_FINANCES`. */
export function useFinance(projectId: string) {
  return useQuery({
    queryKey: queryKeys.dashboardFinance(projectId),
    enabled: projectId !== '',
    queryFn: async ({ signal }): Promise<CampaignFinance> =>
      readFinance(await api().get('/v1/projects/{projectId}/finance', { path: { projectId }, signal })),
  });
}
