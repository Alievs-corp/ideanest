import { useQuery } from '@tanstack/react-query';
import type { components } from '@ideanest/api-client';
import { readTrend, type Trend } from '@ideanest/dashboard/analytics';
import { api } from '../../../api/client';
import { dashboardKey } from '../shared-charts-finance';

/** The service's split by reward tier and by destination, as it sends it. */
export type Breakdown = components['schemas']['BackerBreakdownResponse'];

/** The daily trend — `GET /v1/projects/{id}/analytics`, the service's last thirty days. */
export function useTrend(projectId: string) {
  return useQuery({
    queryKey: dashboardKey(projectId, 'analytics'),
    enabled: projectId !== '',
    queryFn: async ({ signal }): Promise<Trend> =>
      readTrend(await api().get('/v1/projects/{projectId}/analytics', { path: { projectId }, signal })),
  });
}

/**
 * The reward and destination split — `GET /v1/projects/{id}/backers/breakdown`. Read as the
 * contract types it, since every field is optional there and the panel narrows each as it draws.
 */
export function useBreakdown(projectId: string) {
  return useQuery({
    queryKey: dashboardKey(projectId, 'breakdown'),
    enabled: projectId !== '',
    queryFn: ({ signal }): Promise<Breakdown> =>
      api().get('/v1/projects/{projectId}/backers/breakdown', { path: { projectId }, signal }),
  });
}
