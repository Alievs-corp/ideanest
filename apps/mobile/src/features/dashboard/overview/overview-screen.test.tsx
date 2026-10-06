import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../../api/queries';
import { MotionBudgetProvider } from '../../../components/ui';
import { setOnline } from '../../../lib/connectivity';
import { formatDay } from '../../../lib/i18n';
import { setLocale } from '../../../lib/locale';
import { colors } from '../../../theme';
import * as overviewApi from './api';
import type { CampaignDashboard, OverviewRead } from './api';
import { OverviewScreen } from './overview-screen';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  readOverview: jest.fn(),
  extendCampaign: jest.fn(),
  withdrawCampaign: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function Picker(props: Record<string, unknown>) {
    return createElement(View, {
      testID: props.testID,
      value: props.value,
      minimumDate: props.minimumDate,
      maximumDate: props.maximumDate,
      onValueChange: props.onValueChange,
    });
  }
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});

jest.setTimeout(30_000);

const api = jest.mocked(overviewApi);
const NOW = Date.parse('2026-09-10T12:00:00.000Z');
const now = () => NOW;
const C = en.dashboardControls;
const O = en.dashboard.overview;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function dashboard(extra: Partial<CampaignDashboard> = {}): CampaignDashboard {
  return {
    projectId: 'c1',
    title: 'Solar Lamp',
    state: 'LIVE',
    currency: 'AZN',
    goal: { amount: '1000.00', currency: 'AZN' },
    raised: { amount: '875.00', currency: 'AZN' },
    backersCount: 12,
    percentFunded: 87.5,
    goalReached: false,
    deadline: '2026-09-19T12:00:00.000Z',
    serverTime: '2026-09-10T12:00:00.000Z',
    ...extra,
  };
}

function read(extra: Partial<CampaignDashboard> = {}): OverviewRead {
  return { dashboard: dashboard(extra), skewMs: 0, receivedAt: NOW };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(options: { seed?: OverviewRead; motion?: 'full' | 'none' } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (options.seed !== undefined) client.setQueryData(queryKeys.dashboardOverview('c1'), options.seed);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MotionBudgetProvider level={options.motion ?? 'full'}>
        <QueryClientProvider client={client}>
          <IntlProvider locale="en" messages={en}>
            <OverviewScreen projectId="c1" now={now} />
          </IntlProvider>
        </QueryClientProvider>
      </MotionBudgetProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const dayWords = (day: string) => formatDay(`${day}T00:00:00Z`, 'en', 'UTC') ?? day;

async function chooseDay(date: Date) {
  await fireEvent.press(screen.getByTestId('campaign-deadline'));
  const picker = screen.getByTestId('campaign-deadline-picker');
  await act(async () => {
    (picker.props.onValueChange as (event: unknown, picked: Date) => void)({}, date);
  });
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
});

afterEach(() => client.clear());

describe('loading and failing', () => {
  it('draws a skeleton in the panel’s shape while the figures load', async () => {
    api.readOverview.mockReturnValueOnce(new Promise(() => {}));
    await show();
    expect(screen.getByTestId('overview-loading')).toBeTruthy();
  });

  it.each([
    [401, en.dashboard.failures.signedOut],
    [403, O.notGranted],
    [404, en.dashboard.failures.noCampaign],
    [500, O.unavailable],
  ])('says what a %i means, with a retry', async (status, words) => {
    api.readOverview.mockRejectedValueOnce(new ApiError(status, null));
    await show();
    expect(screen.getByText(words)).toBeTruthy();

    api.readOverview.mockResolvedValueOnce(read());
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByText('Solar Lamp')).toBeTruthy();
  });

  it('offline with nothing cached, says so instead of failing', async () => {
    setOnline(false);
    api.readOverview.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();
    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });
});

