import {
  connectionClassOf,
  deviceClassOf,
  navigationTypeOf,
  type ConnectionClass,
  type DeviceClass,
} from './attribution';
import { deliver, serialise, type BeaconEnvironment, type DeliveryMethod } from './beacon';
import { newRequestId, newSpanId } from './correlation';
import { isFieldMetricName, isPlausibleValue } from './metrics';
import { MAX_SAMPLES, PAYLOAD_VERSION, type RumPayload, type RumSample } from './payload';
import { routePatternOf } from './route-pattern';
import { parseSampleRate, resolveSession, type RumSession, type SessionHolder } from './sampling';

/**
 * The buffer between `useReportWebVitals` and the network.
 *
 * One object per visit. It holds at most twenty tiny records, flushes them as a
 * single beacon, and does nothing else — no timers, no observers, no work on any
 * code path a user is waiting for. `beacon.ts` explains why the flush is either
 * idle or synchronous-at-unload and never anything in between.
 *
 * **Everything is injected.** The `Window`, which holds the session, the clock's stand-in
 * for `requestIdleCallback` — all of it arrives as arguments, so the tests
 * exercise the real code rather than a re-implementation of it, and so the
 * module can be imported on the server without touching a global that is not
 * there.
 */

/** The subset of the metric object `useReportWebVitals` passes that is read. */
export interface ReportedMetric {
  readonly name: string;
  readonly value: number;
  readonly navigationType?: string | undefined;
}

export interface ReporterEnvironment {
  /** `location.pathname` at the moment a metric was recorded. */
  readonly pathname: () => string;
  readonly connection: () => ConnectionClass;
  readonly device: () => DeviceClass;
  readonly beacon: BeaconEnvironment;
  /** Deferred work. `requestIdleCallback` where there is one, `setTimeout` otherwise. */
  readonly defer: (task: () => void) => void;
  readonly session: RumSession;
}

export interface Reporter {
  /** Records one metric. Does no work beyond a bounds check and a push. */
  readonly report: (metric: ReportedMetric) => void;
  /** Sends whatever is buffered, now and synchronously. Returns how it went. */
  readonly flush: () => DeliveryMethod;
  /** For the tests, and for nothing else. */
  readonly buffered: () => number;
}

export function createReporter(environment: ReporterEnvironment): Reporter {
  let route: string | null = null;
  let samples: RumSample[] = [];
  let deferred = false;

  function flush(): DeliveryMethod {
    if (route === null || samples.length === 0) return 'none';

    const requestId = newRequestId();
    const spanId = newSpanId();
    const payload: RumPayload = {
      v: PAYLOAD_VERSION,
      requestId,
      traceId: environment.session.traceId,
      spanId,
      sessionId: environment.session.id,
      route,
      /*
       * Read here rather than at report time. Both are one property access, and
       * at flush the page is idle or already unloading — whereas a metric can be
       * reported in the middle of an interaction, which is the one moment a
       * `window.innerWidth` read could cost a frame.
       */
      connection: environment.connection(),
      device: environment.device(),
      samples,
    };

    samples = [];
    route = null;

    return deliver(serialise(payload), environment.beacon, {
      requestId,
      traceId: payload.traceId,
      spanId,
    });
  }

  function report(metric: ReportedMetric): void {
    /*
     * FID arrives here on every page load, because `useReportWebVitals`
     * subscribes to `onFID` as well as `onINP` — see
     * `next/dist/client/web-vitals.js`. Google retired FID in September 2024 and
     * INP replaced it; recording both would put two interaction metrics on one
     * dashboard, one of which only ever measures the first interaction.
     */
    if (!isFieldMetricName(metric.name)) return;
    if (!isPlausibleValue(metric.name, metric.value)) return;

    const current = routePatternOf(environment.pathname());
    /*
     * A payload describes one route. A client-side navigation between two
     * metrics would otherwise file the second page's CLS under the first page's
     * pattern, which is the kind of wrong that survives review because the
     * number still looks reasonable.
     */
    if (route !== null && route !== current) flush();

    /*
     * Full, with a flush already queued. Dropping is right: the endpoint refuses
     * a beacon over `MAX_SAMPLES`, so growing past it would lose the whole
     * payload rather than one sample. A real page load produces at most six.
     */
    if (samples.length >= MAX_SAMPLES) return;

    route = current;
    samples.push({
      name: metric.name,
      value: metric.value,
      navigationType: navigationTypeOf(metric.navigationType),
    });

    if (samples.length >= MAX_SAMPLES) {
      scheduleFlush();
    }
  }

  function scheduleFlush(): void {
    if (deferred) return;
    deferred = true;
    environment.defer(() => {
      deferred = false;
      flush();
    });
  }

  return { report, flush, buffered: () => samples.length };
}

/**
 * `requestIdleCallback` where the browser has one, a macrotask where it does
 * not.
 *
 * Safari still ships no `requestIdleCallback`, and `setTimeout(…, 0)` is the
 * honest approximation: it yields to whatever is already queued, which is the
 * property being bought. Neither runs during unload, which is why the unload
 * path calls `flush` directly.
 */
export function deferOn(window: Window): (task: () => void) => void {
  const idle = (window as Window & { requestIdleCallback?: (task: () => void) => number })
    .requestIdleCallback;
  if (typeof idle === 'function') return (task) => void idle.call(window, task);
  return (task) => void window.setTimeout(task, 0);
}

/**
 * Everything the reporter needs, read off a real browser.
 *
 * Returns null when this visit is not sampled, so the caller's whole
 * subscription is a no-op and not a subscription that discards. That matters:
 * `useReportWebVitals` attaches six `PerformanceObserver`s, and a session that
 * is not being measured should not be paying for them.
 */
export function browserEnvironment(
  window: Window,
  rawSampleRate: string | undefined,
): ReporterEnvironment | null {
  const rate = parseSampleRate(rawSampleRate);
  if (rate <= 0) return null;

  const session = resolveSession(window as Window & SessionHolder, rate);
  if (!session.sampled) return null;

  return {
    pathname: () => window.location.pathname,
    connection: () => connectionClassOf(window.navigator),
    device: () => deviceClassOf(window.innerWidth),
    beacon: {
      sendBeacon:
        typeof window.navigator.sendBeacon === 'function'
          ? (url, data) => window.navigator.sendBeacon(url, data)
          : undefined,
      fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined,
    },
    defer: deferOn(window),
    session,
  };
}

/**
 * Attaches the flush to the two events that mean "this visit is over".
 *
 * `pagehide` and `visibilitychange`, and both are needed. `visibilitychange` to
 * `hidden` is the only one mobile Safari reliably fires when a user switches
 * apps — a tab that is never brought back is closed without another event — and
 * `pagehide` covers the desktop case of a navigation away from a page that was
 * never hidden first. `beforeunload` and `unload` are deliberately absent: both
 * make a page ineligible for the back-forward cache, so listening for them to
 * measure performance would slow every back button on the site.
 *
 * Returns the function that detaches both.
 */
export function attachFlushHandlers(window: Window, flush: () => void): () => void {
  const onPageHide = (): void => void flush();
  const onVisibilityChange = (): void => {
    if (window.document.visibilityState === 'hidden') flush();
  };

  window.addEventListener('pagehide', onPageHide);
  window.document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('pagehide', onPageHide);
    window.document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
