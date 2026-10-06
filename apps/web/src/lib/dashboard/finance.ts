import type { components } from '@ideanest/api-client';
import { readFinance, type CampaignFinance } from '@ideanest/dashboard/finance';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.7's CD-16: the financial summary's fetch — issue #99. What the summary is and how it is read
 * are `@ideanest/dashboard/finance`, shared with the app (#163).
 */

type ContractFinance = components['schemas']['CampaignFinanceResponse'];

/**
 * One campaign's finances.
 *
 * @throws ApiError on any refusal — 404 for a campaign this account has no part in, 403 for a
 *     collaborator whose grant does not include `VIEW_FINANCES`
 */
export async function getFinance(projectId: string, signal?: AbortSignal): Promise<CampaignFinance> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/finance`, {
    // Matching the service's own `private, no-store`: a campaign's money belongs to the
    // account that asked for it, and a shared cache holding this body is one able to serve it
    // to somebody else.
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return readFinance((await response.json()) as ContractFinance);
}
