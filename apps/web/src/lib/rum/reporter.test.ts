import { describe, expect, it, vi } from 'vitest';
import {
  attachFlushHandlers,
  browserEnvironment,
  createReporter,
  deferOn,
  type ReporterEnvironment,
} from './reporter';
import { MAX_SAMPLES, parseRumPayload } from './payload';
import { UNRECOGNISED_ROUTE } from './route-pattern';
import { SESSION_SLOT, type RumSession } from './sampling';

const session = {
  id: '0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c',
  sampled: true,
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
};

function environment(overrides: Partial<ReporterEnvironment> = {}) {
  /*
   * `deliver` hands `sendBeacon` a `Blob`, because that is the only way to set
   * the media type the endpoint requires. Reading one is asynchronous, so the
   * bodies are collected as promises and awaited where they are asserted on.
   */
  const sent: Promise<string>[] = [];
  const deferred: (() => void)[] = [];
  const base: ReporterEnvironment = {
    pathname: () => '/en/discover',
    connection: () => '4g',
    device: () => 'mobile',
    beacon: {
      sendBeacon: (_url, data) => {
        sent.push((data as Blob).text());
        return true;
      },
    },
    defer: (task) => void deferred.push(task),
    session,
    ...overrides,
  };
  return { environment: base, sent, deferred };
}

/** What the endpoint would see, so the two halves are asserted against each other. */
async function parsedFrom(sent: readonly Promise<string>[], index = 0) {
  const body = await (sent[index] ?? Promise.resolve(''));
  const result = parseRumPayload(body);
  expect(result.ok, `beacon ${index} was not a valid payload`).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.payload;
}

describe('createReporter', () => {
  it('buffers and sends one beacon the endpoint would accept', async () => {
    const { environment: env, sent } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1822, navigationType: 'navigate' });
    reporter.report({ name: 'CLS', value: 0.043, navigationType: 'navigate' });
    expect(sent).toHaveLength(0);
    expect(reporter.buffered()).toBe(2);

    expect(reporter.flush()).toBe('sendBeacon');

    const payload = await parsedFrom(sent);
    expect(payload.route).toBe('/[locale]/discover');
    expect(payload.sessionId).toBe(session.id);
    expect(payload.traceId).toBe(session.traceId);
    expect(payload.samples).toEqual([
      { name: 'LCP', value: 1822, navigationType: 'navigate' },
      { name: 'CLS', value: 0.043, navigationType: 'navigate' },
    ]);
  });

  /*
   * `useReportWebVitals` subscribes to `onFID` as well as `onINP` — see
   * `next/dist/client/web-vitals.js` — so a FID sample arrives on every page
   * load. Google retired it in September 2024.
   */
  it('drops the retired FID and the custom metrics Next emits', () => {
    const { environment: env, sent } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'FID', value: 12, navigationType: 'navigate' });
    reporter.report({ name: 'Next.js-hydration', value: 30, navigationType: 'navigate' });
    expect(reporter.buffered()).toBe(0);
    expect(reporter.flush()).toBe('none');
    expect(sent).toHaveLength(0);
  });

  it('drops a value that could not have been measured', () => {
    const { environment: env } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: -1, navigationType: 'navigate' });
    reporter.report({ name: 'LCP', value: Number.POSITIVE_INFINITY, navigationType: 'navigate' });
    expect(reporter.buffered()).toBe(0);
  });

  it('normalises a navigation type it has never heard of', async () => {
    const { environment: env, sent } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1, navigationType: 'teleport' });
    reporter.flush();

    expect((await parsedFrom(sent)).samples[0]?.navigationType).toBe('unknown');
  });

  it('sends the route pattern and never the path it came from', async () => {
    const { environment: env, sent } = environment({
      pathname: () => '/en/projects/019432f1-2c4a-7bb1-9f7e-0f21b7c9a4d2/back',
    });
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1822, navigationType: 'navigate' });
    reporter.flush();

    expect((await parsedFrom(sent)).route).toBe('/[locale]/projects/[id]/back');
    expect(await sent[0]).not.toContain('019432f1');
  });

  it('reports an unknown path as the sentinel', async () => {
    const { environment: env, sent } = environment({ pathname: () => '/en/discover?q=watches' });
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1822, navigationType: 'navigate' });
    reporter.flush();

    expect((await parsedFrom(sent)).route).toBe(UNRECOGNISED_ROUTE);
  });

  /*
   * A payload describes one route. Filing the second page's CLS under the first
   * page's pattern is the kind of wrong that survives review because the number
   * still looks reasonable.
   */
  it('flushes when the route changes rather than mixing two pages', async () => {
    let pathname = '/en/discover';
    const { environment: env, sent } = environment({ pathname: () => pathname });
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1000, navigationType: 'navigate' });
    pathname = '/en/settings/sessions';
    reporter.report({ name: 'CLS', value: 0.02, navigationType: 'navigate' });

    expect(sent).toHaveLength(1);
    expect((await parsedFrom(sent, 0)).route).toBe('/[locale]/discover');

    reporter.flush();
    expect((await parsedFrom(sent, 1)).route).toBe('/[locale]/settings/sessions');
  });

  /*
   * Never during an interaction. `beacon.ts` explains why the size-triggered
   * flush is deferred and the unload one is not.
   */
  it('defers the flush it triggers itself, and does not do it twice', async () => {
    const { environment: env, sent, deferred } = environment();
    const reporter = createReporter(env);

    for (let index = 0; index < MAX_SAMPLES + 5; index += 1) {
      reporter.report({ name: 'INP', value: index + 1, navigationType: 'navigate' });
    }

    expect(sent).toHaveLength(0);
    expect(deferred).toHaveLength(1);

    deferred[0]?.();
    expect(sent).toHaveLength(1);
    expect((await parsedFrom(sent)).samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
  });

  it('has nothing to send twice', () => {
    const { environment: env, sent } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1822, navigationType: 'navigate' });
    expect(reporter.flush()).toBe('sendBeacon');
    expect(reporter.flush()).toBe('none');
    expect(sent).toHaveLength(1);
  });

  it('gives every beacon its own request and span identifier', async () => {
    const { environment: env, sent } = environment();
    const reporter = createReporter(env);

    reporter.report({ name: 'LCP', value: 1, navigationType: 'navigate' });
    reporter.flush();
    reporter.report({ name: 'LCP', value: 2, navigationType: 'navigate' });
    reporter.flush();

    const first = await parsedFrom(sent, 0);
    const second = await parsedFrom(sent, 1);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.spanId).not.toBe(second.spanId);
    // The trace is the session's, so both beacons join the same trace.
    expect(first.traceId).toBe(second.traceId);
  });
});

