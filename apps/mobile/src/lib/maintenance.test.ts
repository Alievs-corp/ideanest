import { ApiError } from '@ideanest/api-client';
import { api } from '../api/client';
import { setOnline } from './connectivity';
import {
  MAX_FIRST_POLL_MS,
  MIN_FIRST_POLL_MS,
  POLL_INTERVAL_MS,
  createPoller,
  deferUntilUp,
  firstPollDelayMs,
  inMaintenance,
  leaveMaintenance,
  observeResponse,
  retryAfterMs,
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

/**
 * The maintenance trigger — issue #150: a 503 is maintenance wherever it is met (a read or the
 * refresh in front of it), `Retry-After` sets the first wait within limits, nothing else trips
 * it, an outage never signs anybody out, and the poller lets go the moment the service answers.
 */

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers });
}

beforeEach(async () => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  useFlagStore(memoryStore());
  await storeRefreshToken(null);
  rememberAccessToken(null);
  setOnline(true);
  leaveMaintenance();
  takeDeferred();
});

describe('Retry-After', () => {
  const NOW = Date.parse('Wed, 30 Sep 2026 12:00:00 GMT');

  it('reads delay-seconds', () => {
    expect(retryAfterMs('120', NOW)).toBe(120_000);
    expect(retryAfterMs(' 45 ', NOW)).toBe(45_000);
  });

  it('reads an HTTP-date', () => {
    expect(retryAfterMs('Wed, 30 Sep 2026 12:02:00 GMT', NOW)).toBe(120_000);
  });

  it('is clamped to five seconds at least and five minutes at most', () => {
    expect(MIN_FIRST_POLL_MS).toBe(5_000);
    expect(MAX_FIRST_POLL_MS).toBe(300_000);
    expect(retryAfterMs('0', NOW)).toBe(MIN_FIRST_POLL_MS);
    expect(retryAfterMs('2', NOW)).toBe(MIN_FIRST_POLL_MS);
    // A date already past means "now", which is five seconds from the 503 still on screen.
    expect(retryAfterMs('Wed, 30 Sep 2026 11:00:00 GMT', NOW)).toBe(MIN_FIRST_POLL_MS);
    expect(retryAfterMs('3600', NOW)).toBe(MAX_FIRST_POLL_MS);
    expect(retryAfterMs('Thu, 01 Oct 2026 12:00:00 GMT', NOW)).toBe(MAX_FIRST_POLL_MS);
  });

  it('falls back to thirty seconds when absent or unreadable', () => {
    expect(retryAfterMs(null, NOW)).toBe(POLL_INTERVAL_MS);
    expect(retryAfterMs('', NOW)).toBe(POLL_INTERVAL_MS);
    expect(retryAfterMs('soon', NOW)).toBe(POLL_INTERVAL_MS);
    expect(retryAfterMs('-5', NOW)).toBe(POLL_INTERVAL_MS);
    expect(retryAfterMs('1.5', NOW)).toBe(POLL_INTERVAL_MS);
    expect(retryAfterMs('Xyz, not a date', NOW)).toBe(POLL_INTERVAL_MS);
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });
});

describe('the trigger', () => {
  it('a 503 is maintenance, and the first wait is what the edge asked for', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMaintenance(listener);

    observeResponse(status(503, { 'Retry-After': '90' }));

    expect(inMaintenance()).toBe(true);
    expect(firstPollDelayMs()).toBe(90_000);
    expect(listener).toHaveBeenCalledTimes(1);

    // Every request on the screen fails at once; one screen is shown.
    observeResponse(status(503));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(firstPollDelayMs()).toBe(90_000);
    unsubscribe();
  });

  it('a 503 without Retry-After waits thirty seconds', () => {
    observeResponse(status(503));
    expect(firstPollDelayMs()).toBe(POLL_INTERVAL_MS);
  });

  it.each([200, 400, 401, 404, 429, 500, 502, 504])('a %i is not maintenance', (code) => {
    observeResponse(status(code, { 'Retry-After': '10' }));
    expect(inMaintenance()).toBe(false);
  });

  it('a 503 while offline is not maintenance: it is a captive portal talking', () => {
    setOnline(false);
    observeResponse(status(503));
    expect(inMaintenance()).toBe(false);
  });

  it('through the API client: the caller still gets its ApiError, and maintenance begins', async () => {
    fetchMock.mockResolvedValueOnce(status(503, { 'Retry-After': '15' }));

    const failure = await api()
      .get('/v1/discover')
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(503);
    expect(inMaintenance()).toBe(true);
    expect(firstPollDelayMs()).toBe(15_000);
  });

  it('through the API client: any other failure leaves it alone', async () => {
    fetchMock.mockResolvedValueOnce(status(500));
    await expect(api().get('/v1/discover')).rejects.toBeInstanceOf(ApiError);
    expect(inMaintenance()).toBe(false);
  });

  it('a cold start signed in: the refresh meets the 503 first, and the session survives it', async () => {
    // The read refreshes before it is sent, so during an outage the refresh is the request
    // that sees the 503 — and it throws before any read reaches `sessionFetch`'s own check.
    await storeRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(status(503, { 'Retry-After': '20' }));

    await expect(api().get('/v1/me/saved')).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/auth/refresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inMaintenance()).toBe(true);
    expect(firstPollDelayMs()).toBe(20_000);
    // An outage is not a revoked session: nobody is signed out by maintenance.
    expect(hasStoredSession()).toBe(true);
    await expect(storedRefreshToken()).resolves.toBe('refresh-1');
  });
});

describe('links during maintenance', () => {
  it('are held until the service is back, and only the latest', () => {
    const first = jest.fn();
    const second = jest.fn();

    expect(deferUntilUp(first)).toBe(false);

    observeResponse(status(503));
    expect(deferUntilUp(first)).toBe(true);
    expect(deferUntilUp(second)).toBe(true);

    expect(takeDeferred()).toBe(second);
    expect(takeDeferred()).toBeNull();
  });
});

describe('serviceAnswers', () => {
  it('asks a public endpoint with no session on it, and never from a cache', async () => {
    rememberAccessToken('secret');
    fetchMock.mockResolvedValueOnce(status(200));

    await expect(serviceAnswers(1_234)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    // A query string no cache has seen: the service marks this `public, max-age=3600`.
    expect(url).toBe('https://api.test.invalid/v1/categories?_=1234');
    expect(init?.cache).toBe('no-store');
    const headers = new Headers(init?.headers);
    expect(headers.get('Cache-Control')).toBe('no-cache');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('a new query string every time', async () => {
    fetchMock.mockResolvedValue(status(503));
    await serviceAnswers(1);
    await serviceAnswers(2);
    expect(fetchMock.mock.calls[0]?.[0]).not.toBe(fetchMock.mock.calls[1]?.[0]);
  });

  it.each([502, 503, 504, 500])('a %i is "not yet"', async (code) => {
    fetchMock.mockResolvedValueOnce(status(code));
    await expect(serviceAnswers()).resolves.toBe(false);
  });

  it('no answer at all is "not yet"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(serviceAnswers()).resolves.toBe(false);
  });

  it.each([200, 304, 404, 429])('a %i is the service answering', async (code) => {
    fetchMock.mockResolvedValueOnce(status(code));
    await expect(serviceAnswers()).resolves.toBe(true);
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
