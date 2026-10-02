import type { components } from '@ideanest/api-client';
import { api } from '../../api/client';

export type BackerPledgeSummary = components['schemas']['BackerPledgeSummary'];

export interface PledgePage {
  readonly items: readonly BackerPledgeSummary[];
  readonly nextCursor: string | null;
}

export const PLEDGE_PAGE_SIZE = 24;
export const LOOKUP_PAGE_LIMIT = 3;

export async function listMyPledges(cursor: string | null, signal?: AbortSignal): Promise<PledgePage> {
  const body = await api().get('/v1/me/pledges', {
    query: cursor === null ? { limit: PLEDGE_PAGE_SIZE } : { limit: PLEDGE_PAGE_SIZE, cursor },
    ...(signal === undefined ? {} : { signal }),
  });
  return { items: body.pledges ?? [], nextCursor: body.nextCursor ?? null };
}

export async function findMyPledge(
  pledgeId: string,
  cached: readonly BackerPledgeSummary[],
  signal?: AbortSignal,
): Promise<BackerPledgeSummary | null> {
  const known = cached.find((summary) => summary.pledgeId === pledgeId);
  if (known !== undefined) return known;

  let cursor: string | null = null;
  for (let page = 0; page < LOOKUP_PAGE_LIMIT; page += 1) {
    const answer: PledgePage = await listMyPledges(cursor, signal);
    const found = answer.items.find((summary) => summary.pledgeId === pledgeId);
    if (found !== undefined) return found;
    if (answer.nextCursor === null) return null;
    cursor = answer.nextCursor;
  }
  return null;
}
