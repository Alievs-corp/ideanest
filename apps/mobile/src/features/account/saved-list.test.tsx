import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { AccessibilityInfo } from 'react-native';
import { FadeInDown } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { MotionBudgetProvider } from '../../components/ui';
import { unsaveCampaign } from '../../lib/campaign-actions';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { persistOptions, shouldPersistQuery } from '../../lib/offline';
import { memoryStore } from '../../lib/storage';
import { staggerDelay } from '../../theme';
import * as accountApi from './api';
import type { SavedCampaign } from './api';
import { SavedList } from './saved-list';
import type { Pages } from './use-cursor-list';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({ ...jest.requireActual('./api'), listSaved: jest.fn() }));
jest.mock('../../lib/campaign-actions', () => ({
  ...jest.requireActual('../../lib/campaign-actions'),
  unsaveCampaign: jest.fn(),
}));

// A cold first render of FlashList with Reanimated has taken more than 5 s on CI.
jest.setTimeout(30_000);

const api = jest.mocked(accountApi);
const unsave = jest.mocked(unsaveCampaign);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const HOURS_AGO = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

function campaign(id: string, extra: Partial<SavedCampaign> = {}): SavedCampaign {
  return { projectId: id, title: `Project ${id}`, creatorSlug: 'aysel', projectSlug: `slug-${id}`, savedAt: HOURS_AGO, ...extra };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** One turn: the query cache tells its observers on the next macrotask. */
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function show(options: { seed?: (client: QueryClient) => void; motion?: 'none' } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  options.seed?.(client);
  const ui = (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <SavedList />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(options.motion === undefined ? ui : <MotionBudgetProvider level="none">{ui}</MotionBudgetProvider>);
  await settle();
  return view;
}

function rowIds(): string[] {
  return screen.getAllByTestId(/^saved-row-/).map((node) => String(node.props.testID).replace('saved-row-', ''));
}

function cachedIds(): string[] {
  const data = client.getQueryData<Pages<SavedCampaign>>(queryKeys.savedList());
  return (data?.pages ?? []).flatMap((page) => page.items).map((item) => item.projectId);
}

/** The delays of every entry rise `FadeUp` builds: which list positions rose. */
function spyOnRises(): number[] {
  const delays: number[] = [];
  const build = FadeInDown.duration.bind(FadeInDown);
  jest.spyOn(FadeInDown, 'duration').mockImplementation((ms: number) => {
    const builder = build(ms);
    const delay = builder.delay.bind(builder);
    builder.delay = ((value: number) => {
      delays.push(value);
      return delay(value);
    }) as typeof builder.delay;
    return builder;
  });
  return delays;
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

afterEach(() => {
  jest.restoreAllMocks();
  client.clear();
});

describe('SavedList', () => {
  it('draws the header, and each row with its relative time and creator', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a')], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.pages.saved.title)).toBeTruthy();
    expect(screen.getByText(en.account.pages.saved.intro)).toBeTruthy();
    expect(screen.getByText('Saved 3 hours ago · by aysel')).toBeTruthy();
    expect(api.listSaved).toHaveBeenCalledWith(null, expect.anything());
  });

  it('opens the campaign from its row', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a')], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('link', { name: /^Project a/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'slug-a' },
    });
  });

  it('names each Remove button after its campaign', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a'), campaign('b')], nextCursor: null });
    await show();

    expect(screen.getByRole('button', { name: 'Remove Project a from your saved campaigns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Project b from your saved campaigns' })).toBeTruthy();
  });

  it('removes a row at once, and keeps it out of the persisted cache', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a'), campaign('b'), campaign('c')], nextCursor: null });
    unsave.mockResolvedValueOnce(false);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project b from your saved campaigns' }));
    await tick();
    expect(rowIds()).toEqual(['a', 'c']);
    await settle();
    expect(unsave).toHaveBeenCalledWith('b');
    expect(rowIds()).toEqual(['a', 'c']);

    // The removal is in the cache itself, so a restart opens without the row.
    const store = memoryStore();
    await persistQueryClientSave({ queryClient: client, ...persistOptions(store, 0) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restarted = new QueryClient();
    await persistQueryClientRestore({ queryClient: restarted, ...persistOptions(store, 0) });
    const restored = restarted.getQueryData<Pages<SavedCampaign>>(queryKeys.savedList());
    expect(restored?.pages.flatMap((page) => page.items).map((item) => item.projectId)).toEqual(['a', 'c']);
    restarted.clear();
  });

  it('puts a row whose removal failed back at the same index, with a dismissible alert', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a'), campaign('b'), campaign('c')], nextCursor: null });
    let refuse: (cause: Error) => void = () => undefined;
    unsave.mockReturnValueOnce(new Promise((_resolve, reject) => (refuse = reject)));
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project b from your saved campaigns' }));
    await tick();
    expect(rowIds()).toEqual(['a', 'c']);
    await act(async () => refuse(new Error('down')));
    await settle();

    // FlashList recycles cells, so the tree's order is not the list's: the order is the cache's.
    expect(cachedIds()).toEqual(['a', 'b', 'c']);
    expect(rowIds().sort()).toEqual(['a', 'b', 'c']);
    const alert = screen.getByTestId('saved-removal-failed');
    expect(within(alert).getByText(en.account.signals.saved.removalFailedTitle)).toBeTruthy();
    expect(within(alert).getByText(/“Project b” could not be removed/)).toBeTruthy();

    await fireEvent.press(within(alert).getByRole('button'));
    expect(screen.queryByTestId('saved-removal-failed')).toBeNull();
  });

  it('asks for the next cursor at the end of the list, once', async () => {
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('b')], nextCursor: null });
    await show();

    await fireEvent(screen.getByTestId('saved-list'), 'endReached');
    await fireEvent(screen.getByTestId('saved-list'), 'endReached');
    await settle();

    expect(api.listSaved).toHaveBeenCalledTimes(2);
    expect(api.listSaved).toHaveBeenLastCalledWith('c2', expect.anything());
    expect(rowIds()).toEqual(['a', 'b']);
  });

  it('shows "Show more" instead of relying on scrolling when a screen reader is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('b')], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: en.common.list.showMore }));
    await settle();
    expect(api.listSaved).toHaveBeenLastCalledWith('c2', expect.anything());
    expect(screen.queryByRole('button', { name: en.common.list.showMore })).toBeNull();
  });

  it('pull to refresh reloads the first page alone', async () => {
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('b')], nextCursor: null })
      .mockResolvedValueOnce({ items: [campaign('z')], nextCursor: 'c9' });
    await show();
    await fireEvent(screen.getByTestId('saved-list'), 'endReached');
    await settle();

    const control = screen.getByTestId('saved-list').props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();

    expect(api.listSaved).toHaveBeenLastCalledWith(null);
    expect(rowIds()).toEqual(['z']);
  });

  it('keeps the list under the saved root, so it is persisted and the campaign page refreshes it', () => {
    expect(queryKeys.savedList()[0]).toBe(queryKeys.saved()[0]);
    expect(shouldPersistQuery(queryKeys.savedList())).toBe(true);
  });

  it('loading: skeleton rows under the header', async () => {
    api.listSaved.mockReturnValueOnce(new Promise(() => undefined));
    await show();

    expect(screen.getByText(en.account.pages.saved.title)).toBeTruthy();
    expect(screen.getByLabelText(en.account.signals.saved.loading)).toBeTruthy();
  });

  it('empty: the way to Discover', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.signals.saved.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.common.browseCampaigns }));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('failed with nothing cached: the error with a retry that asks again', async () => {
    api.listSaved.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ items: [campaign('a')], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.signals.saved.failedTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(rowIds()).toEqual(['a']);
  });

  it('offline: the cached list with its notice, and Remove disabled with the reason', async () => {
    api.listSaved.mockRejectedValue(new TypeError('Network request failed'));
    setOnline(false);
    await show({
      seed: (seeded) => {
        seeded.setQueryData(queryKeys.savedList(), { pages: [{ items: [campaign('a')], nextCursor: null }], pageParams: [null] });
        // Older than the client's staleTime, so the screen tries to refresh it.
        seeded.getQueryCache().find({ queryKey: queryKeys.savedList() })?.setState({ dataUpdatedAt: 0 });
      },
    });

    expect(rowIds()).toEqual(['a']);
    expect(screen.getByText(en.mobile.saved.stale)).toBeTruthy();
    expect(screen.getByText(en.mobile.account.saved.offline)).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove Project a from your saved campaigns' });
    expect(remove.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(remove);
    expect(unsave).not.toHaveBeenCalled();
  });

  it('signed out: the invitation to sign in, coming back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(screen.getByText(en.mobile.saved.signedOutTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/saved' } });
    expect(api.listSaved).not.toHaveBeenCalled();
  });

  it('keeps a removed row out when the refresh asked before the delete lands with it', async () => {
    // Opened from a week-old persisted copy: the mount refresh is on its way when Remove is pressed.
    let land: (page: { items: SavedCampaign[]; nextCursor: string | null }) => void = () => undefined;
    api.listSaved.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    unsave.mockResolvedValueOnce(false);
    await show({
      seed: (seeded) => {
        seeded.setQueryData(queryKeys.savedList(), {
          pages: [{ items: [campaign('a'), campaign('b'), campaign('c')], nextCursor: null }],
          pageParams: [null],
        });
        seeded.getQueryCache().find({ queryKey: queryKeys.savedList() })?.setState({ dataUpdatedAt: 0 });
      },
    });
    expect(api.listSaved).toHaveBeenCalledWith(null);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project b from your saved campaigns' }));
    await settle();
    expect(unsave).toHaveBeenCalledWith('b');

    // The service read its rows before the delete reached it.
    await act(async () => land({ items: [campaign('a'), campaign('b'), campaign('c')], nextCursor: null }));
    await settle();
    expect(cachedIds()).toEqual(['a', 'c']);
    expect(screen.queryByTestId('saved-row-b')).toBeNull();
  });

  it('keeps a removed row out when a page already on its way writes its pages back', async () => {
    let land: (page: { items: SavedCampaign[]; nextCursor: string | null }) => void = () => undefined;
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a'), campaign('b')], nextCursor: 'c2' })
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    unsave.mockResolvedValueOnce(false);
    await show();

    await fireEvent(screen.getByTestId('saved-list'), 'endReached');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project a from your saved campaigns' }));
    await settle();
    await act(async () => land({ items: [campaign('c')], nextCursor: null }));
    await settle();

    expect(cachedIds()).toEqual(['b', 'c']);
    expect(screen.queryByTestId('saved-row-a')).toBeNull();
  });

  it('lets a row saved again come back once the list is invalidated', async () => {
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a'), campaign('b')], nextCursor: null })
      .mockResolvedValueOnce({ items: [campaign('a'), campaign('b')], nextCursor: null });
    unsave.mockResolvedValueOnce(false);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project b from your saved campaigns' }));
    await settle();
    expect(cachedIds()).toEqual(['a']);

    // The campaign page saved it again and invalidated `saved`.
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.saved() });
    });
    await settle();
    expect(cachedIds()).toEqual(['a', 'b']);
  });

  it('reads on rather than saying "nothing saved" when every row read was removed and more remain', async () => {
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('b')], nextCursor: null });
    unsave.mockResolvedValueOnce(false);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project a from your saved campaigns' }));
    await settle();

    expect(api.listSaved).toHaveBeenLastCalledWith('c2', expect.anything());
    expect(screen.queryByText(en.account.signals.saved.emptyTitle)).toBeNull();
    expect(rowIds()).toEqual(['b']);
  });

  it('shows the empty state once the last row of the last page is removed', async () => {
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a')], nextCursor: null });
    unsave.mockResolvedValueOnce(false);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Project a from your saved campaigns' }));
    await settle();
    expect(screen.getByText(en.account.signals.saved.emptyTitle)).toBeTruthy();
  });

  it('raises the first screenful once, and not a row a later page adds', async () => {
    const delays = spyOnRises();
    api.listSaved
      .mockResolvedValueOnce({ items: [campaign('a'), campaign('b')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('c')], nextCursor: null });
    await show();
    expect(delays).toEqual(expect.arrayContaining([staggerDelay(0), staggerDelay(1)]));

    delays.length = 0;
    await fireEvent(screen.getByTestId('saved-list'), 'endReached');
    await settle();
    expect(rowIds()).toEqual(['a', 'b', 'c']);
    expect(delays).toEqual([]);
  });

  it('raises nothing under a motion budget of none', async () => {
    const delays = spyOnRises();
    api.listSaved.mockResolvedValueOnce({ items: [campaign('a')], nextCursor: null });
    await show({ motion: 'none' });

    expect(rowIds()).toEqual(['a']);
    expect(delays).toEqual([]);
  });
});
