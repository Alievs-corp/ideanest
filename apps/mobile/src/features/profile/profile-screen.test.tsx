import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as SecureStore from 'expo-secure-store';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { shouldPersistQuery } from '../../lib/offline';
import { rememberAccessToken, storeRefreshToken, useFlagStore } from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { ProfileScreen } from './profile-screen';

/**
 * The profile screen (#156): web order, parallel reads, tab counts only from a known total,
 * lazy panels, the two lists' paging and states, not-found versus a network error, Follow and
 * Report for the three kinds of reader, and the `profile` root staying out of the persisted cache.
 *
 * <p>The session is the real one over the keychain double; only `fetch`, the router and the
 * account read (`useMe`) are replaced.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
let mockMe: { slug: string } | null | undefined;

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/account', () => ({
  ...jest.requireActual('../../lib/account'),
  useMe: () => ({ data: mockMe }),
}));
jest.mock('../../components/ui/announce', () => ({ announce: jest.fn() }));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const G = en.profile.grid;
const keychain = SecureStore as unknown as { __reset: () => void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, title: 'x', ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

const PROFILE = {
  slug: 'aysel',
  name: 'Aysel Məmmədova',
  avatarUrl: null,
  bio: 'I make lamps.',
  joinedAt: '2025-03-14T10:00:00Z',
  websiteUrl: null,
  location: null,
  socialLinks: [],
};

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Campaign ${id}`,
    slug: `campaign-${id}`,
    creatorSlug: 'aysel',
    blurb: null,
    state: 'LIVE',
    goal: { amount: '1000.00', currency: 'AZN' },
    pledged: { amount: '795.00', currency: 'AZN' },
    backersCount: 3,
    ...extra,
  };
}

/** Backed rows never carry amounts — the service omits them. */
function backedRow(id: string) {
  const { goal: _goal, pledged: _pledged, ...rest } = row(id);
  return rest;
}

type Route = (cursor: string | null) => Response | Promise<Response>;
interface Request {
  readonly method: string;
  readonly path: string;
  readonly cursor: string | null;
}

let profileRoute: () => Response | Promise<Response>;
let created: Route;
let backed: Route;
let obligations: () => Response;
let following: () => Response;
let follow: (method: string) => Response;
let requests: Request[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  jest.clearAllMocks();
  setOnline(true);
  mockMe = null;
  requests = [];
  profileRoute = () => json(PROFILE);
  created = () => json({ projects: [row('c1'), row('c2')] });
  backed = () => json({ projects: [backedRow('b1')], nextCursor: 'b-next' });
  obligations = () => json({ creatorId: 'x', lapsedCount: 0, obligations: [] });
  following = () => json({ items: [] });
  follow = (method) => json({ following: method === 'POST' });
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? 'GET';
    const cursor = url.searchParams.get('cursor');
    requests.push({ method, path: url.pathname, cursor });
    switch (url.pathname) {
      case '/v1/auth/refresh':
        return problem(401);
      case '/v1/users/aysel':
        return profileRoute();
      case '/v1/users/aysel/projects':
        return created(cursor);
      case '/v1/users/aysel/backed':
        return backed(cursor);
      case '/v1/users/aysel/update-obligations':
        return obligations();
      case '/v1/me/following':
        return following();
      case '/v1/users/aysel/follow':
        return follow(method);
      default:
        return json({}, 404);
    }
  }) as unknown as typeof fetch;
});

afterEach(() => client?.clear());

