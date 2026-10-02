import { ApiError } from '@ideanest/api-client';
import { api, publicApi, sendJson } from '../../../api/client';

/**
 * The three requests behind `settings/privacy` (#161) — the web's `lib/profiles/api.ts`
 * visibility pair and `lib/account/closure.ts`.
 */

export type ProfileVisibility = 'PUBLIC' | 'PRIVATE';

/** `PATCH /v1/me/profile-visibility` — 204, so the new position is confirmed by a probe. */
export async function setProfileVisibility(visibility: ProfileVisibility): Promise<void> {
  await sendJson('PATCH', '/v1/me/profile-visibility', { visibility });
}

/**
 * The account's own visibility, read from its effect: `GET /v1/users/{slug}` as nobody.
 *
 * There is no read for this setting, so the public endpoint is asked what a stranger sees: 200 is
 * `PUBLIC`, 404 is `PRIVATE`. It must go out without the bearer — with it, the service would
 * answer the owner, who can always see their own profile. `null` is an answer the contract does
 * not describe; a transport failure throws.
 */
export async function probeProfileVisibility(
  slug: string,
  signal?: AbortSignal,
): Promise<ProfileVisibility | null> {
  try {
    await publicApi().get('/v1/users/{slug}', { path: { slug }, signal, cache: 'no-store' });
    return 'PUBLIC';
  } catch (cause) {
    if (cause instanceof ApiError) return cause.status === 404 ? 'PRIVATE' : null;
    throw cause;
  }
}

/** The name the shared file gets, matching the service's own `Content-Disposition`. */
export const EXPORT_FILENAME = 'ideanest-account.json';

/**
 * `GET /v1/me/export`, as the text of the file. Never through a query: the export is everything
 * the platform holds about a person, and the query cache can be written to disk.
 */
export async function fetchAccountExport(): Promise<string> {
  const body = await api().get('/v1/me/export', { cache: 'no-store' });
  return JSON.stringify(body, null, 2);
}

export type DeletionOutcome =
  /** `scheduledFor` is the 202's date, or null when the body did not carry one. */
  | { readonly kind: 'scheduled'; readonly scheduledFor: string | null }
  | { readonly kind: 'already-gone' };

/**
 * `POST /v1/me/deletion {password}` — 202 with the schedule. The screen reads it back from
 * `GET /v1/me`'s `deletionScheduledAt`, and holds this answer's date until that read agrees. A
 * 404 is a token for an account that is no longer there.
 */
export async function requestDeletion(password: string): Promise<DeletionOutcome> {
  try {
    const body = await sendJson('POST', '/v1/me/deletion', { password });
    const scheduledFor =
      typeof body === 'object' && body !== null && 'scheduledFor' in body && typeof body.scheduledFor === 'string'
        ? body.scheduledFor
        : null;
    return { kind: 'scheduled', scheduledFor };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { kind: 'already-gone' };
    throw cause;
  }
}

/**
 * `DELETE /v1/me/deletion` — takes only the session, deliberately. A 404 means nothing was
 * scheduled, which is the state the reader asked for.
 */
export async function cancelDeletion(): Promise<void> {
  try {
    await sendJson('DELETE', '/v1/me/deletion');
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return;
    throw cause;
  }
}
