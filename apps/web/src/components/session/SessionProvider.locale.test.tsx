import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { authorizedFetch } from '../../lib/api/client';
import { fetchSession } from '../../lib/session/session';
import { currentLocaleCookie, writeLocaleCookie } from '../../lib/i18n/cookie';
import { LOCALE_COOKIE } from '../../lib/i18n/locale';
import { LOCALE_PENDING_COOKIE, LOCALE_SYNCED_COOKIE, readMarker } from '../../lib/i18n/sync';
import { SessionProvider, useSession } from './SessionProvider';

/**
 * The session read and this browser's language — issue #216, one case per rule.
 *
 * The latest explicit choice wins and is written to the account. The account's language is
 * applied to this browser's cookie only when the browser has no choice of its own, or when the
 * account changed elsewhere since this browser last synced it (`ideanest_locale_synced`). It
 * used to overwrite the cookie on every read, so the header's switch lasted one URL.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ authorizedFetch: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const sessionMock = vi.mocked(fetchSession);
const fetchMock = vi.mocked(authorizedFetch);

function account(locale: string) {
  return {
    id: 'ffa5a1e2-0000-7000-8000-000000000216',
    email: 'lang-216@example.com',
    name: 'Nigar',
    slug: 'nigar',
    emailVerified: true,
    locale,
  };
}

function Probe() {
  const { status, signOut } = useSession();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

/** One page load: a fresh provider, which reads the session once. */
async function load(expected: 'signed-in' | 'signed-out' = 'signed-in') {
  const view = render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(expected));
  return view;
}

function cookies() {
  return {
    chosen: currentLocaleCookie(),
    synced: readMarker(LOCALE_SYNCED_COOKIE),
    pending: readMarker(LOCALE_PENDING_COOKIE),
  };
}

const patched = (locale: string) =>
  expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale }) });

beforeEach(() => {
  sessionMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  for (const name of [LOCALE_COOKIE, LOCALE_SYNCED_COOKIE, LOCALE_PENDING_COOKIE]) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
});

afterEach(cleanup);

describe('the account language in this browser (#216)', () => {
  it('a fresh browser and a sign-in: the account wins', async () => {
    sessionMock.mockResolvedValue(account('ru'));
    await load();

    await waitFor(() => expect(cookies()).toEqual({ chosen: 'ru', synced: 'ru', pending: null }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a choice made here with the account unchanged: this browser wins', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=ru; Path=/`;
    writeLocaleCookie('ru');
    writeLocaleCookie('tr'); // the header's switch, since the last sync
    sessionMock.mockResolvedValue(account('ru'));
    await load();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/me/locale', patched('tr')));
    await waitFor(() => expect(cookies()).toEqual({ chosen: 'tr', synced: 'tr', pending: null }));
  });

  it('the account changed on a phone: the account wins and replaces the choice here', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=tr; Path=/`;
    writeLocaleCookie('tr');
    sessionMock.mockResolvedValue(account('en'));
    await load();

    await waitFor(() => expect(cookies()).toEqual({ chosen: 'en', synced: 'en', pending: null }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed PATCH keeps the choice, and the next page load retries it', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=az; Path=/`;
    writeLocaleCookie('ru');
    sessionMock.mockResolvedValue(account('az'));
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const first = await load();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cookies()).toEqual({ chosen: 'ru', synced: 'az', pending: 'ru' }));
    first.unmount();

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await load();

    await waitFor(() => expect(cookies()).toEqual({ chosen: 'ru', synced: 'ru', pending: null }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an account language this client cannot draw changes nothing', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=tr; Path=/`;
    writeLocaleCookie('tr');
    sessionMock.mockResolvedValue(account('de'));
    await load();

    // Give the lazily loaded rule its turn before asserting that it did nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cookies()).toEqual({ chosen: 'tr', synced: 'tr', pending: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sign-out: the choice stays and the synced marker is cleared', async () => {
    sessionMock.mockResolvedValue(account('ru'));
    await load();
    await waitFor(() => expect(cookies().synced).toBe('ru'));
    writeLocaleCookie('tr');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(cookies()).toEqual({ chosen: 'tr', synced: null, pending: null }));
  });

  it('a page load with no session forgets the marker too, so the next sign-in follows its account', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=ru; Path=/`;
    writeLocaleCookie('tr');
    sessionMock.mockResolvedValue(null);
    await load('signed-out');

    await waitFor(() => expect(cookies()).toEqual({ chosen: 'tr', synced: null, pending: null }));
  });

  it('an outage is not a sign-out: the marker stays', async () => {
    document.cookie = `${LOCALE_SYNCED_COOKIE}=ru; Path=/`;
    writeLocaleCookie('tr');
    sessionMock.mockRejectedValue(new Error('the service is restarting'));
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(sessionMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cookies()).toEqual({ chosen: 'tr', synced: 'ru', pending: null });
  });
});
