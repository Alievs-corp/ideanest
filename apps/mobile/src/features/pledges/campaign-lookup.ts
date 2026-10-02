import { listMyPledges, type BackerPledgeSummary, type PledgePage } from './api';

export const LOOKUP_PAGE_LIMIT = 3;

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
