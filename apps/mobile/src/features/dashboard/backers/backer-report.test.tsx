import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import { NO_FILTER, type Backer, type BackerPage, type BackerSegment } from '@ideanest/dashboard/backers';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../../api/queries';
import { colors } from '../../../theme';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { shouldPersistQuery } from '../../../lib/offline';
import * as backerApi from './api';
import * as share from './share-csv';
import { BackerReport } from './backer-report';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  listBackers: jest.fn(),
  listSegments: jest.fn(),
  saveSegment: jest.fn(),
  deleteSegment: jest.fn(),
  exportBackers: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('./share-csv', () => ({
  ...jest.requireActual('./share-csv'),
  shareBackerExport: jest.fn(),
  sweepBackerExports: jest.fn(),
}));

jest.setTimeout(30_000);

const api = jest.mocked(backerApi);
const shareBackerExport = jest.mocked(share.shareBackerExport);
const PROJECT = 'project-1';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const copy = en.dashboard.backers;

function backer(id: string, extra: Partial<Backer> = {}): Backer {
  return {
    pledgeId: id,
    name: `Backer ${id}`,
    email: `${id}@example.com`,
    anonymous: false,
    rewardTierId: 'tier-1',
    rewardTitle: 'Early bird',
    amount: { amount: '45.00', currency: 'AZN' },
    state: 'CONFIRMED',
    country: 'DE',
    backedAt: '2026-09-30T10:00:00Z',
    ...extra,
  };
}

function page(backers: readonly Backer[], extra: Partial<BackerPage> = {}): BackerPage {
  return { backers, matched: backers.length, currency: 'AZN', ...extra };
}

function segment(id: string, name: string): BackerSegment {
  return {
    id,
    name,
    filter: { ...NO_FILTER, countries: ['DE'] },
    createdBy: 'u1',
    createdAt: '2026-09-30T10:00:00Z',
    updatedAt: '2026-09-30T10:00:00Z',
  };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <BackerReport projectId={PROJECT} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

/** The press handler a control holds now. Called twice, it is two taps landing before React renders again. */
function pressHandlerOf(element: { readonly unstable_fiber: unknown }): () => void {
  interface FiberLike {
    readonly memoizedProps: { readonly onPress?: unknown } | null;
    readonly return: FiberLike | null;
  }
  let fiber = element.unstable_fiber as FiberLike | null;
  while (fiber !== null) {
    const onPress = fiber.memoizedProps?.onPress;
    if (typeof onPress === 'function') return onPress as () => void;
    fiber = fiber.return;
  }
  throw new Error('No press handler above this element.');
}

async function doubleTap(element: { readonly unstable_fiber: unknown }) {
  const press = pressHandlerOf(element);
  await act(async () => {
    press();
    press();
  });
  await settle();
}

function lastListCall() {
  return api.listBackers.mock.calls.at(-1)?.[1];
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  for (const mock of [api.listBackers, api.listSegments, api.saveSegment, api.deleteSegment, api.exportBackers]) {
    mock.mockReset();
  }
  shareBackerExport.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
  api.listSegments.mockResolvedValue([]);
  shareBackerExport.mockResolvedValue('removed');
});

