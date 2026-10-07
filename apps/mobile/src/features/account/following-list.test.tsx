import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { shouldPersistQuery } from '../../lib/offline';
import * as accountApi from './api';
import type { FollowedCreator } from './api';
import { FollowingList } from './following-list';
import type { Pages } from './use-cursor-list';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  listFollowing: jest.fn(),
  unfollowCreator: jest.fn(),
}));

jest.setTimeout(30_000);

const api = jest.mocked(accountApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

function creator(id: string): FollowedCreator {
  return { creatorId: id, name: `Maker ${id}`, slug: `maker-${id}`, followedAt: DAYS_AGO };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(seed?: (client: QueryClient) => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  seed?.(client);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <FollowingList />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function cachedIds(): string[] {
  const data = client.getQueryData<Pages<FollowedCreator>>(queryKeys.following());
  return (data?.pages ?? []).flatMap((page) => page.items).map((item) => item.creatorId);
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

afterEach(() => client.clear());

describe('FollowingList', () => {
  it('draws the header, and each creator with their slug and how long they have been followed', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a')], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.pages.following.title)).toBeTruthy();
    expect(screen.getByText(en.account.pages.following.intro)).toBeTruthy();
    expect(screen.getByText('Maker a')).toBeTruthy();
    expect(screen.getByText('maker-a · following since 2 days ago')).toBeTruthy();
  });

  it('opens the creator’s profile from the row', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a')], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('link', { name: /^Maker a/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[slug]', params: { slug: 'maker-a' } });
  });

  it('names each Unfollow button after the creator', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a'), creator('b')], nextCursor: null });
    await show();

    expect(screen.getByRole('button', { name: 'Stop following Maker a' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop following Maker b' })).toBeTruthy();
  });

  it('stacks the Unfollow pill under the name, so a long name keeps the row’s width', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a')], nextCursor: null });
    await show();

    const row = screen.getByTestId('following-row-a');
    expect(row).toHaveStyle({ flexDirection: 'column' });
  });

  it('unfollows at once, by slug', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a'), creator('b')], nextCursor: null });
    api.unfollowCreator.mockResolvedValueOnce(false);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Stop following Maker a' }));
    await settle();
    expect(api.unfollowCreator).toHaveBeenCalledWith('maker-a');
    expect(cachedIds()).toEqual(['b']);
    expect(screen.queryByText('Maker a')).toBeNull();
  });

  it('puts the creator back at the same index when the service refuses, and says so', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a'), creator('b'), creator('c')], nextCursor: null });
    let refuse: (cause: Error) => void = () => undefined;
    api.unfollowCreator.mockReturnValueOnce(new Promise((_resolve, reject) => (refuse = reject)));
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Stop following Maker b' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cachedIds()).toEqual(['a', 'c']);
    expect(screen.queryByText('Maker b')).toBeNull();

    await act(async () => refuse(new Error('down')));
    await settle();
    expect(cachedIds()).toEqual(['a', 'b', 'c']);
    expect(screen.getByText('Maker b')).toBeTruthy();
    const alert = screen.getByTestId('following-removal-failed');
    expect(within(alert).getByText(/You are still following Maker b/)).toBeTruthy();

    await fireEvent.press(within(alert).getByRole('button'));
    expect(screen.queryByTestId('following-removal-failed')).toBeNull();
  });

  it('tells the creator’s profile it is no longer followed', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a')], nextCursor: null });
    api.unfollowCreator.mockResolvedValueOnce(false);
    await show((seeded) => {
      seeded.setQueryData(queryKeys.profileFollowing('maker-a', 'viewer-1'), true);
      seeded.setQueryData(queryKeys.profileFollowing('maker-b', 'viewer-1'), true);
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Stop following Maker a' }));
    await settle();

    expect(client.getQueryState(queryKeys.profileFollowing('maker-a', 'viewer-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.profileFollowing('maker-b', 'viewer-1'))?.isInvalidated).toBe(false);
  });

  it('leaves the profile alone when the unfollow is refused', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [creator('a')], nextCursor: null });
    api.unfollowCreator.mockRejectedValueOnce(new Error('down'));
    await show((seeded) => seeded.setQueryData(queryKeys.profileFollowing('maker-a', 'viewer-1'), true));

    await fireEvent.press(screen.getByRole('button', { name: 'Stop following Maker a' }));
    await settle();
    expect(client.getQueryState(queryKeys.profileFollowing('maker-a', 'viewer-1'))?.isInvalidated).toBe(false);
  });

  it('is persisted under its own root', () => {
    expect(shouldPersistQuery(queryKeys.following())).toBe(true);
  });

  it('loading: skeleton rows under the header', async () => {
    api.listFollowing.mockReturnValueOnce(new Promise(() => undefined));
    await show();

    expect(screen.getByText(en.account.pages.following.title)).toBeTruthy();
    expect(screen.getByLabelText(en.account.signals.following.loading)).toBeTruthy();
  });

  it('empty: the way to find creators', async () => {
    api.listFollowing.mockResolvedValueOnce({ items: [], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.signals.following.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.account.signals.following.emptyAction }));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('failed with nothing cached: the error with a retry', async () => {
    api.listFollowing.mockRejectedValueOnce(new Error('down'));
    await show();

    expect(screen.getByText(en.account.signals.following.failedTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.tryAgain })).toBeTruthy();
  });

  it('offline: the cached list with its notice, and Unfollow disabled with the reason', async () => {
    api.listFollowing.mockRejectedValue(new TypeError('Network request failed'));
    setOnline(false);
    await show((seeded) => {
      seeded.setQueryData(queryKeys.following(), { pages: [{ items: [creator('a')], nextCursor: null }], pageParams: [null] });
      seeded.getQueryCache().find({ queryKey: queryKeys.following() })?.setState({ dataUpdatedAt: 0 });
    });

    expect(screen.getByText('Maker a')).toBeTruthy();
    expect(screen.getByText(en.mobile.account.following.stale)).toBeTruthy();
    expect(screen.getByText(en.mobile.account.following.offline)).toBeTruthy();
    const unfollow = screen.getByRole('button', { name: 'Stop following Maker a' });
    expect(unfollow.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('signed out: the invitation to sign in, coming back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(screen.getByText(en.mobile.account.following.signedOutTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/account/following' } });
    expect(api.listFollowing).not.toHaveBeenCalled();
  });
});