async function signIn(slug = 'reader') {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('access-1');
  mockMe = { slug };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(tab?: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <ProfileScreen slug="aysel" tab={tab} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const reads = (path: string) => requests.filter((r) => r.method === 'GET' && r.path === path);
const panel = (id: string) => screen.getByTestId(`profile-panel-${id}`);

describe('the screen', () => {
  it('asks for the profile, both first pages and the obligations at once, before any answer', async () => {
    let answer: (response: Response) => void = () => undefined;
    profileRoute = () => new Promise<Response>((resolve) => (answer = resolve));
    await show();
    expect(reads('/v1/users/aysel')).toHaveLength(1);
    expect(reads('/v1/users/aysel/projects')).toHaveLength(1);
    expect(reads('/v1/users/aysel/backed')).toHaveLength(1);
    expect(reads('/v1/users/aysel/update-obligations')).toHaveLength(1);
    expect(screen.getByTestId('profile-loading')).toBeTruthy();
    expect(screen.getByLabelText(en.mobile.profile.loading)).toBeTruthy();

    await act(async () => answer(json(PROFILE)));
    await settle();
    expect(screen.getByTestId('profile-name')).toHaveTextContent(PROFILE.name);
  });

  it('draws the header, the late-updates card, the tabs and the panel, in that order', async () => {
    obligations = () => json({ creatorId: 'x', lapsedCount: 2, obligations: [] });
    await show();
    const created = panel('created');
    const order = within(created)
      .getAllByTestId(/^(profile-header|profile-obligations|profile-tabs|profile-card-c1)$/)
      .map((node) => node.props.testID);
    expect(order).toEqual(['profile-header', 'profile-obligations', 'profile-tabs', 'profile-card-c1']);
    expect(within(created).getByTestId('profile-obligations')).toHaveTextContent(
      /2 campaigns are late on updates/,
    );
    expect(within(created).getByTestId('profile-avatar').props.accessibilityLabel).toBe(PROFILE.name);
  });

  it('hides only the card when the obligations cannot be read', async () => {
    obligations = () => problem(500);
    await show();
    expect(screen.queryByTestId('profile-obligations')).toBeNull();
    expect(screen.getByTestId('profile-card-c1')).toBeTruthy();
  });

  it('counts a tab only when its first page has no next cursor', async () => {
    await show();
    expect(screen.getByRole('tab', { name: 'Created, 2' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Backed' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'About' })).toBeTruthy();
  });

  it('is a tablist whose tabs carry their selected state, and mounts a panel when first chosen', async () => {
    await show();
    // A tablist container is not itself an accessibility element (that would swallow its tabs).
    const tablist = screen.getByTestId('profile-tabs');
    expect(tablist.props.accessibilityRole).toBe('tablist');
    expect(tablist.props.accessibilityLabel).toBe(en.profile.tabsLabel);
    expect(screen.getByRole('tab', { name: 'Created, 2' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Backed' })).not.toBeSelected();
    expect(screen.queryByTestId('profile-panel-backed', { includeHiddenElements: true })).toBeNull();

    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Backed' })));
    await settle();
    expect(screen.getByRole('tab', { name: 'Backed' })).toBeSelected();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ tab: 'backed' });
    // The first page was already read on open: choosing the tab asks for nothing more.
    expect(reads('/v1/users/aysel/backed')).toHaveLength(1);
    const backedPanel = panel('backed');
    expect(within(backedPanel).getByTestId('profile-card-b1')).toBeTruthy();
    expect(within(backedPanel).getByTestId('profile-card-b1')).not.toHaveTextContent(/AZN|%/);
    // The created panel stays mounted, hidden.
    expect(screen.queryByTestId('profile-panel-created')).toBeNull();
    expect(screen.getByTestId('profile-panel-created', { includeHiddenElements: true })).toBeTruthy();
  });

  it('opens on the tab the route names', async () => {
    await show('about');
    expect(screen.getByRole('tab', { name: 'About' })).toBeSelected();
    expect(within(panel('about')).getByTestId('profile-about')).toHaveTextContent(/I make lamps\./);
  });

  it('shows funding on Created cards and opens the campaign', async () => {
    await show();
    expect(screen.getByTestId('profile-card-c1')).toHaveTextContent(/80% funded/);
    fireEvent.press(screen.getByRole('link', { name: 'Campaign c1' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'campaign-c1' },
    });
  });

  it('keeps the profile root out of the persisted cache', () => {
    for (const key of [
      queryKeys.profile('aysel'),
      queryKeys.profileProjects('aysel'),
      queryKeys.profileBacked('aysel'),
      queryKeys.profileObligations('aysel'),
      queryKeys.profileFollowing('aysel', 'reader'),
    ]) {
      expect(shouldPersistQuery(key)).toBe(false);
    }
  });
});

describe('not found and failure', () => {
  it('draws the not-found screen for a 404, with Discover as the way on', async () => {
    profileRoute = () => problem(404);
    await show();
    const page = screen.getByTestId('profile-not-found');
    expect(page).toHaveTextContent(new RegExp(en.shell.failure.pages.profileNotFound.title));
    expect(page).toHaveTextContent(new RegExp(en.shell.failure.pages.profileNotFound.description));
    fireEvent.press(screen.getByRole('button', { name: en.shell.failure.pages.profileNotFound.action }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/discover');
    expect(screen.queryByRole('button', { name: en.common.tryAgain })).toBeNull();
  });

  it('draws an error with a retry for a network failure — never the not-found screen', async () => {
    profileRoute = () => Promise.reject(new TypeError('Network request failed'));
    await show();
    expect(screen.queryByTestId('profile-not-found')).toBeNull();
    expect(screen.getByText(en.mobile.profile.failedTitle)).toBeTruthy();

    profileRoute = () => json(PROFILE);
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain })));
    await settle();
    expect(screen.getByTestId('profile-name')).toHaveTextContent(PROFILE.name);
  });

  it('says a list could not be loaded, keeps the tabs, and retries it', async () => {
    created = () => problem(503);
    await show();
    expect(screen.getByTestId('profile-created-failed')).toHaveTextContent(new RegExp(G.failedTitle));
    expect(screen.queryByTestId('profile-created-empty')).toBeNull();
    expect(screen.getByTestId('profile-tabs').props.accessibilityRole).toBe('tablist');
    expect(screen.getByRole('tab', { name: 'Created' })).toBeTruthy();

    created = () => json({ projects: [row('c9')] });
    await act(async () => fireEvent.press(screen.getByTestId('profile-created-retry')));
    await settle();
    expect(screen.getByTestId('profile-card-c9')).toBeTruthy();
  });

  it('draws both empty states with their own words', async () => {
    created = () => json({ projects: [] });
    backed = () => json({ projects: [] });
    await show();
    expect(screen.getByTestId('profile-created-empty')).toHaveTextContent(new RegExp(G.createdEmptyTitle));
    expect(screen.getByRole('tab', { name: 'Created, 0' })).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Backed, 0' })));
    await settle();
    expect(screen.getByTestId('profile-backed-empty')).toHaveTextContent(
      /has not backed a campaign publicly\. Pledges made anonymously are never listed here\./,
    );
  });

  it('shows what this session read, with the notice, when the connection drops', async () => {
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByTestId('profile-stale')).toHaveTextContent(new RegExp(en.mobile.profile.stale));
    expect(screen.getByTestId('profile-card-c1')).toBeTruthy();
  });
});

describe('paging', () => {
  beforeEach(() => {
    created = (cursor) =>
      cursor === null
        ? json({ projects: [row('c1'), row('c2')], nextCursor: 'c-next' })
        : json({ projects: [row('c3')] });
  });

  it('appends on Show more, named for its list', async () => {
    await show();
    expect(screen.getByRole('tab', { name: 'Created' })).toBeTruthy();
    const more = screen.getByRole('button', { name: G.showMoreCreated });
    expect(more).toHaveTextContent(G.showMore);
    await act(async () => fireEvent.press(more));
    await settle();
    expect(reads('/v1/users/aysel/projects').map((r) => r.cursor)).toEqual([null, 'c-next']);
    expect(screen.getAllByTestId(/^profile-card-c\d$/).map((n) => n.props.testID)).toEqual([
      'profile-card-c1',
      'profile-card-c2',
      'profile-card-c3',
    ]);
    expect(screen.queryByRole('button', { name: G.showMoreCreated })).toBeNull();
  });

  it('appends on end reached, and never asks for the same cursor twice', async () => {
    let answer: (response: Response) => void = () => undefined;
    created = (cursor) =>
      cursor === null
        ? json({ projects: [row('c1')], nextCursor: 'c-next' })
        : new Promise<Response>((resolve) => (answer = resolve));
    await show();
    const list = screen.getByTestId('profile-list-created');
    await act(async () => fireEvent(list, 'endReached'));
    await act(async () => fireEvent(list, 'endReached'));
    await settle();
    expect(reads('/v1/users/aysel/projects').map((r) => r.cursor)).toEqual([null, 'c-next']);
    expect(screen.getByRole('button', { name: G.showMoreCreated })).toHaveTextContent(G.loading);

    await act(async () => answer(json({ projects: [row('c2')] })));
    await settle();
    await act(async () => fireEvent(screen.getByTestId('profile-list-created'), 'endReached'));
    expect(reads('/v1/users/aysel/projects')).toHaveLength(2);
    expect(screen.getByTestId('profile-card-c2')).toBeTruthy();
  });

  it('keeps the cards when the next page fails, says why, and Show more retries the same cursor', async () => {
    let fails = true;
    created = (cursor) =>
      cursor === null
        ? json({ projects: [row('c1')], nextCursor: 'c-next' })
        : fails
          ? problem(500, { detail: 'The list is resting.' })
          : json({ projects: [row('c2')] });
    await show();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: G.showMoreCreated })));
    await settle();
    expect(screen.getByTestId('profile-created-next-failed')).toHaveTextContent(
      new RegExp(`${G.nextFailedTitle}.*The list is resting\\.`),
    );
    expect(screen.getByTestId('profile-card-c1')).toBeTruthy();

    // End reached does not hammer a cursor that just failed; the pill does retry it.
    await act(async () => fireEvent(screen.getByTestId('profile-list-created'), 'endReached'));
    expect(reads('/v1/users/aysel/projects')).toHaveLength(2);
    fails = false;
    await act(async () => fireEvent.press(screen.getByRole('button', { name: G.showMoreCreated })));
    await settle();
    expect(reads('/v1/users/aysel/projects').map((r) => r.cursor)).toEqual([null, 'c-next', 'c-next']);
    expect(screen.getByTestId('profile-card-c2')).toBeTruthy();
    expect(screen.queryByTestId('profile-created-next-failed')).toBeNull();
  });

  it('says why the next page did not load when the service could not be reached', async () => {
    created = (cursor) =>
      cursor === null
        ? json({ projects: [row('c1')], nextCursor: 'c-next' })
        : Promise.reject(new TypeError('Network request failed'));
    await show();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: G.showMoreCreated })));
    await settle();
    expect(screen.getByTestId('profile-created-next-failed')).toHaveTextContent(new RegExp(G.unreachable));
  });

  it('names the Backed list’s Show more for that list', async () => {
    await show('backed');
    expect(screen.getByRole('button', { name: G.showMoreBacked })).toBeTruthy();
  });

  it('reloads the profile, the obligations and the open list from its first page on pull', async () => {
    await show();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: G.showMoreCreated })));
    await settle();
    expect(screen.getByTestId('profile-card-c3')).toBeTruthy();

    const list = screen.getByTestId('profile-list-created');
    const control = list.props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();
    expect(reads('/v1/users/aysel')).toHaveLength(2);
    expect(reads('/v1/users/aysel/update-obligations')).toHaveLength(2);
    expect(reads('/v1/users/aysel/projects').map((r) => r.cursor)).toEqual([null, 'c-next', null]);
    expect(screen.queryByTestId('profile-card-c3')).toBeNull();
  });
});