describe.each(['full', 'none'] as const)('the figures, motion %s', (motion) => {
  it('draws the title, the clock, raised, backers, goal and progress', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    await show({ motion });

    expect(screen.getByTestId('overview-title')).toHaveTextContent('Solar Lamp');
    expect(screen.getByText('9 days left')).toBeTruthy();
    expect(screen.getByRole('text', { name: '875.00 AZN' })).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByRole('text', { name: '1,000.00 AZN' })).toBeTruthy();
    expect(screen.getByText('87.5% funded')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe('Funding: 87.5 percent of the goal');
    expect(screen.queryByTestId('overview-goal-reached')).toBeNull();
    expect(api.readOverview).toHaveBeenCalledWith('c1', expect.anything(), now);
  });

  it('says "Goal reached" in success, with a mark as well as the colour', async () => {
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 104, goalReached: true }));
    await show({ motion });

    const reached = screen.getByText(O.goalReached);
    expect(StyleSheet.flatten(reached.props.style).color).toBe(colors.success);
    expect(screen.getByTestId('overview-goal-reached')).toBeTruthy();
  });
});

describe('without a goal', () => {
  it('says "Not set yet" and draws no bar', async () => {
    api.readOverview.mockResolvedValueOnce(read({ goal: undefined, percentFunded: undefined }));
    await show();
    expect(screen.getByText(O.goalUnset)).toBeTruthy();
    expect(screen.getByText(O.noGoal)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('the outcome', () => {
  it('says what the campaign closed with, the backers counted in words', async () => {
    api.readOverview.mockResolvedValueOnce(
      read({
        state: 'SUCCESSFUL',
        outcome: {
          pledged: { amount: '900.00', currency: 'AZN' },
          backersCount: 1,
          goal: { amount: '1000.00', currency: 'AZN' },
        },
      }),
    );
    await show();
    expect(screen.getByText(O.outcomeHeading)).toBeTruthy();
    expect(screen.getByText(/closed with 900.00 AZN from 1 backer, against a goal of 1,000.00 AZN/)).toBeTruthy();
  });
});

describe('offline with the figures cached', () => {
  it('shows them with "As of", and turns the controls off', async () => {
    setOnline(false);
    api.readOverview.mockRejectedValue(new TypeError('Network request failed'));
    await show({ seed: read({ percentFunded: 85 }) });

    expect(screen.getByText(en.mobile.offline.banner)).toBeTruthy();
    expect(screen.getByTestId('overview-as-of')).toHaveTextContent(/^As of /);
    expect(screen.getByText(en.mobile.dashboard.controlsOffline)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.withdraw }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: C.extend }).props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('which controls are offered', () => {
  it.each(['LIVE', 'CLOSING_WINDOW', 'EXTENDED', 'SUCCESSFUL'])('draws the card for %s', async (state) => {
    api.readOverview.mockResolvedValueOnce(read({ state }));
    await show();
    expect(screen.getByText(C.heading)).toBeTruthy();
  });

  it.each(['WITHDRAWN', 'UNSUCCESSFUL', 'COLLECTING', 'SUSPENDED'])('draws nothing for %s', async (state) => {
    api.readOverview.mockResolvedValueOnce(read({ state }));
    await show();
    expect(screen.queryByText(C.heading)).toBeNull();
  });

  it('offers withdrawal at exactly 80%, and below it says when it will be', async () => {
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 80 }));
    await show();
    expect(screen.getByRole('button', { name: C.withdraw })).toBeTruthy();
    await screen.unmount();
    client.clear();

    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 79.99 }));
    await show();
    expect(screen.queryByRole('button', { name: C.withdraw })).toBeNull();
    expect(screen.getByText(C.belowThreshold)).toBeTruthy();
  });

  it('offers extension at exactly 50% while live, never once extended', async () => {
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 50 }));
    await show();
    expect(screen.getByRole('button', { name: C.extend })).toBeTruthy();
    await screen.unmount();
    client.clear();

    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 49.99 }));
    await show();
    expect(screen.queryByRole('button', { name: C.extend })).toBeNull();
    await screen.unmount();
    client.clear();

    api.readOverview.mockResolvedValueOnce(read({ state: 'EXTENDED', percentFunded: 90 }));
    await show();
    expect(screen.queryByRole('button', { name: C.extend })).toBeNull();
  });
});

