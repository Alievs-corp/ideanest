import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentAccessToken, setAccessToken } from '../api/access-token';
import {
  completeTwoFactor,
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  startTwoFactorEnrolment,
} from './twoFactor';

/**
 * §4.1's A-07 and A-08 — issues #272 and #278.
 *
 * WHAT THESE COVER:
 *
 *   - **exactly one credential is sent.** `TwoFactorProof` is a union so a caller cannot send
 *     a generated code and a recovery code together, and these assert the wire shape rather
 *     than only the type — the service would otherwise be asked to decide which of two
 *     credentials somebody meant to spend.
 *   - completing a challenge writes the access token, which is what makes the browser signed
 *     in. A 200 with no token is refused rather than believed.
 *   - the enrolment endpoints go out with a bearer token and the challenge does not, because
 *     the caller of the challenge has no session yet — that split is the whole reason
 *     `TwoFactorController` has four endpoints rather than two.
 */

const originalFetch = globalThis.fetch;

function respondWith(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const send = vi.fn(
    async () =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', send);
  return send;
}

function bodyOf(send: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const [, init] = send.mock.calls[call] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  setAccessToken('an-existing-token');
});

afterEach(() => {
  setAccessToken(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('completeTwoFactor', () => {
  it('sends the code alone and adopts the token it gets back', async () => {
    setAccessToken(null);
    const send = respondWith({ accessToken: 'the-new-token' });

    await completeTwoFactor('the-challenge', { kind: 'code', code: '123456' });

    expect(bodyOf(send)).toEqual({ challenge: 'the-challenge', code: '123456' });
    expect(currentAccessToken()).toBe('the-new-token');
  });

  it('sends the recovery code alone', async () => {
    const send = respondWith({ accessToken: 'x' });

    await completeTwoFactor('c', { kind: 'recovery-code', recoveryCode: 'abcd-efgh' });

    const body = bodyOf(send);
    expect(body).toEqual({ challenge: 'c', recoveryCode: 'abcd-efgh' });
    expect(body).not.toHaveProperty('code');
  });

  it('refuses a 200 that carries no token rather than believing it', async () => {
    setAccessToken(null);
    respondWith({});

    await expect(completeTwoFactor('c', { kind: 'code', code: '1' })).rejects.toThrow(
      /no access token/iu,
    );
    // Nothing was written: a browser that believed it was signed in would 401 on every read.
    expect(currentAccessToken()).toBeNull();
  });

  it('throws the service’s refusal with its status intact', async () => {
    respondWith({ title: 'That code is not valid' }, 401);

    await expect(completeTwoFactor('c', { kind: 'code', code: '000000' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('the enrolment endpoints', () => {
  it('starts an enrolment with the password and returns the secret once', async () => {
    const send = respondWith({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/IdeyaNest:aysel',
      digits: 6,
      periodSeconds: 30,
      algorithm: 'SHA1',
    });

    const enrolment = await startTwoFactorEnrolment('correct horse');

    expect(bodyOf(send)).toEqual({ password: 'correct horse' });
    expect(enrolment.secret).toBe('JBSWY3DPEHPK3PXP');

    const [path, init] = send.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/auth/2fa/enable');
    // Authenticated: turning a security control on is not something an anonymous caller does.
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer an-existing-token');
  });

  it('returns the recovery codes from a confirmation, and an empty list rather than undefined', async () => {
    respondWith({ recoveryCodes: ['aaa', 'bbb'] });
    expect(await confirmTwoFactorEnrolment('123456')).toEqual(['aaa', 'bbb']);

    respondWith({});
    expect(await confirmTwoFactorEnrolment('123456')).toEqual([]);
  });

  it('disables with the password and exactly one proof', async () => {
    const send = respondWith(null, 204);

    await disableTwoFactor('correct horse', { kind: 'recovery-code', recoveryCode: 'zzz' });

    expect(bodyOf(send)).toEqual({ password: 'correct horse', recoveryCode: 'zzz' });
  });
});