describe('Follow and Report', () => {
  it('sends a signed-out reader to sign in and back', async () => {
    await show();
    const button = screen.getByRole('button', { name: `Follow ${PROFILE.name}` });
    fireEvent.press(button);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/u/aysel' } });
    expect(requests.some((r) => r.path === '/v1/me/following')).toBe(false);
    expect(screen.getByRole('button', { name: en.moderation.report.triggerOn.account })).toBeTruthy();
  });

  it('starts from the following list and toggles, saying what happened', async () => {
    await signIn();
    following = () => json({ items: [{ creatorId: 'u1', slug: 'aysel', name: 'Aysel' }] });
    await show();
    const button = screen.getByRole('button', { name: `Following ${PROFILE.name}` });
    expect(button).toBeSelected();

    await act(async () => fireEvent.press(button));
    await settle();
    expect(requests.filter((r) => r.path === '/v1/users/aysel/follow').map((r) => r.method)).toEqual(['DELETE']);
    expect(screen.getByRole('button', { name: `Follow ${PROFILE.name}` })).not.toBeSelected();
    expect(screen.getByTestId('profile-follow-notice')).toHaveTextContent(`You no longer follow ${PROFILE.name}.`);

    await act(async () => fireEvent.press(screen.getByRole('button', { name: `Follow ${PROFILE.name}` })));
    await settle();
    expect(requests.filter((r) => r.path === '/v1/users/aysel/follow').map((r) => r.method)).toEqual([
      'DELETE',
      'POST',
    ]);
    expect(screen.getByRole('button', { name: `Following ${PROFILE.name}` })).toBeSelected();
  });

  it('says the refusal and keeps the state when the write fails', async () => {
    await signIn();
    follow = () => problem(400, { detail: 'Not today.' });
    await show();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: `Follow ${PROFILE.name}` })));
    await settle();
    expect(screen.getByTestId('profile-follow-notice')).toHaveTextContent('Not today.');
    expect(screen.getByRole('button', { name: `Follow ${PROFILE.name}` })).not.toBeSelected();
  });

  it('offers neither Follow nor Report on your own profile', async () => {
    await signIn('aysel');
    await show();
    expect(screen.queryByTestId('profile-follow')).toBeNull();
    expect(screen.queryByTestId('profile-report')).toBeNull();
    expect(requests.some((r) => r.path === '/v1/me/following')).toBe(false);
  });

  it('disables Follow offline and says why', async () => {
    await signIn();
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByRole('button', { name: `Follow ${PROFILE.name}` })).toBeDisabled();
    expect(screen.getByTestId('profile-follow-notice')).toHaveTextContent(en.mobile.profile.followOffline);
  });
});
