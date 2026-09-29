import { ApiError } from '@ideanest/api-client';
import { badgeText, fetchMe, sessionStateOf, type Me } from './account';

const me = { id: 'a', name: 'Aysel' } as Me;

describe('sessionStateOf', () => {
  it('is signed out with no token, whatever the cache holds', () => {
    expect(sessionStateOf({ hasToken: false, me })).toBe('signed-out');
  });

  it('is unknown while the account has not been read or the read failed', () => {
    expect(sessionStateOf({ hasToken: true, me: undefined })).toBe('unknown');
  });

  it('is signed out when the service says nobody is there', () => {
    expect(sessionStateOf({ hasToken: true, me: null })).toBe('signed-out');
  });

  it('is signed in when the account came back', () => {
    expect(sessionStateOf({ hasToken: true, me })).toBe('signed-in');
  });
});

describe('badgeText', () => {
  it('draws nothing at zero, the number below 100 and 99+ above', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('fetchMe', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function answer(status: number, body: unknown = {}): void {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
  }

  it('turns 401 and 404 into "nobody" and lets a 500 through', async () => {
    answer(401);
    await expect(fetchMe()).resolves.toBeNull();
    answer(404);
    await expect(fetchMe()).resolves.toBeNull();
    answer(500);
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError);
  });
});
