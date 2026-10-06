import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { processColor } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import { readTrend } from '@ideanest/dashboard/analytics';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { colors } from '../../../theme';
import { dashboardKey } from '../shared-charts-finance';
import type { Breakdown } from './api';
import { FundingChartsPanel } from './charts-panel';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
const mockGet = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({ get: mockGet }),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const PROJECT = 'campaign-1';
const money = (amount: string) => ({ amount, currency: 'AZN' });

/** The service's analytics body: a thirty-day range with two sparse days. */
function analytics(days: readonly { day: string; amount: string; total: string; count: number }[] = []) {
  return {
    timeZone: 'Asia/Baku',
    from: '2026-07-20',
    to: '2026-08-18',
    currency: 'AZN',
    computedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    days: days.map((entry) => ({
      day: entry.day,
      pledgeCount: entry.count,
      amount: money(entry.amount),
      cumulativePledgeCount: entry.count,
      cumulativeAmount: money(entry.total),
    })),
  };
}

const TWO_DAYS = [
  { day: '2026-08-01', amount: '100.00', total: '100.00', count: 2 },
  { day: '2026-08-05', amount: '50.00', total: '150.00', count: 1 },
];

function breakdown(extra: Partial<Breakdown> = {}): Breakdown {
  return { backerCount: 0, rewards: [], countries: [], ...extra };
}

const SPLIT: Breakdown = breakdown({
  currency: 'AZN',
  backerCount: 3,
  total: money('150.00'),
  rewards: [
    { rewardTierId: 't1', title: 'Early copy', backerCount: 2, amount: money('100.00') },
    { rewardTierId: 't2', backerCount: 1, amount: money('1.00') },
  ],
  countries: [
    { country: 'AZ', backerCount: 2, amount: money('120.00') },
    { backerCount: 1, amount: money('30.00') },
  ],
});

type Answer = unknown | Error | Promise<never>;

/** Answers each read by its path, so the two parallel requests can be told apart. */
function serve({ trend, split }: { trend: Answer; split: Answer }) {
  mockGet.mockImplementation((path: string) => {
    const answer = path.endsWith('/analytics') ? trend : split;
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer instanceof Promise) return answer;
    return Promise.resolve(answer);
  });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let client: QueryClient;

