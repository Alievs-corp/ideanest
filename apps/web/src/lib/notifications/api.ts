import type { components } from '@ideanest/api-client';
import type {
  DeliveryMode,
  NotificationCategory,
  NotificationChannel,
  PreferenceChange,
  PreferenceSwitch,
} from '@ideanest/account/notifications';
import type {
  InboxCursor,
  InboxNotification,
  InboxPage,
  NotificationType,
} from '@ideanest/account/inbox';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * What the inbox and the settings page ask the service — §4.10, and #88 and #89.
 *
 * <h2>Browser reads, both of them</h2>
 *
 * `lib/api/server.ts` is for #119's public pages and sends no token on purpose. Neither of
 * these is public: one is a person's own inbox and the other is their own settings, both
 * behind a bearer token, and the service answers the inbox with no validator at all —
 * `NotificationInboxResponse` explains why an ETag on a body that changes the moment you
 * read a row would only be a header. So both are fetched after hydration, like the
 * dashboard.
 *
 * <h2>The types are the contract's, narrowed</h2>
 *
 * springdoc marks every field optional because Java has no way to tell it otherwise, but
 * both responses are serialised with `JsonInclude.ALWAYS` — every key is present, and a
 * null is written as null rather than omitted. Narrowing here rather than guarding at every
 * use site is the same choice `lib/dashboard/api.ts` made, and the reason is the same: a
 * screen full of `?.` hides which fields genuinely can be absent. Only `readAt`,
 * `subjectType`, `subjectId` and the two cursor halves can, and those stay optional.
 */

type ContractInbox = components['schemas']['NotificationInboxResponse'];

/*
 * The preference table and the inbox row are shared with the app (#161, #160), so their types
 * live in `@ideanest/account`.
 */
export type {
  DeliveryMode,
  InboxCursor,
  InboxNotification,
  InboxPage,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
  PreferenceChange,
  PreferenceSwitch,
};

/**
 * One page of the caller's inbox, newest first.
 *
 * @param cursor where to continue from, or absent for the first page. The two halves travel
 *   together because the ordering is `(occurredAt, id)` — two notifications fanned out from
 *   one event share the instant, so an instant alone would either serve one twice or skip
 *   the other. The service refuses half a cursor with a 400 rather than guessing.
 * @throws ApiError on any refusal
 */
export async function listNotifications(
  cursor?: InboxCursor,
  signal?: AbortSignal,
): Promise<InboxPage> {
  const query = new URLSearchParams();
  if (cursor !== undefined) {
    query.set('before', cursor.before);
    query.set('beforeId', cursor.beforeId);
  }
  const search = query.toString();
  const suffix = search === '' ? '' : `?${search}`;

  const response = await authorizedFetch(`/v1/me/notifications${suffix}`, {
    // The service sends no validator and the body changes whenever anything happens to the
    // account. A cached page here is an inbox that stopped arriving.
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as ContractInbox;
  return {
    // Cast through `unknown`: springdoc types `params` as a `string` because Java only ever
    // sees the field's declared type, `String`, and cannot see that `@JsonRawValue` splices
    // its content into the response as an object rather than encoding it as one. The
    // generated contract is wrong about this one field; `InboxNotification` states the wire
    // shape it actually is.
    notifications: (body.notifications ?? []) as unknown as readonly InboxNotification[],
    nextCursor: body.nextCursor,
    nextCursorId: body.nextCursorId,
    unreadCount: body.unreadCount ?? 0,
  };
}

/**
 * Records that the caller has opened one notification, and answers the row.
 *
 * Idempotent, and the service keeps the first instant — so a double tap and a retry are
 * both harmless. A 404 means "unknown" or "not yours", deliberately indistinguishable;
 * from this screen both readings mean the row is not actionable, so it is reported as an
 * error the caller can choose to ignore rather than silently swallowed here.
 *
 * @throws ApiError on any refusal
 */
export async function markNotificationRead(id: string): Promise<InboxNotification> {
  const response = await authorizedFetch(
    `/v1/me/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as InboxNotification;
}

/**
 * Every switch §4.10 has, for this account.
 *
 * Always the whole page, never only the stored rows — the common case is an account that
 * has never opened this screen, and `NotificationPreferencesResponse` explains why a
 * response listing the table would be empty for all of them.
 *
 * @throws ApiError on any refusal
 */
export async function listPreferences(signal?: AbortSignal): Promise<readonly PreferenceSwitch[]> {
  const response = await authorizedFetch('/v1/me/notification-preferences', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as components['schemas']['NotificationPreferencesResponse'];
  return (body.preferences ?? []) as readonly PreferenceSwitch[];
}

/**
 * Sets some switches, and answers with the whole page.
 *
 * The whole page rather than what changed, because a change can move something the caller
 * did not send. All of it or none of it: the service checks every instruction before it
 * writes any, so a request with a refused switch in the middle leaves nothing saved.
 *
 * @throws ApiError on any refusal. 422 is a mandatory category or a digest on a channel
 *   that cannot digest, 409 is two requests writing one switch at once, 429 is the
 *   per-account write budget
 */
export async function updatePreferences(
  changes: readonly PreferenceChange[],
): Promise<readonly PreferenceSwitch[]> {
  const response = await authorizedFetch('/v1/me/notification-preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: changes }),
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as components['schemas']['NotificationPreferencesResponse'];
  return (body.preferences ?? []) as readonly PreferenceSwitch[];
}
