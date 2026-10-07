import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { shouldPersistQuery } from '../../lib/offline';
import * as accountApi from './api';
import type { MyCampaign } from './api';
import { PUBLIC_STATES } from './campaign-routes';
import { MyCampaignsList } from './my-campaigns-list';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({ ...jest.requireActual('./api'), listMyProjects: jest.fn() }));

jest.setTimeout(30_000);

const api = jest.mocked(accountApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const STATE_NAMES = en.admin.screens.campaignDirectory.state;

/** The issue's list of states the sheet offers the dashboard for, plus the web's `SUSPENDED` (#141). */
const DASHBOARD_STATES = [
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  'WITHDRAWN',
  'CANCELED',
  'SUSPENDED',
];

function campaign(id: string, state: string): MyCampaign {
  return { id, state, title: `Campaign ${id}`, creatorSlug: 'aysel', slug: `slug-${id}` };
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
          <MyCampaignsList />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

afterEach(() => client.clear());

describe('MyCampaignsList', () => {
  it('draws the header, the title, the state as a word and the draft hint', async () => {
    api.listMyProjects.mockResolvedValueOnce({
      items: [campaign('d', 'DRAFT'), campaign('l', 'LIVE')],
      nextCursor: null,
    });
    await show();

    expect(screen.getByText(en.account.pages.campaigns.title)).toBeTruthy();
    expect(screen.getByText(en.account.pages.campaigns.intro)).toBeTruthy();
    expect(screen.getByText(STATE_NAMES.DRAFT)).toBeTruthy();
    expect(screen.getByText(STATE_NAMES.LIVE)).toBeTruthy();
    // Only the draft is "not published yet".
    expect(screen.getAllByText(en.account.pages.campaigns.draftHint)).toHaveLength(1);
    expect(api.listMyProjects).toHaveBeenCalledWith(null, expect.anything());
    // The More button is an icon, a target wide: it stays beside the row.
    expect(screen.getByTestId('campaign-row-d')).toHaveStyle({ flexDirection: 'row' });
  });

  it.each([...PUBLIC_STATES])('a %s campaign opens its public page', async (state) => {
    api.listMyProjects.mockResolvedValueOnce({ items: [campaign('p', state)], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('link', { name: /^Campaign p/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'slug-p' },
    });
  });

  it.each(['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'SUSPENDED'])('a %s campaign opens the editor', async (state) => {
    api.listMyProjects.mockResolvedValueOnce({ items: [campaign('d', state)], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('link', { name: /^Campaign d/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/campaigns/[id]/edit/basics',
      params: { id: 'd' },
    });
  });

  it.each(Object.keys(STATE_NAMES))('the %s sheet offers Edit, and Dashboard only once launched', async (state) => {
    api.listMyProjects.mockResolvedValueOnce({ items: [campaign('c', state)], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'More actions for Campaign c' }));
    expect(screen.getByTestId('campaign-action-edit')).toBeTruthy();
    if (DASHBOARD_STATES.includes(state)) {
      await fireEvent.press(screen.getByTestId('campaign-action-dashboard'));
      expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/campaigns/[id]/dashboard', params: { id: 'c' } });
    } else {
      expect(screen.queryByTestId('campaign-action-dashboard')).toBeNull();
    }
  });

  it('Edit in the sheet opens the editor', async () => {
    api.listMyProjects.mockResolvedValueOnce({ items: [campaign('c', 'LIVE')], nextCursor: null });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'More actions for Campaign c' }));
    await fireEvent.press(screen.getByTestId('campaign-action-edit'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/campaigns/[id]/edit/basics',
      params: { id: 'c' },
    });
  });

  it('asks for the next cursor at the end of the list', async () => {
    api.listMyProjects
      .mockResolvedValueOnce({ items: [campaign('a', 'DRAFT')], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [campaign('b', 'LIVE')], nextCursor: null });
    await show();

    await fireEvent(screen.getByTestId('campaigns-list'), 'endReached');
    await settle();
    expect(api.listMyProjects).toHaveBeenLastCalledWith('c2', expect.anything());
    expect(screen.getByText('Campaign b')).toBeTruthy();
  });

  it('is persisted under its own root', () => {
    expect(shouldPersistQuery(queryKeys.myProjects())).toBe(true);
  });

  it('loading: skeleton rows under the header', async () => {
    api.listMyProjects.mockReturnValueOnce(new Promise(() => undefined));
    await show();

    expect(screen.getByText(en.account.pages.campaigns.title)).toBeTruthy();
    expect(screen.getByLabelText(en.account.pages.campaigns.loadingList)).toBeTruthy();
  });

  it('empty: "Start a campaign" opens the create flow', async () => {
    api.listMyProjects.mockResolvedValueOnce({ items: [], nextCursor: null });
    await show();

    expect(screen.getByText(en.account.pages.campaigns.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.account.pages.campaigns.startCampaign }));
    expect(mockRouter.push).toHaveBeenCalledWith('/campaigns/new');
  });

  it('failed with nothing cached: the error with a retry', async () => {
    api.listMyProjects.mockRejectedValueOnce(new Error('down'));
    await show();

    expect(screen.getByText(en.account.pages.campaigns.loadFailed)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.tryAgain })).toBeTruthy();
  });

  it('offline: the cached first page with its notice', async () => {
    api.listMyProjects.mockRejectedValue(new TypeError('Network request failed'));
    setOnline(false);
    await show((seeded) => {
      seeded.setQueryData(queryKeys.myProjects(), {
        pages: [{ items: [campaign('a', 'DRAFT')], nextCursor: null }],
        pageParams: [null],
      });
      seeded.getQueryCache().find({ queryKey: queryKeys.myProjects() })?.setState({ dataUpdatedAt: 0 });
    });

    expect(screen.getByText('Campaign a')).toBeTruthy();
    expect(screen.getByText(en.mobile.account.campaigns.stale)).toBeTruthy();
  });

  it('signed out: the invitation to sign in, coming back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(screen.getByText(en.mobile.account.campaigns.signedOutTitle)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/account/campaigns' } });
    expect(api.listMyProjects).not.toHaveBeenCalled();
  });
});
