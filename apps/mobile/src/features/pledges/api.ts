import type { components } from '@ideanest/api-client';
import type {
  PledgeEdit,
  PledgeRaiseRequest,
  PledgeRaiseResponse,
  PledgeResponse,
} from '@ideanest/checkout/types';
import { api, sendJson } from '../../api/client';
import { sendIdempotent } from '../../api/mutate';

export type BackerPledgeSummary = components['schemas']['BackerPledgeSummary'];

export interface PledgePage {
  readonly items: readonly BackerPledgeSummary[];
  readonly nextCursor: string | null;
}

export const PLEDGE_PAGE_SIZE = 24;

export async function listMyPledges(cursor: string | null, signal?: AbortSignal): Promise<PledgePage> {
  const body = await api().get('/v1/me/pledges', {
    query: cursor === null ? { limit: PLEDGE_PAGE_SIZE } : { limit: PLEDGE_PAGE_SIZE, cursor },
    ...(signal === undefined ? {} : { signal }),
  });
  return { items: body.pledges ?? [], nextCursor: body.nextCursor ?? null };
}

export async function readPledge(id: string, signal?: AbortSignal): Promise<PledgeResponse> {
  return (await api().get('/v1/pledges/{id}', {
    path: { id },
    ...(signal === undefined ? {} : { signal }),
  })) as unknown as PledgeResponse;
}

export async function openBackerDispute(pledgeId: string, reason: string): Promise<void> {
  await sendJson('POST', `/v1/pledges/${encodeURIComponent(pledgeId)}/disputes`, { reason });
}

export function editPledge(id: string, edit: PledgeEdit, idempotencyKey: string): Promise<PledgeResponse> {
  return sendIdempotent<PledgeResponse>(`/v1/pledges/${encodeURIComponent(id)}`, edit, idempotencyKey, 'PATCH');
}

export function raisePledge(
  id: string,
  body: PledgeRaiseRequest,
  idempotencyKey: string,
): Promise<PledgeRaiseResponse> {
  return sendIdempotent<PledgeRaiseResponse>(`/v1/pledges/${encodeURIComponent(id)}/raise`, body, idempotencyKey);
}