describe('extending', () => {
  it('limits the picker to the window, asks inline, and sends the day at the deadline’s time', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 60 }));
    api.extendCampaign.mockResolvedValueOnce(undefined);
    await show();

    await fireEvent.press(screen.getByTestId('campaign-deadline'));
    const picker = screen.getByTestId('campaign-deadline-picker');
    expect(picker.props.minimumDate).toEqual(new Date(2026, 8, 20, 12));
    expect(picker.props.maximumDate).toEqual(new Date(2026, 10, 18, 12));
    await act(async () => {
      (picker.props.onValueChange as (event: unknown, picked: Date) => void)({}, new Date(2026, 9, 1, 12));
    });

    await fireEvent.press(screen.getByRole('button', { name: C.extend }));
    expect(api.extendCampaign).not.toHaveBeenCalled();
    expect(screen.getByText(C.extendConfirmTitle.replace('{date}', dayWords('2026-10-01')))).toBeTruthy();
    // The lime confirm button takes screen-reader focus as the card appears.
    await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'));

    api.readOverview.mockResolvedValueOnce(read({ state: 'EXTENDED', deadline: '2026-10-01T12:00:00.000Z' }));
    await fireEvent.press(screen.getByRole('button', { name: C.extendNow }));
    await settle();

    expect(api.extendCampaign).toHaveBeenCalledWith('c1', '2026-10-01T12:00:00.000Z');
    expect(screen.getByText(C.extended.replace('{date}', dayWords('2026-10-01')))).toBeTruthy();
    expect(api.readOverview).toHaveBeenCalledTimes(2);
  });

  it('ignores a day outside the window and refuses to ask without one', async () => {
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 60 }));
    await show();

    await chooseDay(new Date(2026, 10, 19, 12));
    await fireEvent.press(screen.getByRole('button', { name: C.extend }));

    expect(screen.getByText(C.extendDate.replace('{latest}', dayWords('2026-11-18')))).toBeTruthy();
    expect(screen.queryByText(C.extendNow)).toBeNull();
    expect(api.extendCampaign).not.toHaveBeenCalled();
  });

  it.each([
    ['OUTSIDE_WINDOW', C.extendOutsideWindow],
    ['ALREADY_EXTENDED', C.extendAlready],
    ['BELOW_THRESHOLD', C.extendBelow],
  ])('words EXTENSION_NOT_AVAILABLE %s from the catalogue', async (reason, words) => {
    api.readOverview.mockResolvedValue(read({ percentFunded: 60 }));
    api.extendCampaign.mockRejectedValueOnce(
      new ApiError(409, { status: 409, code: 'EXTENSION_NOT_AVAILABLE', meta: { reason } }),
    );
    await show();

    await chooseDay(new Date(2026, 9, 1, 12));
    await fireEvent.press(screen.getByRole('button', { name: C.extend }));
    await fireEvent.press(screen.getByRole('button', { name: C.extendNow }));
    await settle();

    expect(screen.getByText(words)).toBeTruthy();
  });

  it('a cancelled confirmation sends nothing', async () => {
    api.readOverview.mockResolvedValueOnce(read({ percentFunded: 60 }));
    await show();
    await chooseDay(new Date(2026, 9, 1, 12));
    await fireEvent.press(screen.getByRole('button', { name: C.extend }));
    await fireEvent.press(screen.getByRole('button', { name: C.cancel }));
    expect(screen.queryByText(C.extendNow)).toBeNull();
    expect(api.extendCampaign).not.toHaveBeenCalled();
  });
});

