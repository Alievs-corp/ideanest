import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { FundingChartsPanel } from './charts-panel';
import { countWidths, readAudience } from './audience';

/**
 * The Charts tab's audience panel (#636): the period filter and its read, the totals beside the
 * all-time views, a column per bucket with the quiet ones left empty on the baseline, the
 * countries with "Unknown" for the ones the service could not place, the lists the clicks came
 * from, and the note that people are counted per day.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../../lib/use-session', () => ({ useSession: () => ({ signedIn: true, locked: false, unlocked: false }) }));
const mockGet = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({ get: mockGet }),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};
const PROJECT = 'campaign-1';
const copy = en.common.audience;

/** Today in Baku, hour by hour: 00:00 Baku is 20:00 UTC the day before. */
const DAY_START = Date.parse('2026-11-06T20:00:00Z');
const HOUR = 3_600_000;

function today(overrides: Record<string, unknown> = {}) {
  return {
    period: 'day',
    bucket: 'HOUR',
    timeZone: 'Asia/Baku',
    from: new Date(DAY_START).toISOString(),
    to: new Date(DAY_START + 24 * HOUR).toISOString(),
    computedAt: new Date(DAY_START + 15 * HOUR).toISOString(),
    allTimeViews: 1234,
    totals: { views: 7, clicks: 1 },
    series: Array.from({ length: 24 }, (_, hour) => ({
      start: new Date(DAY_START + hour * HOUR).toISOString(),
      views: hour === 9 ? 5 : hour === 14 ? 2 : 0,
      clicks: hour === 14 ? 1 : 0,
    })),
    countries: [
      { country: 'AZ', views: 5, clicks: 1 },
      { country: 'ZZ', views: 2, clicks: 0 },
    ],
    surfaces: [{ surface: 'SEARCH', clicks: 1 }],
    platforms: [{ platform: 'ANDROID', views: 7 }],
    ...overrides,
  };
}

/** A week: seven daily buckets. */
function week() {
  const start = Date.parse('2026-10-31T20:00:00Z');
  return today({
    period: 'week',
    bucket: 'DAY',
    totals: { views: 40, clicks: 3 },
    series: Array.from({ length: 7 }, (_, day) => ({
      start: new Date(start + day * 24 * HOUR).toISOString(),
      views: day === 6 ? 0 : 6 + day,
      clicks: day === 2 ? 3 : 0,
    })),
  });
}

type Answer = unknown | Error | Promise<never>;

/** The trend and the split answer at once; the audience by the period asked for. */
function serve(audience: (period: string) => Answer) {
  mockGet.mockImplementation((path: string, options?: { query?: { period?: string } }) => {
    if (path.endsWith('/analytics')) return Promise.resolve({ from: '2026-10-09', to: '2026-11-07', days: [] });
    if (path.endsWith('/breakdown')) return Promise.resolve({ backerCount: 0 });
    const answer = audience(options?.query?.period ?? '');
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

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } });
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

const audienceCalls = () => mockGet.mock.calls.filter(([path]) => String(path).endsWith('/audience'));
const columns = (series: 'views' | 'clicks') =>
  screen.queryAllByTestId(`audience-${series}-column`, { includeHiddenElements: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset();
  setOnline(true);
});

afterEach(() => client?.clear());

describe('the period', () => {
  it('opens on today, the service’s own default', async () => {
    serve(() => today());
    await show();

    expect(screen.getByText(en.mobile.audience.heading)).toBeTruthy();
    expect(audienceCalls()).toHaveLength(1);
    expect(audienceCalls()[0]?.[1]).toEqual(
      expect.objectContaining({ path: { projectId: PROJECT }, query: { period: 'day' } }),
    );
    expect(screen.getByTestId('audience-period-day').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('audience-period-week').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByLabelText(copy.periodLabel)).toBeTruthy();
  });

  it('offers the four periods in order, from the shared copy', async () => {
    serve(() => today());
    await show();
    const chips = within(screen.getByTestId('audience-periods')).getAllByRole('button');
    expect(chips.map((chip) => chip.props.accessibilityLabel)).toEqual([
      copy.period.day,
      copy.period.week,
      copy.period.month,
      copy.period.year,
    ]);
  });

  it('reads the chosen period, loading in between, and draws its buckets', async () => {
    let answerWeek: (value: unknown) => void = () => {};
    serve((period) => (period === 'week' ? new Promise((resolve) => (answerWeek = resolve)) : today()));
    await show();
    expect(columns('views')).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('audience-period-week'));
    await settle();
    expect(audienceCalls().at(-1)?.[1]).toEqual(expect.objectContaining({ query: { period: 'week' } }));
    expect(screen.getByTestId('audience-period-week').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('audience-loading').props.accessibilityLabel).toBe(en.mobile.audience.loading);

    await act(async () => answerWeek(week()));
    await settle();
    expect(screen.getByTestId('audience-views')).toHaveTextContent(/40/);
    // Six of the seven days had views; the seventh is an empty slot, not a missing day.
    expect(columns('views')).toHaveLength(6);
    expect(columns('clicks')).toHaveLength(1);
  });

  it('goes back to a period already read without asking again', async () => {
    serve((period) => (period === 'week' ? week() : today()));
    await show();
    await fireEvent.press(screen.getByTestId('audience-period-week'));
    await settle();
    await fireEvent.press(screen.getByTestId('audience-period-day'));
    await settle();
    expect(screen.getByTestId('audience-ready')).toBeTruthy();
    expect(screen.getByTestId('audience-views')).toHaveTextContent(/7/);
  });
});

