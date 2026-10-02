import type { PreferenceChange, PreferenceSwitch } from '@ideanest/account/notifications';
import { api, sendJson } from '../../../api/client';

/**
 * Every switch §4.10 has for this account — `GET /v1/me/notification-preferences`. Always the
 * whole table, resolved through the service's policy, never only the stored rows.
 */
export async function listPreferences(signal?: AbortSignal): Promise<readonly PreferenceSwitch[]> {
  const body = await api().get('/v1/me/notification-preferences', { signal });
  return (body.preferences ?? []) as readonly PreferenceSwitch[];
}

/**
 * Sets one switch and answers the whole table — `PATCH /v1/me/notification-preferences`. The
 * whole table rather than the one row, because a change can move something not sent.
 */
export async function updatePreference(change: PreferenceChange): Promise<readonly PreferenceSwitch[]> {
  const body = (await sendJson('PATCH', '/v1/me/notification-preferences', {
    preferences: [change],
  })) as { readonly preferences?: readonly PreferenceSwitch[] } | null;
  return body?.preferences ?? [];
}