describe('browserEnvironment', () => {
  function fakeWindow(session?: RumSession): Window {
    return {
      ...(session === undefined ? {} : { [SESSION_SLOT]: session }),
      location: { pathname: '/en/discover' },
      navigator: { sendBeacon: () => true },
      innerWidth: 400,
      fetch: () => Promise.resolve(new Response()),
      setTimeout: (task: () => void) => {
        task();
        return 0;
      },
    } as unknown as Window;
  }

  it('builds an environment for a sampled session', () => {
    const built = browserEnvironment(fakeWindow(), '1');
    expect(built).not.toBeNull();
    expect(built?.pathname()).toBe('/en/discover');
    expect(built?.device()).toBe('mobile');
    expect(built?.connection()).toBe('unknown');
  });

  /*
   * `useReportWebVitals` attaches six `PerformanceObserver`s. A session that is
   * not being measured should not be paying for a reporter at all.
   */
  it('returns nothing when the rate is zero', () => {
    expect(browserEnvironment(fakeWindow(), '0')).toBeNull();
  });

  it('returns nothing when the page’s session was not sampled', () => {
    const unsampled: RumSession = {
      id: '0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c',
      sampled: false,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    };
    expect(browserEnvironment(fakeWindow(unsampled), '1')).toBeNull();
  });

  /*
   * #641. `instrumentation-client.ts` resolves the session before the reporter
   * does, and the beacons only join the service's requests if both use one trace.
   */
  it('uses the session the page already resolved', () => {
    const window = fakeWindow();
    const built = browserEnvironment(window, '1');
    const session = (window as Window & { [SESSION_SLOT]?: RumSession })[SESSION_SLOT];

    expect(session).toBeDefined();
    expect(built?.session).toBe(session);
    expect(browserEnvironment(window, '1')?.session).toBe(session);
  });
});

describe('deferOn', () => {
  it('prefers requestIdleCallback', () => {
    const idle = vi.fn();
    const window = { requestIdleCallback: idle, setTimeout: vi.fn() } as unknown as Window;
    const task = (): void => {};

    deferOn(window)(task);

    expect(idle).toHaveBeenCalledWith(task);
  });

  // Safari still ships no `requestIdleCallback`.
  it('falls back to a macrotask', () => {
    const setTimeoutSpy = vi.fn();
    const window = { setTimeout: setTimeoutSpy } as unknown as Window;
    const task = (): void => {};

    deferOn(window)(task);

    expect(setTimeoutSpy).toHaveBeenCalledWith(task, 0);
  });
});

describe('attachFlushHandlers', () => {
  /*
   * `visibilitychange` is the only one mobile Safari reliably fires when a user
   * switches apps; `pagehide` covers a desktop navigation away from a page that
   * was never hidden first. `beforeunload` and `unload` are deliberately absent:
   * both make a page ineligible for the back-forward cache, so listening for
   * them to measure performance would slow every back button on the site.
   */
  it('flushes on pagehide and on the page becoming hidden, and listens for nothing else', () => {
    const listeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    let visibilityState = 'visible';

    const window = {
      addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
      document: {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: (type: string, listener: () => void) =>
          void documentListeners.set(type, listener),
        removeEventListener: (type: string) => void documentListeners.delete(type),
      },
    } as unknown as Window;

    const flush = vi.fn();
    const detach = attachFlushHandlers(window, flush);

    expect([...listeners.keys()]).toEqual(['pagehide']);
    expect([...documentListeners.keys()]).toEqual(['visibilitychange']);

    documentListeners.get('visibilitychange')?.();
    expect(flush).not.toHaveBeenCalled();

    visibilityState = 'hidden';
    documentListeners.get('visibilitychange')?.();
    expect(flush).toHaveBeenCalledTimes(1);

    listeners.get('pagehide')?.();
    expect(flush).toHaveBeenCalledTimes(2);

    detach();
    expect(listeners.size).toBe(0);
    expect(documentListeners.size).toBe(0);
  });
});
