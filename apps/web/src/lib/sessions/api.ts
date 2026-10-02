import type { RevokeOutcome, SessionSummary } from '@ideanest/account/sessions';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/* The row's shape is shared with the app (#161), so it lives in `@ideanest/account`. */
export type { RevokeOutcome, SessionSummary };

/**
 * The account's live devices, newest activity first.
 *
 * Revoked and expired sessions never appear, so a revoked row simply stops
 * being returned; there is no status to filter on here.
 */
export async function listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  const response = await authorizedFetch('/v1/auth/sessions', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as SessionSummary[];
}

/**
 * Ends one device's session.
 *
 * A 404 means "unknown identifier" or "not yours", deliberately
 * indistinguishable so that this endpoint cannot be used to ask whether a
 * session id is real. From this screen's point of view both readings have the
 * same consequence — the row is not there — so it is reported as success rather
 * than as an error the user cannot act on.
 */
export async function revokeSession(id: string): Promise<RevokeOutcome> {
  const response = await authorizedFetch(`/v1/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  if (response.status === 404) return 'already-gone';
  if (!response.ok) throw await errorFrom(response);

  return 'revoked';
}
