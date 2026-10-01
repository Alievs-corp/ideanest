import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '@ideanest/api-client';
import {
  ADDRESS_PATTERN,
  looksLikeAnAddress,
  noPrelaunchPage,
  prelaunchFailure,
  prelaunchReadFailure,
  remindersClosed,
  remindMe,
} from './prelaunch';

/**
 * The pre-launch page's rules — issue #155: the web's address check (read from the web's own
 * source, so the two cannot part), the failure wording, and the one write as it goes on the wire.
 */

const WEB_VIEW = join(__dirname, '../../../web/src/components/prelaunch/PrelaunchView.tsx');

describe('looksLikeAnAddress', () => {
  it('is the web rule, character for character', () => {
    const source = readFileSync(WEB_VIEW, 'utf8');
    const body = /function looksLikeAnAddress\([^)]*\)[^{]*\{([\s\S]*?)\n\}/u.exec(source)?.[1];
    expect(body).toBeDefined();
    const pattern = /return (\/.+\/[a-z]*)\.test\(value\.trim\(\)\);/u.exec(body ?? '')?.[1];
    // The web trims and tests the same literal; a change on either side fails here.
    expect(pattern).toBe(String(ADDRESS_PATTERN));
  });

  it.each([
    ['you@example.com', true],
    ['  you@example.com  ', true],
    ['a@b.co', true],
    ['first.last+tag@sub.example.az', true],
    ['', false],
    ['you', false],
    ['you@', false],
    ['you@example', false],
    ['@example.com', false],
    ['you@@example.com', false],
    ['you @example.com', false],
    ['you@example.', false],
  ])('answers %j with %s', (value, expected) => {
    expect(looksLikeAnAddress(value)).toBe(expected);
  });
});

const GUEST = { signedIn: false };
const ACCOUNT = { signedIn: true };

describe('prelaunchFailure', () => {
  it('rounds the wait up to whole minutes on a 429', () => {
    const limited = new ApiError(429, { status: 429, retryAfterSeconds: 150 });
    expect(prelaunchFailure(limited, GUEST)).toEqual({ key: 'rateLimitedIn', minutes: 3 });
    expect(prelaunchFailure(new ApiError(429, { retryAfterSeconds: 60 }), GUEST)).toEqual({
      key: 'rateLimitedIn',
      minutes: 1,
    });
    expect(prelaunchFailure(new ApiError(429, { retryAfterSeconds: 1 }), GUEST)).toEqual({
      key: 'rateLimitedIn',
      minutes: 1,
    });
  });

  it('says only that it is rate limited when the service gave no figure', () => {
    expect(prelaunchFailure(new ApiError(429, null), GUEST)).toEqual({ key: 'rateLimited' });
    expect(prelaunchFailure(new ApiError(429, { title: 'Too many' }), GUEST)).toEqual({
      key: 'rateLimited',
    });
  });

  it('answers any other refusal with the catalogue sentence, not the service prose', () => {
    expect(prelaunchFailure(new ApiError(500, { detail: 'Boom' }), GUEST)).toEqual({ key: 'notSaved' });
    expect(prelaunchFailure(new ApiError(400, { code: 'VALIDATION_FAILED' }), GUEST)).toEqual({
      key: 'notSaved',
    });
  });

  it('answers no response at all as unreachable', () => {
    expect(prelaunchFailure(new TypeError('Network request failed'), GUEST)).toEqual({
      key: 'unreachable',
    });
  });

  it('asks for a new sign-in on a 401, and on a 400 to an account request', () => {
    // A 400 to `{}` is the service refusing a guest request with no address: the bearer was lost.
    expect(prelaunchFailure(new ApiError(401, null), GUEST)).toEqual({ key: 'sessionExpired' });
    expect(prelaunchFailure(new ApiError(401, null), ACCOUNT)).toEqual({ key: 'sessionExpired' });
    expect(prelaunchFailure(new ApiError(400, null), ACCOUNT)).toEqual({ key: 'sessionExpired' });
    // A guest's 400 is about the address they typed, not about a session they never had.
    expect(prelaunchFailure(new ApiError(400, null), GUEST)).toEqual({ key: 'notSaved' });
  });
});

describe('prelaunchReadFailure', () => {
  it('reads a refusal as the web does: the service’s detail, then its title, then nothing', () => {
    expect(
      prelaunchReadFailure(new ApiError(500, { detail: 'Rebuilding.', title: 'Server error' })),
    ).toEqual({ key: 'detail', text: 'Rebuilding.' });
    expect(prelaunchReadFailure(new ApiError(500, { title: 'Server error' }))).toEqual({
      key: 'detail',
      text: 'Server error',
    });
    expect(prelaunchReadFailure(new ApiError(502, null))).toEqual({ key: 'none' });
    expect(prelaunchReadFailure(new ApiError(500, { detail: '  ' }))).toEqual({ key: 'none' });
  });

  it('never says a read could not be saved', () => {
    for (const status of [400, 401, 403, 500, 503]) {
      expect(prelaunchReadFailure(new ApiError(status, null)).key).not.toBe('notSaved');
    }
  });

  it('keeps the rate limit and the unreachable sentence', () => {
    expect(prelaunchReadFailure(new ApiError(429, { retryAfterSeconds: 90 }))).toEqual({
      key: 'rateLimitedIn',
      minutes: 2,
    });
    expect(prelaunchReadFailure(new ApiError(429, null))).toEqual({ key: 'rateLimited' });
    expect(prelaunchReadFailure(new TypeError('offline'))).toEqual({ key: 'unreachable' });
  });
});

describe('the refusals the screen changes state on', () => {
  it('reads REMINDERS_CLOSED from the code, never the words', () => {
    expect(remindersClosed(new ApiError(409, { code: 'REMINDERS_CLOSED' }))).toBe(true);
    expect(remindersClosed(new ApiError(409, { detail: 'REMINDERS_CLOSED' }))).toBe(false);
    expect(remindersClosed(new TypeError('offline'))).toBe(false);
  });

  it('reads a 404 as no pre-launch page', () => {
    expect(noPrelaunchPage(new ApiError(404, null))).toBe(true);
    expect(noPrelaunchPage(new ApiError(410, null))).toBe(false);
    expect(noPrelaunchPage(null)).toBe(false);
  });
});

describe('remindMe', () => {
  const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  let calls: { url: string; init: RequestInit | undefined }[];

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ following: true, followerCount: 13 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  it('sends the guest address, and answers the new count', async () => {
    await expect(remindMe(ID, 'you@example.com')).resolves.toEqual({ followerCount: 13 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.test.invalid/v1/projects/${ID}/remind`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: 'you@example.com' });
  });

  it('sends an empty body for an account', async () => {
    await remindMe(ID, null);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({});
  });

  it('keeps no count it was not given', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(remindMe(ID, null)).resolves.toEqual({ followerCount: null });
  });

  it('throws the shared ApiError, with Retry-After read into the problem', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ status: 429, code: 'RATE_LIMITED' }), {
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'Retry-After': '150' },
        }),
    ) as unknown as typeof fetch;
    const failure = await remindMe(ID, null).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect(prelaunchFailure(failure, GUEST)).toEqual({ key: 'rateLimitedIn', minutes: 3 });
  });
});
