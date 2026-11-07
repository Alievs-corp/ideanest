import type { components } from '@ideanest/api-client';

/**
 * The audience beacon — #634, the web half of epic #632.
 *
 * <h2>What it counts, and what it does not keep</h2>
 *
 * Three events, each one small JSON body to `POST /v1/audience/events`: a page was shown
 * (`VISIT`), a campaign page was opened (`VIEW`), a campaign card was followed (`CLICK`, with
 * the listing it was on). The service turns them into people per Asia/Baku day without a cookie
 * and without keeping an address — `apps/api/README.md` has how. Nothing here identifies
 * anybody either: no cookie is written, no identifier is generated, nothing is stored.
 *
 * <h2>Same origin, through the `/v1` rewrite</h2>
 *
 * The path is relative, so it goes where every other browser read goes: `next.config.ts`
 * proxies `/v1` to the service. That is what carries Cloudflare's `CF-Connecting-IP` and
 * `CF-IPCountry` through to it, which is where the country comes from. No preflight, no third
 * party, and the CSP's `connect-src 'self'` already allows it.
 *
 * <h2>Why `sendBeacon` first</h2>
 *
 * A `CLICK` is sent at the moment the reader is leaving the page it was on, which is the moment
 * a browser cancels in-flight requests. `sendBeacon` hands the body to the user agent, which
 * keeps it alive after the document is gone, and returns synchronously. `fetch` with
 * `keepalive` is the documented equivalent when it is absent or refuses — `lib/rum/beacon.ts`
 * makes the same choice for the same reason. The body is a `Blob` typed `application/json`,
 * because a bare string is sent as `text/plain` and the endpoint answers that 415.
 *
 * <h2>It never throws and never waits</h2>
 *
 * A counter is not allowed to become the incident. Every door is tried inside a `try`, a
 * rejected `fetch` is swallowed, and nothing here is awaited by anybody. A lost event is a
 * number one lower on a chart; a thrown one would be a broken page.
 *
 * <h2>Automation is not an audience</h2>
 *
 * `navigator.webdriver` is true under Playwright, Puppeteer and Selenium — this repository's
 * own end-to-end runs among them. The service filters bot user agents as well, but a headless
 * browser driving a test sends a perfectly ordinary one.
 */

export type AudienceEventRequest = components['schemas']['AudienceEventRequest'];

/** Which listing a card was followed from. The service's `AudienceSurface`, verbatim. */
export type AudienceSurface = NonNullable<AudienceEventRequest['surface']>;

export const AUDIENCE_ENDPOINT = '/v1/audience/events';

/**
 * One event, shaped so the wrong combination cannot be written: `projectId` only where the
 * service requires it, `surface` only on a click. The service answers a `surface` on a `VISIT`
 * or a `VIEW` with a 400, and a `projectId` on a `VISIT` the same.
 */
export type AudienceEvent =
  | { readonly kind: 'VISIT' }
  | { readonly kind: 'VIEW'; readonly projectId: string }
  | { readonly kind: 'CLICK'; readonly projectId: string; readonly surface: AudienceSurface };

/** How an event left, for the tests and for nothing else. */
export type AudienceDelivery = 'sendBeacon' | 'fetch' | 'none' | 'skipped';

/** The browser, narrowed to what this needs, so a test can hand in its own. */
export interface AudienceEnvironment {
  readonly webdriver?: boolean | undefined;
  readonly sendBeacon?: ((url: string, data: BodyInit) => boolean) | undefined;
  readonly fetch?: typeof fetch | undefined;
}

/**
 * The body the service reads. `platform` is always `WEB` from here; every other field is the
 * event's own, which the union above already keeps to what each kind allows.
 */
export function audienceBody(event: AudienceEvent): AudienceEventRequest {
  return { ...event, platform: 'WEB' };
}

/** The real browser, or nothing on a server render. */
export function browserAudienceEnvironment(): AudienceEnvironment {
  if (typeof navigator === 'undefined') return {};
  return {
    webdriver: navigator.webdriver,
    sendBeacon: typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : undefined,
    fetch: typeof fetch === 'function' ? fetch : undefined,
  };
}

export function sendAudienceEvent(
  event: AudienceEvent,
  environment: AudienceEnvironment = browserAudienceEnvironment(),
): AudienceDelivery {
  if (environment.webdriver === true) return 'skipped';

  let body: string;
  try {
    body = JSON.stringify(audienceBody(event));
  } catch {
    return 'none';
  }

  const { sendBeacon, fetch: fetchImpl } = environment;
  if (typeof sendBeacon === 'function') {
    try {
      if (sendBeacon(AUDIENCE_ENDPOINT, new Blob([body], { type: 'application/json' }))) return 'sendBeacon';
    } catch {
      // An extension that replaced `sendBeacon` with something that throws: try the other door.
    }
  }

  if (typeof fetchImpl === 'function') {
    try {
      void fetchImpl(AUDIENCE_ENDPOINT, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => undefined);
      return 'fetch';
    } catch {
      return 'none';
    }
  }

  return 'none';
}