describe('withdrawing', () => {
  it('asks inline, then sends once and reads the dashboard again', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    api.withdrawCampaign.mockResolvedValueOnce(undefined);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    expect(screen.getByText(C.withdrawConfirmBody)).toBeTruthy();
    expect(api.withdrawCampaign).not.toHaveBeenCalled();

    api.readOverview.mockResolvedValueOnce(read({ state: 'WITHDRAWN' }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawNow }));
    await settle();

    expect(api.withdrawCampaign).toHaveBeenCalledTimes(1);
    expect(screen.getByText(C.withdrawn)).toBeTruthy();
    expect(api.readOverview).toHaveBeenCalledTimes(2);
  });

  it('sends nothing on a second press while the first is pending', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    let answer: () => void = () => {};
    api.withdrawCampaign.mockReturnValueOnce(new Promise<void>((resolve) => (answer = resolve)));
    await show();

    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    const confirm = screen.getByRole('button', { name: C.withdrawNow });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawing }));
    expect(api.withdrawCampaign).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: C.withdrawing }).props.accessibilityState).toMatchObject({ busy: true });

    api.readOverview.mockResolvedValueOnce(read({ state: 'WITHDRAWN' }));
    await act(async () => answer());
    await settle();
    expect(api.withdrawCampaign).toHaveBeenCalledTimes(1);
  });

  it('after a timeout, reads the dashboard again and reports the withdrawal it finds — not a failure', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    api.withdrawCampaign.mockRejectedValueOnce(new overviewApi.UnansweredWrite());
    await show();

    api.readOverview.mockResolvedValueOnce(read({ state: 'WITHDRAWN' }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawNow }));
    await settle();

    expect(api.readOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByText(C.withdrawn)).toBeTruthy();
    expect(screen.queryByText(C.failed)).toBeNull();
  });

  it('after a dropped connection, says the campaign is still live and nothing was withdrawn', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    api.withdrawCampaign.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();

    api.readOverview.mockResolvedValueOnce(read());
    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawNow }));
    await settle();

    expect(
      screen.getByText(en.mobile.dashboard.withdrawNotTaken.replace('{state}', en.admin.screens.campaignDirectory.state.LIVE)),
    ).toBeTruthy();
    expect(screen.queryByText(C.failed)).toBeNull();
    // The controls are back, for a creator who wants to try again.
    expect(screen.getByRole('button', { name: C.withdraw })).toBeTruthy();
  });

  it('when the re-read fails too, says it could not check rather than "failed"', async () => {
    api.readOverview.mockResolvedValueOnce(read());
    api.withdrawCampaign.mockRejectedValueOnce(new overviewApi.UnansweredWrite());
    await show();

    api.readOverview.mockRejectedValueOnce(new TypeError('Network request failed'));
    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawNow }));
    await settle();

    expect(screen.getByText(en.mobile.dashboard.outcomeUnknown)).toBeTruthy();
    expect(screen.queryByText(C.failed)).toBeNull();
  });

  it('words a refusal at once and reads the state again', async () => {
    api.readOverview.mockResolvedValue(read());
    api.withdrawCampaign.mockRejectedValueOnce(
      new ApiError(409, { status: 409, code: 'WITHDRAWAL_NOT_AVAILABLE', meta: { reason: 'WRONG_STATE' } }),
    );
    await show();

    await fireEvent.press(screen.getByRole('button', { name: C.withdraw }));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawNow }));
    await settle();

    expect(screen.getByText(C.withdrawWrongState)).toBeTruthy();
    expect(api.readOverview).toHaveBeenCalledTimes(2);
  });
});

describe('pull to refresh', () => {
  it('reads the dashboard again', async () => {
    api.readOverview.mockResolvedValue(read());
    await show();
    const scroller = screen.getByTestId('overview-screen');
    await act(async () => {
      (scroller.props.refreshControl.props.onRefresh as () => void)();
    });
    await settle();
    expect(api.readOverview).toHaveBeenCalledTimes(2);
  });
});
