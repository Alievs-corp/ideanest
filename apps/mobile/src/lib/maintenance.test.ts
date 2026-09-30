import { ApiError } from '@ideanest/api-client';
import { MAINTENANCE_PROBLEM_TYPE, type Maintenance } from '@ideanest/api-client/maintenance';
import { api } from '../api/client';
import { setOnline } from './connectivity';
import {
  MAX_FIRST_POLL_MS,
  MIN_FIRST_POLL_MS,
  POLL_INTERVAL_MS,
  createPoller,
  currentMaintenance,
  deferUntilUp,
  enterMaintenance,
  firstPollDelayMs,
  inMaintenance,
  leaveMaintenance,
  observeResponse,
  pollDelayMs,
  serviceAnswers,
  subscribeToMaintenance,
  takeDeferred,
} from './maintenance';
import {
  hasStoredSession,
  rememberAccessToken,
  storeRefreshToken,
  storedRefreshToken,
  useFlagStore,
} from './session';
import { memoryStore } from './storage';
import { useUpcomingStore, visibleUpcoming } from './upcoming-maintenance';

/**
 * The maintenance trigger — issues #150 and #214: only the maintenance problem is maintenance,
 * wherever it is met (a read or the refresh in front of it); a bare 503 and every other 5xx are
 * ordinary failures; `Retry-After` sets the first wait within limits; maintenance never signs
 * anybody out; and the poll asks `/v1/status` and lets go when it says `operational`.
 */

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();

const API_BODY = {
  type: MAINTENANCE_PROBLEM_TYPE,
  title: 'Scheduled maintenance',
  status: 503,
  startsAt: '2026-10-04T22:00:00Z',
  endsAt: '2026-10-04T22:30:00Z',
  source: 'api',
};

const EDGE_BODY = { ...API_BODY, startsAt: null, endsAt: null, source: 'edge' };

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers });
}

function problem(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

function json(body: unknown, code = 200): Response {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

const EDGE: Maintenance = { startsAt: null, endsAt: null, source: 'edge', retryAfterSeconds: 120 };
const API: Maintenance = {
  startsAt: API_BODY.startsAt,
  endsAt: API_BODY.endsAt,
  source: 'api',
  retryAfterSeconds: 1200,
};

beforeEach(async () => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  useFlagStore(memoryStore());
  useUpcomingStore(memoryStore());
  await storeRefreshToken(null);
  rememberAccessToken(null);
  setOnline(true);
  leaveMaintenance();
  takeDeferred();
});

describe('the first wait', () => {
  it('is Retry-After, clamped to five seconds at least and five minutes at most', () => {
    expect(MIN_FIRST_POLL_MS).toBe(5_000);
    expect(MAX_FIRST_POLL_MS).toBe(300_000);
    expect(pollDelayMs(120)).toBe(120_000);
    expect(pollDelayMs(0)).toBe(MIN_FIRST_POLL_MS);
    expect(pollDelayMs(3600)).toBe(MAX_FIRST_POLL_MS);
    expect(pollDelayMs(Number.NaN)).toBe(POLL_INTERVAL_MS);
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });

  it('is thirty seconds with nothing to wait for', () => {
    expect(firstPollDelayMs()).toBe(POLL_INTERVAL_MS);
  });
});

describe('the trigger', () => {
  it('the maintenance problem is maintenance, and the first wait is its Retry-After', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMaintenance(listener);

    const response = problem(API_BODY, { 'Retry-After': '90' });
    await expect(observeResponse(response)).resolves.toBe(response);

    expect(inMaintenance()).toBe(true);
    expect(currentMaintenance()).toEqual({ ...API, retryAfterSeconds: 90 });
    expect(firstPollDelayMs()).toBe(90_000);
    expect(listener).toHaveBeenCalledTimes(1);
    // Handed on unread: the caller still parses its own ApiError from it.
    expect(response.bodyUsed).toBe(false);

    // Every request on the screen fails at once; one screen is shown.
    await observeResponse(problem(API_BODY, { 'Retry-After': '90' }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('the edge is maintenance too, with its own source', async () => {
    await observeResponse(problem(EDGE_BODY, { 'Retry-After': '120' }));
    expect(currentMaintenance()).toEqual(EDGE);
    expect(firstPollDelayMs()).toBe(120_000);
  });

  it('a plain 503 is not maintenance: it is an ordinary failure', async () => {
    await observeResponse(status(503, { 'Retry-After': '30' }));
    await observeResponse(
      new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } }),
    );
    await observeResponse(json({ type: 'https://ideanest.az/problems/other', status: 503 }, 503));
    expect(inMaintenance()).toBe(false);
  });

  it.each([200, 400, 401, 404, 429, 500, 502, 504])(
    'a %i is not maintenance, even with the maintenance body',
    async (code) => {
      await observeResponse(json(API_BODY, code));
      expect(inMaintenance()).toBe(false);
    },
  );

  it('the maintenance problem is believed while the phone thinks it is offline', async () => {
    // A captive portal can send a 503; it cannot send this body.
    setOnline(false);
    await observeResponse(problem(API_BODY));
    expect(inMaintenance()).toBe(true);
  });

  it('through the API client: the caller still gets its ApiError, and maintenance begins', async () => {
    fetchMock.mockResolvedValueOnce(problem(API_BODY, { 'Retry-After': '15' }));

    const failure = await api()
      .get('/v1/discover')
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(503);
    expect((failure as ApiError).problem?.type).toBe(MAINTENANCE_PROBLEM_TYPE);
    expect(inMaintenance()).toBe(true);
    expect(firstPollDelayMs()).toBe(15_000);
  });

  it('through the API client: a bare 503 is an ordinary error, and the screen stays shut', async () => {
    fetchMock.mockResolvedValueOnce(status(503, { 'Retry-After': '15' }));
    const failure = await api()
      .get('/v1/discover')
      .catch((cause: unknown) => cause);
    expect((failure as ApiError).status).toBe(503);
    expect(inMaintenance()).toBe(false);
  });

  it('through the API client: any other failure leaves it alone', async () => {
    fetchMock.mockResolvedValueOnce(status(500));
    await expect(api().get('/v1/discover')).rejects.toBeInstanceOf(ApiError);
    expect(inMaintenance()).toBe(false);
  });

  it('a cold start signed in: the refresh meets the problem first, and the session survives it', async () => {
    // The read refreshes before it is sent, so during a window the refresh is the request that
    // sees the problem — and it throws before any read reaches `sessionFetch`'s own check.
    await storeRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(problem(API_BODY, { 'Retry-After': '20' }));

    await expect(api().get('/v1/me/saved')).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/auth/refresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inMaintenance()).toBe(true);
    expect(firstPollDelayMs()).toBe(20_000);
    // Maintenance is not a revoked session: nobody is signed out by it.
    expect(hasStoredSession()).toBe(true);
    await expect(storedRefreshToken()).resolves.toBe('refresh-1');
  });
});