describe('states', () => {
  it('asks a signed-out reader to sign in, and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ returnTo: '/campaigns/project-1/dashboard/backers' }) }),
    );
    expect(api.listBackers).not.toHaveBeenCalled();
  });

  it('shows skeleton cards while the first page loads', async () => {
    api.listBackers.mockReturnValue(new Promise(() => {}));
    await show();
    expect(screen.getByTestId('backers-loading')).toBeTruthy();
    expect(screen.getByLabelText(copy.loading)).toBeTruthy();
  });

  it.each([
    [401, en.dashboard.failures.signedOut],
    [403, copy.notGranted],
    [404, en.dashboard.failures.noCampaign],
    [429, copy.tooManyExports],
    [503, copy.unavailable],
  ])('words a %s and offers a retry', async (status, words) => {
    api.listBackers.mockRejectedValueOnce(new ApiError(status, null)).mockResolvedValueOnce(page([backer('a')]));
    await show();

    const alert = screen.getByTestId('backers-failed');
    expect(within(alert).getByText(words)).toBeTruthy();
    await fireEvent.press(within(alert).getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('backer-card-a')).toBeTruthy();
  });

  it('says nobody has backed yet on an unfiltered empty list', async () => {
    api.listBackers.mockResolvedValue(page([]));
    await show();
    expect(screen.getByText(copy.emptyNone)).toBeTruthy();
    expect(screen.getByText('0 backers match this filter.')).toBeTruthy();
  });

  it('says nothing matches once a chip narrows it', async () => {
    api.listBackers.mockResolvedValueOnce(page([backer('a')])).mockResolvedValueOnce(page([]));
    await show();
    await fireEvent.press(screen.getByTestId('backers-state-FULFILLED'));
    await settle();
    expect(screen.getByText(copy.emptyFiltered)).toBeTruthy();
  });

  it('keeps the first page offline, says so, and disables the export and the segment writes', async () => {
    api.listSegments.mockResolvedValue([segment('s1', 'Germany')]);
    api.listBackers.mockResolvedValue(page([backer('a')], { nextCursor: 'c2', matched: 60 }));
    await show();
    await act(async () => setOnline(false));
    await settle();

    expect(screen.getByTestId('backer-card-a')).toBeTruthy();
    expect(screen.getByText(en.mobile.dashboardBackers.offline)).toBeTruthy();
    expect(screen.getByTestId('backers-export')).toBeDisabled();
    expect(screen.getByLabelText('Delete the segment Germany')).toBeDisabled();
    // Paging cannot be asked for, so the web's sentence comes back as the footer.
    expect(screen.getByText('Showing the most recent 1. Narrow the filter, or export the file, to see the rest.')).toBeTruthy();
    await fireEvent(screen.getByTestId('backers-list'), 'endReached');
    expect(api.listBackers).toHaveBeenCalledTimes(1);
  });

  it('never writes the report to the persisted cache', () => {
    expect(shouldPersistQuery(queryKeys.dashboardBackers(PROJECT, 'filter:{}'))).toBe(false);
    expect(shouldPersistQuery(queryKeys.dashboardSegments(PROJECT))).toBe(false);
  });
});

describe('the cards', () => {
  it('reads every field in the web table’s column order', async () => {
    api.listBackers.mockResolvedValue(page([backer('a', { anonymous: true })], { matched: 120 }));
    await show();

    expect(screen.getByTestId('backer-card-a').props.accessibilityLabel).toBe(
      'Backer: Backer a, a@example.com, Not named publicly, Reward: Early bird, Pledged: 45.00 AZN, ' +
        'State: Confirmed, Destination: DE, Backed: 30 Sept 2026',
    );
    expect(screen.getByText(en.dashboard.table.anonymous)).toBeTruthy();
    // The count is the campaign's, not the page's.
    expect(screen.getByText('120 backers match this filter.')).toBeTruthy();
  });

  it('names no reward, a removed tier and no destination in words', async () => {
    api.listBackers.mockResolvedValue(
      page([
        backer('a', { rewardTierId: undefined, rewardTitle: undefined, country: undefined }),
        backer('b', { rewardTitle: undefined }),
      ]),
    );
    await show();
    expect(screen.getByTestId('backer-card-a').props.accessibilityLabel).toContain('Reward: No reward');
    expect(screen.getByTestId('backer-card-a').props.accessibilityLabel).toContain('Destination: No destination');
    expect(screen.getByTestId('backer-card-b').props.accessibilityLabel).toContain('Reward: A removed tier');
  });
});

