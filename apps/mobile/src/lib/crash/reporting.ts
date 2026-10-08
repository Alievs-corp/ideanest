import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { crashReportingSettings } from '../../api/config';
import { lastTraceId, onTraceId } from '../../api/last-trace';
import { scrubBreadcrumb, scrubEvent } from './scrub';

/**
 * Crash and error reporting — issue #165, `@sentry/react-native`.
 *
 * <h2>Off unless the build was given somewhere to send it</h2>
 *
 * `IDEANEST_SENTRY_DSN` decides, at build time (`app.config.ts`). Unset, {@link startCrashReporting}
 * returns before the SDK is started, so nothing is collected, nothing is queued on the device and
 * no request is made — not a disabled client, no client. Whether the destination is sentry.io's EU
 * region or a self-hosted GlitchTip is the owner's decision (`README.md`); the SDK and everything
 * here are the same for both, which is why the address is the only thing the build is told.
 *
 * <h2>What an event carries</h2>
 *
 *   - `release` is the version and the build number, `dist` the platform, and `environment` the
 *     EAS channel the build was made for, so one release's iOS and Android crashes are two
 *     distributions of one release rather than two releases;
 *   - the tag `api_trace_id`: the `X-Trace-Id` of the service's last answer, so a crash can be
 *     joined to the log line of the request before it (§18.1). A failure that came from a
 *     response tags its own trace id instead ({@link reportBoundaryError});
 *   - the user, as the account's UUID and nothing else ({@link identifyForCrashReports});
 *   - every event, transaction and breadcrumb is passed through `scrub.ts` first.
 *
 * Session replay is off — it would film the address and payment screens — and so are screenshots
 * and the view hierarchy, which would carry the same text. Tracing samples a tenth of production
 * sessions and nothing elsewhere.
 */

const TRACE_TAG = 'api_trace_id';

type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * Options the JavaScript SDK does not type but hands to the native SDK as they are.
 *
 * <p>`enableNetworkBreadcrumbs`: sentry-cocoa records a breadcrumb, URL and query included, for
 * every `NSURLSession` request, and a native crash carries them without passing through
 * `beforeBreadcrumb` — an emailed link's `?token=` among them. Off. The JavaScript SDK's own
 * fetch breadcrumbs still arrive, scrubbed. Android needs no switch: OkHttp breadcrumbs come only
 * from Sentry's Gradle plugin or its OkHttp integration, and this app uses neither.
 */
interface NativeOnlyOptions {
  readonly enableNetworkBreadcrumbs: boolean;
}

let started = false;

export function startCrashReporting(): void {
  const settings = crashReportingSettings();
  if (started || settings === null) return;
  started = true;

  const options: SentryOptions & NativeOnlyOptions = {
    dsn: settings.dsn,
    environment: settings.environment,
    release: releaseName(),
    dist: Platform.OS,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    tracesSampleRate: settings.environment === 'production' ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: (event) => scrubEvent(withTraceTag(event)),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    enableNetworkBreadcrumbs: false,
  };
  Sentry.init(options);

  // Onto the scope as it changes, so a NATIVE crash — sent by the native SDK at the next launch,
  // never through `beforeSend` — carries it too.
  const current = lastTraceId();
  if (current !== null) Sentry.setTag(TRACE_TAG, current);
  onTraceId((traceId) => Sentry.setTag(TRACE_TAG, traceId));
}

/** `1.4.0+57`: the store version and the build number, both from the binary. */
export function releaseName(): string {
  const version = Application.nativeApplicationVersion ?? '0.0.0';
  const build = Application.nativeBuildVersion;
  return build === null || build === '' ? version : `${version}+${build}`;
}

function withTraceTag<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.tags?.[TRACE_TAG] !== undefined) return event;
  const traceId = lastTraceId();
  return traceId === null ? event : { ...event, tags: { ...event.tags, [TRACE_TAG]: traceId } };
}

/**
 * Who is signed in, as far as a crash report is told: the account UUID, or nobody. Never the email
 * or the name — `scrub.ts` would drop them anyway, and they are not sent to be dropped.
 */
export function identifyForCrashReports(accountId: string | null): void {
  if (!started) return;
  Sentry.setUser(accountId === null ? null : { id: accountId });
}

/**
 * A render error that one of the app's own boundaries caught (`route-error-boundary.tsx`,
 * `root-failure.tsx`). Those boundaries stay the app's: the SDK's `ErrorBoundary` is not mounted,
 * because Expo Router already wraps each route in the one it exports, and a second boundary
 * around the root would catch the root's failures before `RootFailure` could draw them.
 */
export function reportBoundaryError(error: unknown, boundary: 'route' | 'root', traceId: string | null): void {
  if (!started) return;
  Sentry.captureException(error, {
    tags: { boundary, ...(traceId === null ? {} : { [TRACE_TAG]: traceId }) },
  });
}

/** Test seam. */
export function resetCrashReporting(): void {
  started = false;
  onTraceId(null);
}
