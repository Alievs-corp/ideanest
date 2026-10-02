import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { setOnline } from '../../lib/connectivity';
import { queryKeys } from '../../api/queries';
import * as pledgeApi from './api';
import type { BackerPledgeSummary } from './api';
import { PledgeListScreen } from './pledge-list-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  listMyPledges: jest.fn(),
}));

jest.setTimeout(30_000);

const api = jest.mocked(pledgeApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const STATES = Object.keys(en.account.pledges.states) as (keyof typeof en.account.pledges.states)[];

function summary(id: string, extra: Partial<BackerPledgeSummary> = {}): BackerPledgeSummary {
  return {
    pledgeId: id,
    state: 'COLLECTED',
    amounts: {
      base: { amount: '45.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '45.00', currency: 'AZN' },
    },
    rewardTitle: 'Early bird',
    isAnonymous: false,
    latePledge: false,
    confirmedAt: '2026-09-30T10:00:00Z',
    project: { id: 'p1', title: `Campaign ${id}`, slug: 'camp', creatorSlug: 'maker', state: 'LIVE' },
    ...extra,
  } as BackerPledgeSummary;
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  seed?.(client);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <PledgeListScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

async function endReached() {
  await fireEvent(screen.getByTestId('pledge-list'), 'endReached');
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('PledgeListScreen', () => {
  it('asks for 24 at a time and appends the next cursor on end reached, once', async () => {
    api.listMyPledges
      .mockResolvedValueOnce({ items: [summary('a'), summary('b')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [summary('c')], nextCursor: null });
    await show();

    expect(api.listMyPledges).toHaveBeenNthCalledWith(1, null, expect.anything());
    await endReached();
    await endReached();
    await settle();

    expect(api.listMyPledges).toHaveBeenCalledTimes(2);
    expect(api.listMyPledges).toHaveBeenNthCalledWith(2, 'c2', expect.anything());
    const ids = screen.getAllByTestId(/^pledge-card-/).map((node) => node.props.testID);
    expect(ids).toEqual(['pledge-card-a', 'pledge-card-b', 'pledge-card-c']);
  });

  it('shows a retry row when the next page fails, and retries the same cursor', async () => {
    api.listMyPledges
      .mockResolvedValueOnce({ items: [summary('a')], nextCursor: 'c2' })
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ items: [summary('b')], nextCursor: null });
    await show();
    await endReached();
    await settle();

    expect(screen.getByText(en.account.pledges.list.nextPageFailed)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pledges-next-retry'));
    await settle();

    expect(api.listMyPledges).toHaveBeenLastCalledWith('c2', expect.anything());
    expect(screen.queryByTestId('pledges-next-failed')).toBeNull();
    expect(screen.getByTestId('pledge-card-b')).toBeTruthy();
  });

  it('labels every one of the twelve states from the catalogue, with its tags', async () => {
    api.listMyPledges.mockResolvedValueOnce({
      items: STATES.map((state, index) =>
        summary(state, { state, isAnonymous: index === 0, latePledge: index === 1 }),
      ),
      nextCursor: null,
    });
    await show();

    for (const state of STATES) {
      const card = screen.getByTestId(`pledge-card-${state}`);
      expect(card.props.accessibilityLabel.startsWith(`Campaign ${state}, ${en.account.pledges.states[state]}, `)).toBe(true);
      expect(screen.getAllByText(en.account.pledges.states[state]).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(en.account.pledges.anonymous)).toHaveLength(1);
    expect(screen.getAllByText(en.account.pledges.latePledge)).toHaveLength(1);
  });

  it('names a card by campaign, state and total, and opens the pledge', async () => {
    api.listMyPledges.mockResolvedValueOnce({ items: [summary('a')], nextCursor: null });
    await show();

    const card = screen.getByTestId('pledge-card-a');
    expect(card.props.accessibilityRole).toBe('link');
    expect(card.props.accessibilityLabel).toMatch(/^Campaign a, Paid, .*45/);
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pledges/[id]', params: { id: 'a' } });
  });

  it('keeps the cached list with the offline notice when a refetch fails', async () => {
    api.listMyPledges.mockRejectedValue(new Error('offline'));
    await show((seed) =>
      seed.setQueryData(queryKeys.pledgeList(), {
        pages: [{ items: [summary('a')], nextCursor: null }],
        pageParams: [null],
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.pledgeList() });
    });
    await settle();

    expect(screen.getByTestId('pledge-card-a')).toBeTruthy();
    expect(screen.getByText(en.mobile.pledges.stale)).toBeTruthy();
  });

  it('shows the empty state with a way to browse', async () => {
    api.listMyPledges.mockResolvedValueOnce({ items: [], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.pledges.list.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.account.pledges.list.browse));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('invites a signed-out reader to sign in and come back to the list', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(api.listMyPledges).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/pledges' } });
  });
});