describe('the filter', () => {
  it('reruns the list for a toggled chip, which says it is selected', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    await show();

    await fireEvent.press(screen.getByTestId('backers-state-CHARGE_FAILED'));
    await settle();
    expect(lastListCall()).toEqual({ filter: { ...NO_FILTER, states: ['CHARGE_FAILED'] }, cursor: undefined });
    expect(screen.getByTestId('backers-state-CHARGE_FAILED').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    // "Payment failed" is a word as well as a danger icon.
    expect(screen.getByLabelText(en.dashboard.states.CHARGE_FAILED)).toBeTruthy();
  });

  it('searches when the keyboard’s search key or the Search button is pressed', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    await show();

    const field = screen.getByTestId('backers-search');
    expect(field.props.returnKeyType).toBe('search');
    await fireEvent.changeText(field, 'anna');
    await fireEvent(field, 'submitEditing');
    await settle();
    expect(lastListCall()).toEqual({ filter: { ...NO_FILTER, term: 'anna' }, cursor: undefined });

    await fireEvent.changeText(field, 'ben');
    await fireEvent.press(screen.getByRole('button', { name: copy.search }));
    await settle();
    expect(lastListCall()).toEqual({ filter: { ...NO_FILTER, term: 'ben' }, cursor: undefined });
  });

  it('resets the chips and the search when a segment is chosen, and reads it by identifier', async () => {
    api.listSegments.mockResolvedValue([segment('s1', 'Germany')]);
    api.listBackers.mockResolvedValue(page([backer('a')]));
    await show();

    await fireEvent.press(screen.getByTestId('backers-state-COLLECTED'));
    await fireEvent.changeText(screen.getByTestId('backers-search'), 'anna');
    await fireEvent.press(screen.getByTestId('backers-segment-s1'));
    await settle();

    expect(lastListCall()).toEqual({ segmentId: 's1', cursor: undefined });
    expect(screen.getByTestId('backers-segment-s1').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId('backers-state-COLLECTED').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    expect(screen.getByTestId('backers-search').props.value).toBe('');

    // A chip clears the segment in turn: only one of the two is ever run.
    await fireEvent.press(screen.getByTestId('backers-state-FULFILLED'));
    await settle();
    expect(lastListCall()).toEqual({ filter: { ...NO_FILTER, states: ['FULFILLED'] }, cursor: undefined });
    expect(screen.getByTestId('backers-segment-s1').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });
});

describe('segments', () => {
  it('offers to save only a narrowed filter, with a lime button in near-black text', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.saveSegment.mockResolvedValue(segment('s9', 'Failed'));
    await show();
    expect(screen.queryByTestId('backers-segment-save')).toBeNull();

    await fireEvent.press(screen.getByTestId('backers-state-CHARGE_FAILED'));
    await settle();
    const save = screen.getByTestId('backers-segment-save');
    expect(save).toBeDisabled();
    expect(within(save).getByText(copy.saveSegment, { includeHiddenElements: true })).toHaveStyle({
      color: colors.textOnLime,
    });

    await fireEvent.changeText(screen.getByTestId('backers-segment-name'), 'Failed');
    await fireEvent.press(save);
    await settle();

    expect(api.saveSegment).toHaveBeenCalledWith(PROJECT, 'Failed', { ...NO_FILTER, states: ['CHARGE_FAILED'] });
    expect(screen.getByTestId('backers-notice')).toHaveTextContent('Saved “Failed”.');
    expect(screen.getByTestId('backers-segment-s9')).toBeTruthy();
  });

  it('says why a 409 was refused', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.saveSegment.mockRejectedValue(new ApiError(409, null));
    await show();
    await fireEvent.press(screen.getByTestId('backers-state-COLLECTED'));
    await fireEvent.changeText(screen.getByTestId('backers-segment-name'), 'Collected');
    await fireEvent.press(screen.getByTestId('backers-segment-save'));
    await settle();
    expect(screen.getByTestId('backers-notice')).toHaveTextContent(copy.saveConflict);
  });

  it('saves one segment for two taps in the same frame', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    let answer: (saved: BackerSegment) => void = () => {};
    api.saveSegment.mockReturnValue(new Promise<BackerSegment>((resolve) => (answer = resolve)));
    await show();
    await fireEvent.press(screen.getByTestId('backers-state-COLLECTED'));
    await fireEvent.changeText(screen.getByTestId('backers-segment-name'), 'Collected');

    await doubleTap(screen.getByTestId('backers-segment-save'));
    expect(api.saveSegment).toHaveBeenCalledTimes(1);

    await act(async () => answer(segment('s9', 'Collected')));
    await settle();
    expect(api.saveSegment).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('backers-segment-save')).toBeTruthy();
  });

  it('deletes a segment from its own named button', async () => {
    api.listSegments.mockResolvedValue([segment('s1', 'Germany')]);
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.deleteSegment.mockResolvedValue();
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete the segment Germany' }));
    await settle();
    expect(api.deleteSegment).toHaveBeenCalledWith(PROJECT, 's1');
    expect(screen.queryByTestId('backers-segment-s1')).toBeNull();
    expect(screen.getByTestId('backers-notice')).toHaveTextContent('Deleted “Germany”.');
  });
});

