import { ApiError } from '@ideanest/api-client';
import type {
  DraftPledgeRequest,
  PayPledgeRequest,
  PaymentPageResponse,
  PledgeResponse,
  PublicRewardList,
} from '@ideanest/checkout/types';
import { api } from '../../api/client';
import { sendIdempotent } from '../../api/mutate';

export async function getCheckoutRewards(
  projectId: string,
  tokens: readonly string[],
  signal?: AbortSignal,
): Promise<PublicRewardList> {
  const token = tokens.filter((value) => value !== '');
  return (await api().get('/v1/projects/{projectId}/rewards/public', {
    path: { projectId },
    ...(token.length === 0 ? {} : { query: { token } }),
    signal,
  })) as unknown as PublicRewardList;
}

/** The published backer agreement's version; null when none is published (404). */
export async function getBackerAgreementVersion(signal?: AbortSignal): Promise<number | null> {
  try {
    const document = await api().get('/v1/legal/documents/{kind}', {
      path: { kind: 'BACKER_AGREEMENT' },
      signal,
    });
    return typeof document.version === 'number' ? document.version : null;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}

export interface FeeDisclosure {
  readonly configured: boolean;
  readonly platformRate: string | null;
  readonly processingRate: string | null;
  readonly processingFixed: string | null;
  readonly currency: string | null;
}

export async function getFeeDisclosure(projectId: string, signal?: AbortSignal): Promise<FeeDisclosure> {
  return (await api().get('/v1/projects/{projectId}/fee-disclosure', {
    path: { projectId },
    signal,
  })) as unknown as FeeDisclosure;
}

export async function getPledge(id: string): Promise<PledgeResponse> {
  return (await api().get('/v1/pledges/{id}', { path: { id } })) as unknown as PledgeResponse;
}

export function createPledgeDraft(body: DraftPledgeRequest, idempotencyKey: string): Promise<PledgeResponse> {
  return sendIdempotent<PledgeResponse>('/v1/pledges/draft', body, idempotencyKey);
}

export function payForPledge(
  id: string,
  body: PayPledgeRequest,
  idempotencyKey: string,
): Promise<PaymentPageResponse> {
  return sendIdempotent<PaymentPageResponse>(
    `/v1/pledges/${encodeURIComponent(id)}/payment`,
    body,
    idempotencyKey,
  );
}
