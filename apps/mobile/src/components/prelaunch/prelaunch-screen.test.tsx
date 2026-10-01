import type { ReactElement, ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as SecureStore from 'expo-secure-store';
import en from '@ideanest/messages/en.json';
import { queryKeys, type PrelaunchPage } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import {
  enableLock,
  rememberAccessToken,
  storeRefreshToken,
  useFlagStore,
} from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { colors } from '../../theme';
import { PrelaunchScreen } from './prelaunch-screen';

/**
 * The pre-launch screen — issue #155: every phase the web's `PrelaunchView` has (loading,
 * unavailable, failed, ready, following) plus the app's offline one, and the form's rules — the
 * guest address check, `{}` for an account with its bearer and a guest's request with none, the
 * count the service answers, `REMINDERS_CLOSED` and the minutes of a 429.
 */

/*
 * The session is real, not a mocked `useSession`: the form decides `{}` from the device's session,
 * and whether a bearer actually goes with it is `api/client.ts`'s business. Only the keychain and
 * the flag store are doubles (`jest.setup.ts`, `memoryStore`).
 */
const keychain = SecureStore as unknown as {
  __setBiometryAllowed: (allowed: boolean) => void;
  __reset: () => void;
};

/** A signed-in reader whose access token is in memory, so every request carries it. */
async function signIn() {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('access-1');
}

/**
 * A session on the device whose token cannot be read: the lock is on and the biometric prompt was
 * dismissed. `useSession` says signed in, and every request goes without a bearer.
 */
async function signInLockedAndDismissed() {
  await storeRefreshToken('refresh-1');
  await enableLock();
  keychain.__setBiometryAllowed(false);
  rememberAccessToken(null);
}

jest.setTimeout(30_000);

const P = en.campaign.prelaunch;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PAGE: PrelaunchPage = {
  id: ID,
  slug: 'solar-lamp',
  state: 'PRELAUNCH',
  title: 'Solar Lamp',
  blurb: 'A lamp that charges in the sun.',
  coverImage: { url: 'https://cdn.example/lamp.jpg', width: 1200, height: 900 },
  followerCount: 12,
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const problem = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
const unreachable = () => Promise.reject(new TypeError('Network request failed'));

type Route = () => Response | Promise<Response>;
let routes: { page: Route; remind: Route; refresh: Route };
let posts: unknown[];
let bearers: (string | null)[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  posts = [];
  bearers = [];
  routes = {
    page: () => json(PAGE),
    remind: () => json({ following: true, followerCount: 13 }),
    refresh: () => json({ accessToken: 'access-2', refreshToken: 'refresh-2' }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === `/v1/projects/${ID}/prelaunch`) return routes.page();
    if (url.pathname === '/v1/auth/refresh') return routes.refresh();
    if (url.pathname === `/v1/projects/${ID}/remind` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const bearer = new Headers(init.headers).get('Authorization');
      posts.push(body);
      bearers.push(bearer);
      // The service's answer to `{}` from nobody: a guest request with no address.
      if (bearer === null && body.email === undefined) {
        return problem(400, { status: 400, code: 'VALIDATION_FAILED' });
      }
      return routes.remind();
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
  setOnline(true);
  jest.restoreAllMocks();
});

async function show({ cached }: { cached?: PrelaunchPage } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (cached !== undefined) client.setQueryData(queryKeys.prelaunch(ID), cached);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(<PrelaunchScreen projectId={ID} />, { wrapper });
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const submit = () => screen.getByRole('button', { name: P.submit });

async function press(node: Parameters<typeof fireEvent.press>[0]) {
  await fireEvent.press(node);
  await settle();
}

function background(node: { props: { style?: unknown } }): unknown {
  return StyleSheet.flatten(node.props.style as ViewStyle)?.backgroundColor;
}

describe('the pre-launch screen, phase by phase', () => {
  it('draws the web’s skeleton, named once, while the page is on its way', async () => {
    routes.page = () => new Promise<Response>(() => {});
    await show();
    expect(screen.getByLabelText(P.loading)).toBeTruthy();
    expect(screen.queryByTestId('prelaunch-ready')).toBeNull();
  });

  it('says there is nothing here on a 404, without saying which of the three it was', async () => {
    routes.page = () => problem(404, { status: 404 });
    await show();
    expect(screen.getByTestId('prelaunch-unavailable')).toBeTruthy();
    expect(screen.getByText(P.unavailableTitle)).toBeTruthy();
    expect(screen.getByText(P.unavailable)).toBeTruthy();
    expect(screen.queryByRole('button', { name: P.submit })).toBeNull();
  });

  it('shows a failure with the service’s words and a retry, and the retry reads again', async () => {
    routes.page = () => problem(500, { status: 500, detail: 'The catalogue is being rebuilt.' });
    await show();
    expect(screen.getByTestId('prelaunch-failed')).toBeTruthy();
    expect(screen.getByText(P.failedTitle)).toBeTruthy();
    // The web's rule for a read: the service's detail. Never "could not be saved" — nothing was.
    expect(screen.getByText('The catalogue is being rebuilt.')).toBeTruthy();
    expect(screen.queryByText(P.errors.notSaved)).toBeNull();

    routes.page = () => json(PAGE);
    await press(screen.getByRole('button', { name: en.common.tryAgain }));
    expect(screen.getByTestId('prelaunch-ready')).toBeTruthy();
  });

  it('falls back to the title for a refusal without a detail', async () => {
    routes.page = () => problem(500, { status: 500, title: 'Internal Server Error' });
    await show();
    expect(screen.getByText('Internal Server Error')).toBeTruthy();
  });

  it('draws no description for a refusal with neither, only the heading and the retry', async () => {
    routes.page = () => problem(502, null);
    await show();
    expect(screen.getByText(P.failedTitle)).toBeTruthy();
    expect(screen.queryByText(P.errors.notSaved)).toBeNull();
    expect(screen.getByRole('button', { name: en.common.tryAgain })).toBeTruthy();
  });

  it('names the wait on a rate-limited read', async () => {
    // In the body: the read client keeps the problem as sent (`createApiClient`), not the header.
    routes.page = () => problem(429, { status: 429, retryAfterSeconds: 61 });
    await show();
    expect(screen.getByText(P.errors.rateLimitedIn.replace('{minutes}', '2'))).toBeTruthy();
  });

  it('says the service could not be reached when nothing answered and nothing is cached', async () => {
    routes.page = unreachable;
    await show();
    expect(screen.getByTestId('prelaunch-failed')).toBeTruthy();
    expect(screen.getByText(P.errors.unreachable)).toBeTruthy();
  });

  it('draws the campaign: eyebrow, title, blurb, cover and how many are waiting', async () => {
    await show();
    expect(screen.getByText(P.comingSoon)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Solar Lamp' })).toBeTruthy();
    expect(screen.getByText(PAGE.blurb as string)).toBeTruthy();
    expect(screen.getByTestId('prelaunch-cover', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('12 people are waiting for this campaign.')).toBeTruthy();
    // The count is bold white inside the sentence, as on the web.
    const count = screen.getByText('12');
    expect(StyleSheet.flatten(count.props.style).color).toBe(colors.textPrimary);
    expect(screen.getByRole('header', { name: P.formTitle })).toBeTruthy();
    expect(screen.getByText(P.formIntro)).toBeTruthy();
  });

  it('uses the singular for one person waiting', async () => {
    routes.page = () => json({ ...PAGE, followerCount: 1 });
    await show();
    expect(screen.getByText('1 person is waiting for this campaign.')).toBeTruthy();
  });

  it('reserves no cover box when there is no cover', async () => {
    routes.page = () => json({ ...PAGE, coverImage: undefined });
    await show();
    expect(screen.queryByTestId('prelaunch-cover', { includeHiddenElements: true })).toBeNull();
  });

  it('has exactly one lime control, Remind me, and no accent warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await show();
    expect(background(submit())).toBe(colors.lime500);
    const lime = screen.getAllByRole('button').filter((b) => background(b) === colors.lime500);
    expect(lime).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('accent'));
  });
});

describe('asking to be reminded', () => {
  it('checks a guest’s address with the web rule before sending anything', async () => {
    await show();
    const field = screen.getByTestId('prelaunch-email');
    expect(field.props.keyboardType).toBe('email-address');
    expect(field.props.autoComplete).toBe('email');
    expect(field.props.placeholder).toBe(P.emailPlaceholder);

    await fireEvent.changeText(field, 'not-an-address');
    await press(submit());
    expect(screen.getByText(P.emailInvalid)).toBeTruthy();
    expect(posts).toEqual([]);
  });

  it('sends a guest’s address, trimmed, then shows the count the service answered', async () => {
    const polite = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    await show();
    await fireEvent.changeText(screen.getByTestId('prelaunch-email'), '  you@example.com ');
    await press(submit());

    expect(posts).toEqual([{ email: 'you@example.com' }]);
    expect(screen.getByTestId('prelaunch-following')).toBeTruthy();
    expect(screen.getByRole('header', { name: P.onListTitle })).toBeTruthy();
    expect(screen.getByText(P.onListGuest)).toBeTruthy();
    expect(screen.queryByRole('button', { name: P.submit })).toBeNull();
    expect(screen.getByText('13 people are waiting for this campaign.')).toBeTruthy();
    // And the cache holds it, so the page restored after a restart says 13 too.
    expect(client.getQueryData<PrelaunchPage>(queryKeys.prelaunch(ID))?.followerCount).toBe(13);
    expect(polite).toHaveBeenCalledWith(P.onListAnnouncement, { queue: true });
  });

  it('sends an empty body for a signed-in reader, who is shown no address field', async () => {
    await signIn();
    await show();
    expect(screen.queryByTestId('prelaunch-email')).toBeNull();
    expect(screen.getByText(P.accountAddress)).toBeTruthy();

    await press(submit());
    expect(posts).toEqual([{}]);
    // `{}` means "the account's address" only because the bearer goes with it.
    expect(bearers).toEqual(['Bearer access-1']);
    expect(screen.getByText(P.onListSignedIn)).toBeTruthy();
  });

  it('sends a guest’s request with no Authorization at all', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('prelaunch-email'), 'you@example.com');
    await press(submit());
    expect(bearers).toEqual([null]);
  });

  it('asks the reader to sign in again when the account request went without a bearer', async () => {
    // The device has a session, so the form sends `{}`; the dismissed prompt means no token.
    await signInLockedAndDismissed();
    await show();
    expect(screen.queryByTestId('prelaunch-email')).toBeNull();

    await press(submit());
    expect(posts).toEqual([{}]);
    expect(bearers).toEqual([null]);
    expect(screen.getByText(en.campaign.comments.failures.sessionExpired)).toBeTruthy();
    expect(screen.queryByText(P.errors.notSaved)).toBeNull();
  });

  it('asks the reader to sign in again on a 401 the refresh cannot cure', async () => {
    await signIn();
    routes.remind = () => problem(401, { status: 401 });
    // The session was revoked: the one refresh `sessionFetch` tries is refused as well.
    routes.refresh = () => problem(401, { status: 401 });
    await show();
    await press(submit());
    expect(screen.getByText(en.campaign.comments.failures.sessionExpired)).toBeTruthy();
  });

  it('keeps the count it has when the answer carries none', async () => {
    await signIn();
    routes.remind = () => json({ following: true });
    await show();
    await press(submit());
    expect(screen.getByTestId('prelaunch-following')).toBeTruthy();
    expect(screen.getByText('12 people are waiting for this campaign.')).toBeTruthy();
  });

  it('goes to the unavailable state, saying it has opened, on REMINDERS_CLOSED', async () => {
    await signIn();
    routes.remind = () => problem(409, { status: 409, code: 'REMINDERS_CLOSED' });
    await show();
    // The page now 404s too, as it does once a campaign has launched.
    routes.page = () => problem(404, { status: 404 });
    await press(submit());
    expect(screen.getByTestId('prelaunch-unavailable')).toBeTruthy();
    expect(screen.getByText(P.unavailableTitle)).toBeTruthy();
    expect(screen.getByText(P.alreadyOpen)).toBeTruthy();
    expect(screen.queryByTestId('prelaunch-form')).toBeNull();
    // And the persisted page is gone, so an offline cold start cannot show "Coming soon" again.
    expect(client.getQueryData(queryKeys.prelaunch(ID))).toBeUndefined();
  });

  it('leaves the closed state when a pull to refresh finds the page again', async () => {
    await signIn();
    routes.remind = () => problem(409, { status: 409, code: 'REMINDERS_CLOSED' });
    const view = await show();
    await press(submit());
    expect(screen.getByText(P.alreadyOpen)).toBeTruthy();

    routes.page = () => json(PAGE);
    const [scroller] = view.container.queryAll((node) => node.props.refreshControl !== undefined);
    const pull = scroller?.props.refreshControl as ReactElement<{ onRefresh: () => void }>;
    await act(async () => pull.props.onRefresh());
    await settle();
    expect(screen.getByTestId('prelaunch-ready')).toBeTruthy();
    expect(screen.queryByText(P.alreadyOpen)).toBeNull();
  });

  it('names the wait in minutes, rounded up, on a 429', async () => {
    await signIn();
    routes.remind = () =>
      problem(429, { status: 429 }, { 'Retry-After': '150' });
    const assertive = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    await show();
    await press(submit());
    const sentence = P.errors.rateLimitedIn.replace('{minutes}', '3');
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(assertive).toHaveBeenCalledWith(sentence, { queue: false });
    // The form stays, so the reader can try again later.
    expect(submit()).toBeTruthy();
  });

  it('says only that it is rate limited when the 429 carries no wait', async () => {
    await signIn();
    routes.remind = () => problem(429, { status: 429 });
    await show();
    await press(submit());
    expect(screen.getByText(P.errors.rateLimited)).toBeTruthy();
  });

  it('answers another refusal with notSaved and no answer with unreachable', async () => {
    await signIn();
    routes.remind = () => problem(500, { status: 500, detail: 'Boom' });
    await show();
    await press(submit());
    expect(screen.getByText(P.errors.notSaved)).toBeTruthy();

    routes.remind = unreachable;
    await press(submit());
    expect(screen.getByText(P.errors.unreachable)).toBeTruthy();
    expect(screen.queryByText(P.errors.notSaved)).toBeNull();
  });
});

describe('offline', () => {
  it('shows the cached page with the notice, and the form disabled with the reason', async () => {
    routes.page = unreachable;
    await show({ cached: PAGE });

    expect(screen.getByText(en.mobile.prelaunch.stale)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Solar Lamp' })).toBeTruthy();
    expect(screen.getByText(P.errors.unreachable)).toBeTruthy();
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId('prelaunch-email').props.editable).toBe(false);

    await press(submit());
    expect(posts).toEqual([]);
  });

  it('disables the form when the phone reports no connection, even over a fresh page', async () => {
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByText(en.mobile.prelaunch.stale)).toBeTruthy();
    expect(screen.getByText(P.errors.unreachable)).toBeTruthy();
    expect(submit()).toBeDisabled();

    await act(async () => setOnline(true));
    expect(screen.queryByText(en.mobile.prelaunch.stale)).toBeNull();
    expect(submit()).not.toBeDisabled();
  });

  it('keeps the form usable over cached data when the service refused rather than vanished', async () => {
    routes.page = () => problem(500, { status: 500 });
    await show({ cached: PAGE });
    // The page could not be refreshed, so it says so; the write may still work.
    expect(screen.getByText(en.mobile.prelaunch.stale)).toBeTruthy();
    expect(submit()).not.toBeDisabled();
  });

  it('shows the unavailable state when the refresh of a cached page finds it gone', async () => {
    routes.page = () => problem(404, { status: 404 });
    await show({ cached: PAGE });
    expect(screen.getByTestId('prelaunch-unavailable')).toBeTruthy();
    expect(screen.getByText(P.unavailable)).toBeTruthy();
  });
});