describe('export', () => {
  const FILE = { filename: 'backers.csv', csv: 'name\n', rows: 3, truncated: false };

  it('exports the current filter, shares it and says how many', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue(FILE);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: copy.export }));
    await settle();
    expect(api.exportBackers).toHaveBeenCalledWith(PROJECT, { filter: NO_FILTER });
    expect(shareBackerExport).toHaveBeenCalledWith(FILE);
    expect(screen.getByTestId('backers-notice')).toHaveTextContent('Exported 3 backers.');
  });

  it('exports once for two taps in the same frame', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue(FILE);
    await show();

    await doubleTap(screen.getByTestId('backers-export'));
    expect(api.exportBackers).toHaveBeenCalledTimes(1);
    expect(shareBackerExport).toHaveBeenCalledTimes(1);
    // Released once the share sheet is back.
    expect(screen.getByTestId('backers-export')).not.toBeDisabled();
  });

  it('exports a chosen segment by its identifier', async () => {
    api.listSegments.mockResolvedValue([segment('s1', 'Germany')]);
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue(FILE);
    await show();
    await fireEvent.press(screen.getByTestId('backers-segment-s1'));
    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    expect(api.exportBackers).toHaveBeenCalledWith(PROJECT, { segmentId: 's1' });
  });

  it('warns about a short file before the share sheet opens', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue({ ...FILE, rows: 10000, truncated: true });
    await show();

    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    expect(shareBackerExport).not.toHaveBeenCalled();
    expect(screen.getByTestId('backers-truncated')).toHaveTextContent(/Exported the first 10,000 backers/);

    await fireEvent.press(screen.getByTestId('backers-share-truncated'));
    await settle();
    expect(shareBackerExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('backers-truncated')).toBeNull();
  });

  it('opens one share sheet for a double tap on the short-file warning', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue({ ...FILE, truncated: true });
    await show();
    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    await doubleTap(screen.getByTestId('backers-share-truncated'));
    await settle();
    expect(shareBackerExport).toHaveBeenCalledTimes(1);
  });

  it('shares nothing when the warning is cancelled', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockResolvedValue({ ...FILE, truncated: true });
    await show();
    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    await fireEvent.press(screen.getByTestId('backers-share-cancel'));
    await settle();
    expect(shareBackerExport).not.toHaveBeenCalled();
    expect(screen.getByTestId('backers-export')).not.toBeDisabled();
  });

  it('words the export budget’s 429, and a share sheet that would not open', async () => {
    api.listBackers.mockResolvedValue(page([backer('a')]));
    api.exportBackers.mockRejectedValueOnce(new ApiError(429, null)).mockResolvedValueOnce(FILE);
    shareBackerExport.mockRejectedValueOnce(new share.BackerShareError(new Error('no sheet')));
    await show();

    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    expect(screen.getByTestId('backers-notice')).toHaveTextContent(copy.tooManyExports);

    await fireEvent.press(screen.getByTestId('backers-export'));
    await settle();
    expect(screen.getByTestId('backers-notice')).toHaveTextContent(en.mobile.dashboardBackers.shareFailed);
  });

  it('sweeps a copy an earlier Android share left behind when the panel opens', async () => {
    api.listBackers.mockResolvedValue(page([]));
    await show();
    expect(share.sweepBackerExports).toHaveBeenCalled();
  });
});

describe('paging', () => {
  it('appends the next cursor’s page at the end of the list, once', async () => {
    api.listBackers
      .mockResolvedValueOnce(page([backer('a'), backer('b')], { nextCursor: 'c2', matched: 3 }))
      .mockResolvedValueOnce(page([backer('c')], { matched: 3 }));
    await show();

    await fireEvent(screen.getByTestId('backers-list'), 'endReached');
    await fireEvent(screen.getByTestId('backers-list'), 'endReached');
    await settle();

    expect(api.listBackers).toHaveBeenCalledTimes(2);
    expect(lastListCall()).toEqual({ filter: NO_FILTER, cursor: 'c2' });
    const ids = screen.getAllByTestId(/^backer-card-/).map((node) => node.props.testID);
    expect(ids).toEqual(['backer-card-a', 'backer-card-b', 'backer-card-c']);
  });

  it('keeps the rows read when the next page fails, and retries that cursor', async () => {
    api.listBackers
      .mockResolvedValueOnce(page([backer('a')], { nextCursor: 'c2' }))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(page([backer('b')]));
    await show();
    await fireEvent(screen.getByTestId('backers-list'), 'endReached');
    await settle();

    expect(screen.getByTestId('backers-next-failed')).toBeTruthy();
    expect(screen.getByTestId('backer-card-a')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('backers-next-retry'));
    await settle();
    expect(lastListCall()).toEqual({ filter: NO_FILTER, cursor: 'c2' });
    expect(screen.getByTestId('backer-card-b')).toBeTruthy();
  });
});
