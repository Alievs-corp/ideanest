import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { rememberTrace, resetLastTrace } from '../../api/last-trace';
import {
  identifyForCrashReports,
  reportBoundaryError,
  resetCrashReporting,
  startCrashReporting,
} from './reporting';
import { MASK } from './scrub';

const DSN = 'https://public@o1.ingest.de.sentry.io/2';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const extra = Constants.expoConfig?.extra as Record<string, unknown>;

function respond(traceId: string): void {
  rememberTrace(new Response(null, { status: 200, headers: { 'X-Trace-Id': traceId } }));
}

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

function initOptions(): InitOptions {
  const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
  if (options === undefined) throw new Error('Sentry.init was not called');
  return options;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCrashReporting();
  resetLastTrace();
  delete extra.sentryDsn;
  delete extra.sentryEnvironment;
});

afterAll(() => {
  delete extra.sentryDsn;
  delete extra.sentryEnvironment;
});

describe('a build without IDEANEST_SENTRY_DSN', () => {
  it('never starts the SDK, and sends nothing', () => {
    startCrashReporting();
    identifyForCrashReports('c0ffee00-1234-4abc-9def-001122334455');
    reportBoundaryError(new Error('boom'), 'route', null);
    respond(TRACE_ID);

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });
});

describe('a build with a DSN', () => {
  beforeEach(() => {
    extra.sentryDsn = DSN;
    extra.sentryEnvironment = 'production';
  });

  it('starts once, named by version, build, platform and channel, with replay off', () => {
    startCrashReporting();
    startCrashReporting();

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(initOptions()).toMatchObject({
      dsn: DSN,
      environment: 'production',
      release: '1.2.3+45',
      dist: Platform.OS,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
    });
  });

  it('turns off the native SDK’s network breadcrumbs, which never pass through the scrubber', () => {
    startCrashReporting();
    expect(initOptions()).toMatchObject({ enableNetworkBreadcrumbs: false });
  });

  it('samples no traces outside production', () => {
    extra.sentryEnvironment = 'preview';
    startCrashReporting();
    expect(initOptions()).toMatchObject({ environment: 'preview', tracesSampleRate: 0 });
  });

  it('tags an event with the last trace id the service answered with, and scrubs it', async () => {
    startCrashReporting();
    respond(TRACE_ID);

    const sent = await initOptions().beforeSend?.(
      {
        type: undefined,
        message: 'failed for aysel@example.az',
        request: { headers: { Authorization: 'Bearer abcdefghijkl' } },
      },
      {},
    );

    expect(sent?.tags).toEqual({ api_trace_id: TRACE_ID });
    expect(sent?.message).toBe(`failed for ${MASK}`);
    expect(sent?.request?.headers).toEqual({ Authorization: MASK });
  });

  it("copies each new trace id onto the scope, for a native crash's sake", () => {
    respond('11111111111111111111111111111111');
    startCrashReporting();
    respond(TRACE_ID);

    expect(Sentry.setTag).toHaveBeenNthCalledWith(1, 'api_trace_id', '11111111111111111111111111111111');
    expect(Sentry.setTag).toHaveBeenNthCalledWith(2, 'api_trace_id', TRACE_ID);
  });

  it('names the account by its id alone, and nobody after sign-out', () => {
    startCrashReporting();
    identifyForCrashReports('c0ffee00-1234-4abc-9def-001122334455');
    identifyForCrashReports(null);

    expect(Sentry.setUser).toHaveBeenNthCalledWith(1, { id: 'c0ffee00-1234-4abc-9def-001122334455' });
    expect(Sentry.setUser).toHaveBeenNthCalledWith(2, null);
  });

  it("reports a boundary's error with the trace id of the response it came from", () => {
    startCrashReporting();
    const error = new Error('boom');
    reportBoundaryError(error, 'route', TRACE_ID);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: 'route', api_trace_id: TRACE_ID },
    });
  });
});
