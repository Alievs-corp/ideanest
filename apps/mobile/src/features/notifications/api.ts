import type { InboxCursor, InboxNotification, InboxPage } from '@ideanest/account/inbox';
import { api, sendJson } from '../../api/client';

/**
 * The inbox's two calls — the web's `lib/notifications/api.ts` (#88), for the app (#160).
 *
 * <p>The page is never persisted (`lib/offline.ts`): an inbox restored after a restart would show
 * last week's unread rows as if they were news. Offline, the screen keeps what it read in memory.
 */

/**
 * One page of the caller's inbox, newest first — `GET /v1/me/notifications`. The cursor travels
 * as both halves or not at all; the service refuses half of one.
 */
export async function listNotifications(
  cursor: InboxCursor | null,
  signal?: AbortSignal,
): Promise<InboxPage> {
  const body = await api().get('/v1/me/notifications', {
    query: cursor === null ? {} : { before: cursor.before, beforeId: cursor.beforeId },
    signal,
  });
  return {
    // Through `unknown`: the contract types `params` as a string, and `@JsonRawValue` sends an
    // object (`InboxNotification` in `@ideanest/account/inbox`).
    notifications: (body.notifications ?? []) as unknown as readonly InboxNotification[],
    nextCursor: body.nextCursor ?? undefined,
    nextCursorId: body.nextCursorId ?? undefined,
    unreadCount: body.unreadCount ?? 0,
  };
}

/**
 * Records that the caller opened one notification and answers the row —
 * `POST /v1/me/notifications/{id}/read`. Idempotent; the service keeps the first instant.
 */
export async function markNotificationRead(id: string): Promise<InboxNotification> {
  return (await sendJson(
    'POST',
    `/v1/me/notifications/${encodeURIComponent(id)}/read`,
  )) as InboxNotification;
}
