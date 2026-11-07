import { Platform } from 'react-native';
import type { components } from '@ideanest/api-client';
import { apiOrigin } from '../../api/config';

/**
 * One audience beacon on the wire — `POST /v1/audience/events` (#632, #636).
 *
 * <p>The body is the contract's: `kind`, `platform`, and `projectId` and `surface` only where the
 * service requires them (a `surface` on a VISIT or VIEW is a 400, so it is never sent there).
 */
export type AudienceEventRequest = components['schemas']['AudienceEventRequest'];
export type AudienceSurface = NonNullable<AudienceEventRequest['surface']>;
export type AudiencePlatform = AudienceEventRequest['platform'];

/** What a caller says; the platform is this module's to add. */
export type AudienceEvent =
  | { readonly kind: 'VISIT' }
  | { readonly kind: 'VIEW'; readonly projectId: string }
  | { readonly kind: 'CLICK'; readonly projectId: string; readonly surface: AudienceSurface };

/**
 * `IOS` or `ANDROID`, or null on anything else (the web build of the app): the site counts its own
 * visitors as `WEB`, and an Expo web bundle claiming to be the site would count them twice.
 */
export function audiencePlatform(os: string = Platform.OS): AudiencePlatform | null {
  if (os === 'ios') return 'IOS';
  if (os === 'android') return 'ANDROID';
  return null;
}

/** The request body for an event, or null when it is not worth sending. */
export function audienceBody(event: AudienceEvent, platform: AudiencePlatform): AudienceEventRequest | null {
  if (event.kind === 'VISIT') return { kind: 'VISIT', platform };
  if (event.projectId === '') return null;
  if (event.kind === 'VIEW') return { kind: 'VIEW', platform, projectId: event.projectId };
  return { kind: 'CLICK', platform, projectId: event.projectId, surface: event.surface };
}

/**
 * Sends one event and forgets it.
 *
 * <h2>Never throws, never waits, never says who is reading</h2>
 *
 * <p>A figure for the creator is not worth a frame of the reader's: the request is started and not
 * awaited, every failure — offline, a 429 from the limiter, a build with no API origin — is
 * swallowed, and nothing retries. Plain `fetch`, not the session client: the service ignores a
 * bearer on this path, so there is no reason to refresh a token for it or to send one, and a
 * response here must not reach the maintenance trigger (a beacon is not a screen).
 *
 * <p>The phone's own `User-Agent` goes with it (`okhttp` on Android, CFNetwork on iOS); the service
 * hashes it with the address for the day's visitor key and stores neither.
 */
export function sendAudienceEvent(event: AudienceEvent, os: string = Platform.OS): void {
  try {
    const platform = audiencePlatform(os);
    if (platform === null) return;
    const body = audienceBody(event, platform);
    if (body === null) return;
    void fetch(`${apiOrigin()}/v1/audience/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // No origin, no `fetch`: the event is lost, which is what a beacon is allowed to do.
  }
}