describe('links during maintenance', () => {
  it('are held until the service is back, and only the latest', () => {
    const first = jest.fn();
    const second = jest.fn();

    expect(deferUntilUp(first)).toBe(false);

    enterMaintenance(EDGE);
    expect(deferUntilUp(first)).toBe(true);
    expect(deferUntilUp(second)).toBe(true);

    expect(takeDeferred()).toBe(second);
    expect(takeDeferred()).toBeNull();
  });
});

describe('serviceAnswers', () => {
  const NOW = Date.parse('2026-10-04T22:10:00Z');

  it('asks /v1/status with no session on it, and never from a cache', async () => {
    rememberAccessToken('secret');
    fetchMock.mockResolvedValueOnce(json({ state: 'operational', maintenance: null, upcoming: null }));

    await expect(serviceAnswers(NOW)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test.invalid/v1/status');
    expect(init?.cache).toBe('no-store');
    const headers = new Headers(init?.headers);
    expect(headers.get('Cache-Control')).toBe('no-cache');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('"maintenance" is "not yet", and a later end changes what the screen says', async () => {
    enterMaintenance(API);
    fetchMock.mockResolvedValueOnce(
      json({
        state: 'maintenance',
        maintenance: { startsAt: API_BODY.startsAt, endsAt: '2026-10-04T23:00:00Z' },
        upcoming: null,
      }),
    );

    await expect(serviceAnswers(NOW)).resolves.toBe(false);
    expect(currentMaintenance()).toMatchObject({ source: 'api', endsAt: '2026-10-04T23:00:00Z' });
  });

  it('the edge answering the poll is "not yet", and the screen takes its wording', async () => {
    enterMaintenance(API);
    fetchMock.mockResolvedValueOnce(problem(EDGE_BODY, { 'Retry-After': '120' }));

    await expect(serviceAnswers(NOW)).resolves.toBe(false);
    expect(currentMaintenance()?.source).toBe('edge');
  });

  it.each([500, 502, 503, 504])('a %i without the problem is "not yet"', async (code) => {
    fetchMock.mockResolvedValueOnce(status(code));
    await expect(serviceAnswers(NOW)).resolves.toBe(false);
  });

  it('no answer at all is "not yet"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(serviceAnswers(NOW)).resolves.toBe(false);
  });

  it.each([404, 429])('a %i is the service answering', async (code) => {
    fetchMock.mockResolvedValueOnce(status(code));
    await expect(serviceAnswers(NOW)).resolves.toBe(true);
  });

  it('"operational" is back, and the next announced window is passed to the banner', async () => {
    const upcoming = { startsAt: '2026-10-11T22:00:00Z', endsAt: '2026-10-11T22:30:00Z' };
    fetchMock.mockResolvedValueOnce(json({ state: 'operational', maintenance: null, upcoming }));

    await expect(serviceAnswers(NOW)).resolves.toBe(true);
    expect(visibleUpcoming(NOW)).toEqual(upcoming);
  });
});

describe('the poller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits the first delay, then every thirty seconds, until the service answers', async () => {
    const check = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const recovered = jest.fn();
    const poller = createPoller(check, recovered);

    poller.start(5_000);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(check).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(recovered).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(3);
    expect(recovered).toHaveBeenCalledTimes(1);

    // Recovered: it has let go.
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('stops, and start(0) asks now', async () => {
    const check = jest.fn<Promise<boolean>, []>().mockResolvedValue(false);
    const poller = createPoller(check, jest.fn());

    poller.start(POLL_INTERVAL_MS);
    poller.stop();
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(check).not.toHaveBeenCalled();

    poller.start(0);
    await jest.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('a check that lands after stop does nothing', async () => {
    let answer: (up: boolean) => void = () => {};
    const check = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const recovered = jest.fn();
    const poller = createPoller(check, recovered);

    poller.start(0);
    await jest.advanceTimersByTimeAsync(0);
    poller.stop();
    answer(true);
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(recovered).not.toHaveBeenCalled();
  });
});
