import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import {
  CREATOR_AGREEMENT,
  pendingCreatorAgreement,
  type PendingAgreement,
} from '@ideanest/legal/agreements';

/** `GET /v1/me/agreements`: the creator agreement this account has still to accept, if any. */
export async function readPendingCreatorAgreement(signal?: AbortSignal): Promise<PendingAgreement | null> {
  const response = await authorizedFetch('/v1/me/agreements', { signal });
  if (!response.ok) throw await errorFrom(response);
  return pendingCreatorAgreement(await response.json());
}

/** `POST /v1/me/agreements/CREATOR_AGREEMENT`: accepts the version the creator was shown. */
export async function acceptCreatorAgreement(version: number): Promise<void> {
  const response = await authorizedFetch(`/v1/me/agreements/${CREATOR_AGREEMENT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw await errorFrom(response);
}
