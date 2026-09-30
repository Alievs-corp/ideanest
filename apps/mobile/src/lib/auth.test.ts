import * as SecureStore from 'expo-secure-store';
import { refreshAccessToken, signIn, signOut, verifyTwoFactor } from './auth';
import {
  currentAccessToken,
  enableLock,
  hasStoredSession,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from './session';
import { memoryStore } from './storage';

/**
 * Signing in and refreshing — §17.1.
 *
 * <p>The assertion this file exists for is
 * {@link concurrentRefreshesMakeOneRequest}. §17.1 revokes a whole session
 * family when a rotated refresh token is presented twice, and a phone resuming
 * with six stale queries is the situation that produces it. Everything else here
 * is the surrounding contract: that the second factor is reported rather than
 * mistaken for a sign-in, that a 401 on refresh ends the session and a dismissed
 * prompt does not, and that signing out clears the device even when the service
 * cannot be reached.
 */

const keychain = SecureStore as unknown as {
  __setBiometryAllowed: (allowed: boolean) => void;
  __reset: () => void;
};

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
});

describe('signing in', () => {
  it('asks for the token in the body, and keeps each half where it belongs', async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'access-1', refreshToken: 'refresh-1' }));

    const outcome = await signIn('backer@example.com', 'correct horse');

    expect(outcome).toEqual({ kind: 'signed-in' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/auth/login');
    // §17.1: a native client has no cookie jar worth using, and the service defines this
    // shape for exactly this caller.
    expect(bodyOf(0).tokenDelivery).toBe('body');
    expect(currentAccessToken()).toBe('access-1');
    expect(hasStoredSession()).toBe(true);
  });

  it('reports the second factor rather than treating a challenge as a session', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ twoFactorRequired: true, challenge: 'chal-1', expiresInSeconds: 300 }),
    );

    const outcome = await signIn('backer@example.com', 'correct horse');

    expect(outcome).toEqual({ kind: 'two-factor', challenge: 'chal-1', expiresInSeconds: 300 });
    // Nothing was adopted. A client that ignored the flag would have stored
    // `undefined` and believed itself signed in.
    expect(currentAccessToken()).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });

  it('finishes with the code, and sends the delivery again', async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'access-2', refreshToken: 'refresh-2' }));

    await verifyTwoFactor('chal-1', '123456');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/auth/2fa/verify');
    expect(bodyOf(0)).toMatchObject({ challenge: 'chal-1', code: '123456', tokenDelivery: 'body' });
    expect(currentAccessToken()).toBe('access-2');
  });

  it('throws the refusal, so a screen can say which one it was', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'AUTHENTICATION_FAILED' }), {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    await expect(signIn('backer@example.com', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(hasStoredSession()).toBe(false);
  });
});

describe('refreshing', () => {
  it('makes one request no matter how many callers ask at once', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'access-9', refreshToken: 'refresh-9' }));

    /*
     * §17.1 TREATS A REPLAYED REFRESH TOKEN AS THEFT AND REVOKES THE FAMILY.
     * Twenty is not a stress test — it is what a phone does when it is unlocked
     * and every persisted query refetches in the same tick.
     */
    const results = await Promise.all(
      Array.from({ length: 20 }, () => refreshAccessToken()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(['access-9']));
  });

  it('starts a new request once the first has settled', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'access-1', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json({ accessToken: 'access-2', refreshToken: 'refresh-3' }));

    expect(await refreshAccessToken()).toBe('access-1');
    expect(await refreshAccessToken()).toBe('access-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The rotated token, not the original: a client that re-sent the first one
    // would be the thing §17.1 revokes for.
    expect(bodyOf(1).refreshToken).toBe('refresh-2');
  });

  it('ends the session when the service refuses the token', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    expect(await refreshAccessToken()).toBeNull();

    // The family is already revoked service-side; keeping the local half would
    // mean every later request carrying a credential that can only fail.
    expect(hasStoredSession()).toBe(false);
    expect(currentAccessToken()).toBeNull();
  });

  it('keeps the session when the biometric prompt is dismissed', async () => {
    await storeRefreshToken('refresh-1');
    await enableLock();
    keychain.__setBiometryAllowed(false);

    expect(await refreshAccessToken()).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasStoredSession()).toBe(true);
  });

  it('keeps the session when the network fails', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(refreshAccessToken()).rejects.toBeInstanceOf(TypeError);

    // A network fault is not a revoked session, and the next attempt can work.
    expect(hasStoredSession()).toBe(true);
  });
});

describe('signing out', () => {
  it('clears the device even when the service cannot be told', async () => {
    await storeRefreshToken('refresh-1');
    rememberAccessToken('access-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await signOut();

    expect(hasStoredSession()).toBe(false);
    expect(currentAccessToken()).toBeNull();
  });

  it('revokes the session on the service too', async () => {
    await storeRefreshToken('refresh-1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await signOut();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/v1/auth/logout');
    expect(bodyOf(0).refreshToken).toBe('refresh-1');
  });

  it('drops the push registration first, while it still has a bearer to do it with', async () => {
    await storeRefreshToken('refresh-1');
    rememberAccessToken('access-1');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await signOut();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test.invalid/v1/me/devices');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-1');
    expect(bodyOf(0).token).toBe('ExponentPushToken[test]');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.test.invalid/v1/auth/logout');
  });
});
