import { ApiError } from '@ideanest/api-client';
import type { RevokeOutcome, SessionSummary } from '@ideanest/account/sessions';
import { api, sendJson } from '../../../api/client';

/**
 * The account's live devices, newest activity first — `GET /v1/auth/sessions`.
 *
 * The contract types every field optional (springdoc cannot say otherwise); the service always
 * sends the required ones, and `SessionSummary` states the wire shape, as the web's reader does.
 */
export async function listSessions(signal?: AbortSignal): Promise<readonly SessionSummary[]> {
  const rows = await api().get('/v1/auth/sessions', { signal });
  return rows as readonly SessionSummary[];
}

/**
 * Ends one device's session — `DELETE /v1/auth/sessions/{id}`.
 *
 * A 404 means "unknown" or "not yours", deliberately indistinguishable; either way the row is
 * gone, which is what was asked, so it is a success here exactly as on the web.
 */
export async function revokeSession(id: string): Promise<RevokeOutcome> {
  try {
    await sendJson('DELETE', `/v1/auth/sessions/${encodeURIComponent(id)}`);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return 'already-gone';
    throw cause;
  }
  return 'revoked';
}