describe('the figures', () => {
  it('shows the period’s views and clicks beside the all-time views, and the per-day note', async () => {
    serve(() => today());
    await show();
    expect(screen.getByTestId('audience-views')).toHaveTextContent(`7${copy.views}`);
    expect(screen.getByTestId('audience-clicks')).toHaveTextContent(`1${copy.clicks}`);
    expect(screen.getByTestId('audience-all-time')).toHaveTextContent(`1,234${en.mobile.audience.allTimeViews}`);
    expect(screen.getByText(copy.dailySumNote)).toBeTruthy();
  });

  it('draws every hour of the day, the quiet ones as empty slots, and names each chart in one sentence', async () => {
    serve(() => today());
    await show();
    expect(columns('views')).toHaveLength(2);
    expect(columns('clicks')).toHaveLength(1);
    expect(screen.getByTestId('audience-views-chart').props.accessibilityLabel).toBe(
      'Views, 00:00 to 23:00: 7 in all. Highest: 5, 09:00.',
    );
    expect(screen.getByTestId('audience-clicks-chart').props.accessibilityLabel).toBe(
      'Clicks, 00:00 to 23:00: 1 in all. Highest: 1, 14:00.',
    );

    await fireEvent.press(screen.getByTestId('audience-figures-toggle'));
    const rows = screen.getAllByTestId('audience-figure');
    expect(rows).toHaveLength(24);
    expect(rows[0]?.props.accessibilityLabel).toBe('00:00, Views 0 · Clicks 0');
    expect(rows[14]?.props.accessibilityLabel).toBe('14:00, Views 2 · Clicks 1');
  });

  it('says a quiet period is quiet rather than naming a peak of nothing', async () => {
    serve(() =>
      today({
        totals: { views: 0, clicks: 0 },
        series: today().series.map((point) => ({ ...point, views: 0, clicks: 0 })),
        countries: [],
        surfaces: [],
      }),
    );
    await show();
    expect(columns('views')).toHaveLength(0);
    expect(screen.getByTestId('audience-views-chart').props.accessibilityLabel).toBe('Views, 00:00 to 23:00: none yet.');
    expect(screen.getByText(en.mobile.audience.countriesEmpty)).toBeTruthy();
    expect(screen.getByText(en.mobile.audience.surfacesEmpty)).toBeTruthy();
  });
});

describe('countries and lists', () => {
  it('names each country in the reader’s language and the unplaced ones "Unknown"', async () => {
    serve(() => today());
    await show();
    expect(screen.getByTestId('audience-countries-AZ').props.accessibilityLabel).toBe(
      'Azerbaijan, Views 5 · Clicks 1',
    );
    expect(screen.getByTestId('audience-countries-ZZ').props.accessibilityLabel).toBe(
      `${copy.unknownCountry}, Views 2 · Clicks 0`,
    );
    expect(screen.queryByText('ZZ')).toBeNull();
  });

  it('names the lists the clicks came from', async () => {
    serve(() => today({ surfaces: [{ surface: 'SEARCH', clicks: 3 }, { surface: 'HOME', clicks: 1 }] }));
    await show();
    expect(screen.getByTestId('audience-surfaces-SEARCH').props.accessibilityLabel).toBe(`${copy.surface.SEARCH}, Clicks 3`);
    expect(screen.getByTestId('audience-surfaces-HOME').props.accessibilityLabel).toBe(`${copy.surface.HOME}, Clicks 1`);
  });
});

describe('when the read fails', () => {
  it('words a collaborator without the finances grant as the audience, and leaves the rest drawn', async () => {
    serve(() => new ApiError(403, { status: 403, title: 'Forbidden' } as never));
    await show();
    expect(within(screen.getByTestId('audience-failed')).getByText(en.mobile.audience.notGranted)).toBeTruthy();
    expect(screen.getByTestId('audience-periods')).toBeTruthy();
  });

  it('tries again', async () => {
    let fail = true;
    serve(() => (fail ? new Error('boom') : today()));
    await show();
    expect(within(screen.getByTestId('audience-failed')).getByText(en.mobile.audience.unavailable)).toBeTruthy();
    fail = false;
    await fireEvent.press(within(screen.getByTestId('audience-failed')).getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('audience-ready')).toBeTruthy();
  });
});

describe('reading the body', () => {
  it('treats what is missing as zero and an unplaceable country as ZZ', () => {
    const audience = readAudience(
      { series: [{ start: '2026-11-06T20:00:00Z' }, { views: 3 }], countries: [{ views: 2 }], surfaces: [{ clicks: 1 }] },
      'week',
    );
    expect(audience).toMatchObject({
      period: 'week',
      bucket: 'DAY',
      allTimeViews: 0,
      views: 0,
      clicks: 0,
      series: [{ start: '2026-11-06T20:00:00Z', views: 0, clicks: 0 }],
      countries: [{ country: 'ZZ', views: 2, clicks: 0 }],
      surfaces: [{ surface: 'OTHER', clicks: 1 }],
    });
  });

  it('sizes bars against the largest count, never an empty track for a small one', () => {
    expect(countWidths([10, 5, 0])).toEqual([100, 50, 2]);
    expect(countWidths([0, 0])).toEqual([0, 0]);
  });
});
