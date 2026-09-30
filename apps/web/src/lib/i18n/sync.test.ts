import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { currentLocaleCookie, writeLocaleCookie } from './cookie';
import { LOCALE_COOKIE } from './locale';
import {
  LOCALE_PENDING_COOKIE,
  LOCALE_SYNCED_COOKIE,
  pushLocale,
  readMarker,
  reconcileLocale,
  syncLocale,
} from './sync';

/**
 * The browser's language and the account's — issue #216.
 *
 * The rule is `apps/mobile`'s `reconcileLocale`, with one difference the web needs: the
 * switcher writes only the cookie and navigates, so a cookie that moved since the last sync is
 * itself the sign of a choice made here. The cases follow the issue's list.
 * `SessionProvider.locale.test.tsx` drives the same cases through the session read.
 */

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);

function cookies() {
  return {
    chosen: currentLocaleCookie(),
    synced: readMarker(LOCALE_SYNCED_COOKIE),
    pending: readMarker(LOCALE_PENDING_COOKIE),
  };
}

/** What a browser holds after syncing with an account that says `locale`. */
function syncedWith(locale: 'az' | 'en' | 'ru' | 'tr') {
  syncLocale({ locale });
  fetchMock.mockClear();
}

const patched = (locale: string) =>
  expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale }) });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  for (const name of [LOCALE_COOKIE, LOCALE_SYNCED_COOKIE, LOCALE_PENDING_COOKIE]) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
});

describe('reconcileLocale, the last-synced rule', () => {
  const rule = { account: 'ru', chosen: null, synced: null, pending: null } as const;

  it('a browser with no choice, or a first sign-in: the account wins', () => {
    expect(reconcileLocale(rule)).toEqual({ kind: 'apply', locale: 'ru' });
    expect(reconcileLocale({ ...rule, chosen: 'en' })).toEqual({ kind: 'apply', locale: 'ru' });
  });

  it('a choice made here since the last sync, account unchanged: this browser wins', () => {
    expect(reconcileLocale({ ...rule, chosen: 'tr', synced: 'ru' })).toEqual({
      kind: 'push',
      locale: 'tr',
    });
    expect(reconcileLocale({ ...rule, chosen: 'ru', synced: 'ru' })).toEqual({ kind: 'keep' });
  });

  it('the account changed on a phone: the account wins and replaces the choice here', () => {
    expect(reconcileLocale({ ...rule, account: 'en', chosen: 'tr', synced: 'tr' })).toEqual({
      kind: 'apply',
      locale: 'en',
    });
  });

  it('a pending choice is sent, not overridden, even by a change made elsewhere', () => {
    const pending = { account: 'en', chosen: 'ru', synced: 'az', pending: 'ru' } as const;
    expect(reconcileLocale(pending)).toEqual({ kind: 'push', locale: 'ru' });
    expect(reconcileLocale({ ...pending, account: 'ru' })).toEqual({ kind: 'apply', locale: 'ru' });
  });

  it('a pending mark the cookie no longer holds is stale', () => {
    expect(reconcileLocale({ account: 'tr', chosen: 'tr', synced: 'az', pending: 'ru' })).toEqual({
      kind: 'apply',
      locale: 'tr',
    });
  });

  it('an account value this client cannot draw changes nothing', () => {
    expect(reconcileLocale({ ...rule, account: 'de', chosen: 'tr', synced: 'tr' })).toEqual({
      kind: 'keep',
    });
    expect(reconcileLocale({ ...rule, account: undefined })).toEqual({ kind: 'keep' });
  });
});

describe('a session read', () => {
  it('fresh browser and sign-in: adopts the account language and records it', () => {
    syncLocale({ locale: 'ru' });

    expect(cookies()).toEqual({ chosen: 'ru', synced: 'ru', pending: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('after the header switch: sends PATCH /v1/me/locale, and the choice stays', async () => {
    syncedWith('az');
    writeLocaleCookie('ru'); // the switcher's click

    syncLocale({ locale: 'az' }); // the page the link opened

    expect(fetchMock).toHaveBeenCalledWith('/v1/me/locale', patched('ru'));
    expect(cookies()).toEqual({ chosen: 'ru', synced: 'az', pending: 'ru' });
    await vi.waitFor(() => expect(cookies()).toEqual({ chosen: 'ru', synced: 'ru', pending: null }));

    // The next read carries it: nothing to do.
    syncLocale({ locale: 'ru' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the account changed on a phone: the cookie follows it', () => {
    syncedWith('tr');

    syncLocale({ locale: 'en' });

    expect(cookies()).toEqual({ chosen: 'en', synced: 'en', pending: null });
  });

  it('a failed PATCH keeps the choice pending, and the next read sends it again', async () => {
    syncedWith('az');
    writeLocaleCookie('ru');
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(pushLocale('ru')).resolves.toBe(false);
    expect(cookies()).toEqual({ chosen: 'ru', synced: 'az', pending: 'ru' });

    // A phone changed the account meanwhile; the pending choice here is still the one sent.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    syncLocale({ locale: 'tr' });
    await vi.waitFor(() => expect(cookies()).toEqual({ chosen: 'ru', synced: 'ru', pending: null }));
    expect(fetchMock).toHaveBeenLastCalledWith('/v1/me/locale', patched('ru'));
  });

  it('a network failure is a failed PATCH, not a thrown one', async () => {
    syncedWith('az');
    writeLocaleCookie('tr');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(pushLocale('tr')).resolves.toBe(false);
    expect(cookies()).toEqual({ chosen: 'tr', synced: 'az', pending: 'tr' });
  });

  it('a save from Settings → Language is recorded by the next read without another PATCH', () => {
    syncedWith('az');
    writeLocaleCookie('tr'); // the panel writes the cookie only after the account accepted it

    syncLocale({ locale: 'tr' });

    expect(cookies()).toEqual({ chosen: 'tr', synced: 'tr', pending: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an account language this client cannot draw changes nothing', () => {
    syncedWith('tr');

    syncLocale({ locale: 'de' });

    expect(cookies()).toEqual({ chosen: 'tr', synced: 'tr', pending: null });
  });

  it('nobody signed in: the choice stays and the marks are forgotten', () => {
    syncedWith('ru');
    writeLocaleCookie('tr');
    document.cookie = `${LOCALE_PENDING_COOKIE}=tr; Path=/`;

    syncLocale(null);

    expect(cookies()).toEqual({ chosen: 'tr', synced: null, pending: null });
  });
});
