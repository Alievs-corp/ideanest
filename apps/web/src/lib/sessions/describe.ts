import type { SessionSummary } from './api';
import { fillPlaceholders } from '../i18n/placeholders';

/**
 * Turning a session row into something a person can recognise.
 *
 * The point of this screen is that a user spots the device that is not theirs.
 * A raw user-agent string does not support that judgement, so the strings here
 * are deliberately coarse: the browser and the platform, and nothing that
 * pretends to more precision than a user-agent can honestly carry.
 */

/**
 * Ordered — first match wins, and the order is the whole trick. Every
 * Chromium-derived browser still says "Chrome", and Chrome and Edge both still
 * say "Safari", so the specific tokens have to be tested before the general
 * ones.
 */
const BROWSERS: ReadonlyArray<readonly [pattern: RegExp, name: string]> = [
  [/\bEdg(?:iOS|A|)\//, 'Edge'],
  [/\b(?:OPR|OPiOS)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

/**
 * Also ordered. An Android user-agent contains "Linux", and an iOS one
 * contains "like Mac OS X", so the narrower platform is tested first.
 */
const PLATFORMS: ReadonlyArray<readonly [pattern: RegExp, name: string]> = [
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\b(?:Mac OS X|Macintosh)\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(
  table: ReadonlyArray<readonly [RegExp, string]>,
  userAgent: string | undefined,
): string | null {
  if (!userAgent) return null;

  for (const [pattern, name] of table) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

export function browserOf(userAgent: string | undefined): string | null {
  return firstMatch(BROWSERS, userAgent);
}

export function platformOf(userAgent: string | undefined): string | null {
  return firstMatch(PLATFORMS, userAgent);
}

/**
 * The two words this module cannot parse out of a user agent — issue #80.
 *
 * A browser is called Chrome in every language and a platform is called macOS in every
 * language; those are names and they are left alone. What joins them is a preposition, and
 * "Chrome on macOS" is English — Azerbaijani and Turkish put the platform first. The
 * admission for a session with neither is prose too. Both arrive as an argument, the shape
 * `lib/moderation/describe.ts` is in: this module is imported by a client bundle and cannot
 * read a catalogue.
 */
export interface DeviceNameCopy {
  /** Carries `{browser}` and `{platform}`. */
  readonly onPlatform: string;
  readonly unknownDevice: string;
}

/**
 * What the row is called.
 *
 * The label the client sent at sign-in wins, because a person who named their
 * laptop knows better than a parser does. Failing that, browser and platform.
 * Failing that, a plain admission — an invented name on a security screen is
 * worse than no name, because the user would have to decide whether to trust it.
 */
export function deviceNameOf(
  session: Pick<SessionSummary, 'deviceLabel' | 'userAgent'>,
  copy: DeviceNameCopy,
): string {
  const label = session.deviceLabel?.trim();
  if (label) return label;

  const browser = browserOf(session.userAgent);
  const platform = platformOf(session.userAgent);

  if (browser && platform) return fillPlaceholders(copy.onPlatform, { browser, platform });
  return browser ?? platform ?? copy.unknownDevice;
}

/**
 * "3 hours ago", and the exact timestamp behind it.
 *
 * Both now live in `lib/time.ts`, because the notification inbox (#88) needs the
 * same two functions and nothing about them is about a session. Re-exported
 * rather than moved outright so that this module stays the one place a session
 * row is described from — `lastSeenAt` only advances when the session
 * refreshes, so "3 hours ago" here is coarser than the words imply, and that is
 * a fact about sessions rather than about the formatter.
 */
export { formatRelativeTime, formatExactTime } from '../time';

/**
 * The second line of a row: where the session is signed in from.
 *
 * The address is what the service saw on the socket. It is not derived from
 * `X-Forwarded-For`, so behind an un-configured proxy it can be the proxy's own
 * address — which is why the row says "IP address" rather than a place.
 */
export function locationOf(session: Pick<SessionSummary, 'ipAddress'>): string | null {
  const address = session.ipAddress?.trim();
  return address ? address : null;
}
