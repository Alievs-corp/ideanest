import type * as Notifications from 'expo-notifications';
import { isAboutAPlan, type NotificationType } from '@ideanest/account/inbox';
import { destinationFor, type Destination } from './links';

/**
 * What a tapped push asks for — #160. Pure, so the routing rules are tested without a phone.
 *
 * <ul>
 *   <li>`data.url` goes through {@link destinationFor}, exactly like a shared link.</li>
 *   <li>A payload of ours (`ideanest://`) with no destination — a digest — opens the inbox: for a
 *       push, that is where the message lives. A shared link with no destination still stays put;
 *       the difference is this handler's, not the parser's.</li>
 *   <li>A non-string `url`, or a URL for a host this build does not claim, is ignored.</li>
 *   <li>A message about the creator's own plan (`data.type`, #452) opens the website's pricing page
 *       in the browser, whatever `url` says: the app does not sell or renew plans (Apple 3.1.1 and
 *       Play Billing, #164), so its own pricing screen would be one more tap on the way there. It is
 *       read from the type, so a push sent before the service gave these a path does the same.</li>
 *   <li>`notificationId`, when the payload carries one, is the inbox row to mark read.</li>
 * </ul>
 */
export interface PushTap {
  readonly destination: Destination | null;
  /** A locale-less path to open on the website, in the browser, instead of a screen — #452. */
  readonly web: string | null;
  readonly notificationId: string | null;
}

/** Where a message about the creator's plan goes on the web: `hrefOf`'s and the email's page. */
const PRICING = '/pricing';

const INBOX: Destination = { pathname: '/notifications' };

export function pushTapOf(data: unknown, siteHost: string): PushTap {
  const payload = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const { url, notificationId, type } = payload;
  const id = typeof notificationId === 'string' && notificationId.trim() !== '' ? notificationId : null;

  if (typeof type === 'string' && isAboutAPlan(type as NotificationType)) {
    return { destination: null, web: PRICING, notificationId: id };
  }
  if (typeof url !== 'string') return { destination: null, web: null, notificationId: id };

  const ours = ourScheme(url);
  // The bare scheme is "no destination" here; `destinationFor` reads it as the home page.
  if (ours !== null && ours.host === '' && (ours.pathname === '' || ours.pathname === '/')) {
    return { destination: INBOX, web: null, notificationId: id };
  }
  const destination = destinationFor(url, siteHost);
  if (destination !== null) return { destination, web: null, notificationId: id };
  return { destination: ours === null ? null : INBOX, web: null, notificationId: id };
}

function ourScheme(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ideanest:' ? parsed : null;
  } catch {
    return null;
  }
}

/** The payload of a tapped notification. */
export function dataOf(response: Notifications.NotificationResponse): unknown {
  return response.notification.request.content.data;
}

const handled = new Set<string>();

/**
 * True the first time a response is seen in this process, false after. A cold-start tap is
 * reported by `getLastNotificationResponseAsync` on every mount of the root and also, on some
 * platforms, by the listener: keyed by the notification's identifier, it is acted on once.
 */
export function claimResponse(response: Notifications.NotificationResponse): boolean {
  const key = `${response.notification.request.identifier}|${response.notification.date}`;
  if (handled.has(key)) return false;
  handled.add(key);
  return true;
}

/** For tests: forget which responses were handled. */
export function forgetHandledResponses(): void {
  handled.clear();
}