async function show(seed?: { trend?: unknown; split?: Breakdown }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } });
  if (seed?.trend !== undefined) client.setQueryData(dashboardKey(PROJECT, 'analytics'), readTrend(seed.trend as never));
  if (seed?.split !== undefined) client.setQueryData(dashboardKey(PROJECT, 'breakdown'), seed.split);
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <FundingChartsPanel projectId={PROJECT} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('the funding trend', () => {
  it('shows a 220pt placeholder for each section while both reads load, side by side', async () => {
    serve({ trend: new Promise<never>(() => {}), split: new Promise<never>(() => {}) });
    await show();

    expect(screen.getByText(en.dashboard.charts.heading)).toBeTruthy();
    expect(screen.getByTestId('trend-loading').props.accessibilityLabel).toBe(en.dashboard.charts.trendLoading);
    expect(screen.getByTestId('split-loading').props.accessibilityLabel).toBe(en.dashboard.charts.splitLoading);
    expect(mockGet).toHaveBeenCalledWith('/v1/projects/{projectId}/analytics', expect.objectContaining({ path: { projectId: PROJECT } }));
    expect(mockGet).toHaveBeenCalledWith(
      '/v1/projects/{projectId}/backers/breakdown',
      expect.objectContaining({ path: { projectId: PROJECT } }),
    );
  });

  it('draws the running total as a white line, hidden behind one summary sentence', async () => {
    serve({ trend: analytics(TWO_DAYS), split: SPLIT });
    await show();

    const chart = screen.getByTestId('trend-chart');
    expect(chart.props.accessibilityLabel).toBe('Running total from 2026-07-20 to 2026-08-18, reaching 150.00 AZN.');
    expect(screen.getByTestId('trend-line', { includeHiddenElements: true }).props.stroke).toEqual({
      type: 0,
      payload: processColor(colors.textPrimary),
    });
    expect(screen.queryByTestId('trend-dot', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('Running total, 2026-07-20 to 2026-08-18 (Asia/Baku)')).toBeTruthy();
    expect(screen.getByText('150.00 AZN by 2026-08-05')).toBeTruthy();
    expect(screen.getByText(/^Aggregated 4 minutes ago\./)).toBeTruthy();
  });

  it('draws a single day as a dot', async () => {
    serve({ trend: analytics(TWO_DAYS.slice(0, 1)), split: SPLIT });
    await show();

    expect(screen.getByTestId('trend-dot', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('trend-line', { includeHiddenElements: true })).toBeNull();
  });

  it('opens the daily figures as one card per day, in the table’s order of columns', async () => {
    serve({ trend: analytics(TWO_DAYS), split: SPLIT });
    await show();

    const toggle = screen.getByTestId('daily-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByTestId('day-2026-08-01')).toBeNull();

    await fireEvent.press(toggle);
    expect(screen.getByTestId('daily-toggle').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByLabelText(en.mobile.dashboardFigures.hideDaily)).toBeTruthy();
    expect(screen.getByTestId('day-2026-08-01').props.accessibilityLabel).toBe(
      'Day 2026-08-01, Backers 2, Pledged 100.00 AZN, Running total 100.00 AZN',
    );
    expect(within(screen.getByTestId('day-2026-08-05')).getByText('150.00 AZN')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('daily-toggle'));
    expect(screen.queryByTestId('day-2026-08-01')).toBeNull();
  });

  it('says a quiet range is quiet rather than drawing an empty chart', async () => {
    serve({ trend: analytics(), split: SPLIT });
    await show();

    expect(screen.getByTestId('trend-empty')).toHaveTextContent(
      'Nothing has been pledged between 2026-07-20 and 2026-08-18. The chart appears with the first confirmed pledge.',
    );
    expect(screen.queryByTestId('trend-chart')).toBeNull();
  });
});

describe('each read fails on its own', () => {
  it.each([
    [401, en.dashboard.failures.signedOut],
    [403, en.dashboard.charts.trendNotGranted],
    [404, en.dashboard.failures.noCampaign],
    [503, en.dashboard.charts.trendUnavailable],
  ])('words a %i on the trend and keeps the splits on screen', async (status, words) => {
    serve({ trend: new ApiError(status, { status }), split: SPLIT });
    await show();

    expect(within(screen.getByTestId('trend-failed')).getByText(words)).toBeTruthy();
    expect(screen.getByTestId('rewards')).toBeTruthy();
  });

  it('words a refused breakdown as the breakdown, under the drawn trend', async () => {
    serve({ trend: analytics(TWO_DAYS), split: new ApiError(403, { status: 403 }) });
    await show();

    expect(within(screen.getByTestId('split-failed')).getByText(en.dashboard.charts.splitNotGranted)).toBeTruthy();
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
  });

  it('tries a failed read again', async () => {
    serve({ trend: new Error('down'), split: SPLIT });
    await show();
    expect(screen.getByText(en.dashboard.charts.trendUnavailable)).toBeTruthy();

    serve({ trend: analytics(TWO_DAYS), split: SPLIT });
    await fireEvent.press(within(screen.getByTestId('trend-failed')).getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
  });
});

describe('rewards and destinations', () => {
  it('shows the stats and a bar per tier and destination, sized against the largest', async () => {
    serve({ trend: analytics(TWO_DAYS), split: SPLIT });
    await show();

    const sheet = screen.getByTestId('split-sheet');
    expect(within(sheet).getByText(en.dashboard.charts.splitHeading)).toBeTruthy();
    expect(within(sheet).getByText('3')).toBeTruthy();
    expect(within(sheet).getByText('150.00 AZN')).toBeTruthy();

    expect(screen.getByTestId('rewards').props.accessibilityLabel).toBe(en.dashboard.charts.rewardLabel);
    expect(screen.getByLabelText('Early copy, 2 backers · 100.00 AZN')).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.charts.removedTier}, 1 backer · 1.00 AZN`)).toBeTruthy();
    expect(screen.getByTestId('rewards-bar-t1').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })]),
    );
    // One manat against a hundred is one percent, held at the two-percent floor.
    expect(screen.getByTestId('rewards-bar-t2').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '2%' })]),
    );

    expect(screen.getByLabelText(`${en.dashboard.charts.noDestination}, 1 backer · 30.00 AZN`)).toBeTruthy();
    expect(screen.getByTestId('destinations-bar-AZ').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })]),
    );
    expect(screen.getByText(en.dashboard.charts.rewardNote)).toBeTruthy();
    expect(screen.getByText(en.dashboard.charts.destinationNote)).toBeTruthy();
  });

  it('says nobody has backed the campaign yet', async () => {
    serve({ trend: analytics(), split: breakdown() });
    await show();

    expect(screen.getByTestId('split-empty')).toHaveTextContent(en.dashboard.charts.splitEmpty);
  });

  it('says every backer pledged without a reward', async () => {
    serve({ trend: analytics(), split: { ...SPLIT, rewards: [] } });
    await show();

    expect(screen.getByText(en.dashboard.charts.rewardEmpty)).toBeTruthy();
    expect(screen.queryByTestId('rewards')).toBeNull();
  });
});

describe('the panel', () => {
  it('offline, keeps what this session read and says so', async () => {
    setOnline(false);
    serve({ trend: new Error('offline'), split: new Error('offline') });
    await show({ trend: analytics(TWO_DAYS), split: SPLIT });

    expect(screen.getByText(en.mobile.dashboardFigures.stale)).toBeTruthy();
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    expect(screen.getByTestId('rewards')).toBeTruthy();
  });

  it('offline with nothing read says so in each section rather than loading for ever', async () => {
    setOnline(false);
    serve({ trend: new Error('offline'), split: new Error('offline') });
    await show();

    expect(within(screen.getByTestId('trend-failed')).getByText(en.mobile.offline.nothingCached)).toBeTruthy();
    expect(within(screen.getByTestId('split-failed')).getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('reads both again on pull to refresh', async () => {
    serve({ trend: analytics(TWO_DAYS), split: SPLIT });
    await show();
    mockGet.mockClear();

    await act(async () => {
      screen.getByTestId('dashboard-charts').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('signed out, asks to sign in and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByText(en.dashboard.failures.signedOut)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: `/campaigns/${PROJECT}/dashboard/charts` },
    });
  });
});
