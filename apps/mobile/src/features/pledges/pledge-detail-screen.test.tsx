import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { PledgeResponse } from '@ideanest/checkout/types';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { queryKeys } from '../../api/queries';
import * as pledgeApi from './api';
import type { BackerPledgeSummary } from './api';
import { DISPUTE_REASON_MAX } from './dispute-form';
import { PledgeDetailScreen } from './pledge-detail-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  readPledge: jest.fn(),
  listMyPledges: jest.fn(),
  openBackerDispute: jest.fn(),
}));

jest.setTimeout(30_000);

const api = jest.mocked(pledgeApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const STATES = Object.keys(en.account.pledges.states) as PledgeResponse['state'][];
const M = en.account.pledges.manager;
const money = (amount: string) => ({ amount, currency: 'AZN' });

function pledge(extra: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'pl-1',
    projectId: 'p1',
    state: 'CONFIRMED',
    rewardTierId: 'r1',
    addons: [],
    amounts: {
      base: money('40.00'),
      addons: money('0.00'),
      bonus: money('5.00'),
      shipping: money('0.00'),
      tax: money('0.00'),
      total: money('45.00'),
    },
    isAnonymous: false,
    confirmedAt: '2026-09-30T10:00:00Z',
    cardVerified: false,
    latePledge: false,
    supplements: [],
    ...extra,
  };
}

function summary(): BackerPledgeSummary {
  return {
    pledgeId: 'pl-1',
    rewardTitle: 'Early bird',
    project: { id: 'p1', title: 'Solar lamp', slug: 'solar-lamp', creatorSlug: 'aysel' },
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

function tree(props: { payment?: string; raise?: string }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <PledgeDetailScreen id="pl-1" payment={props.payment} raise={props.raise} renderEditor={() => <EditorStub />} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

async function show(props: { payment?: string; raise?: string } = {}, before?: (client: QueryClient) => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  before?.(client);
  const view = await render(tree(props));
  await settle();
  return view;
}

function EditorStub() {
  return null;
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  api.listMyPledges.mockResolvedValue({ items: [summary()], nextCursor: null });
});

describe('the payment return notice', () => {
  const cases: [PledgeResponse['state'], string, string][] = [
    ['COLLECTED', 'returned', 'payment-paid'],
    ['COLLECTED', 'failed', 'payment-paid'],
    ['DRAFT', 'returned', 'payment-waiting'],
    ['DRAFT', 'failed', 'payment-failed'],
    ['EXPIRED', 'returned', 'payment-failed'],
  ];

  it.each(cases)('reads %s after a %s return as %s', async (state, hint, notice) => {
    api.readPledge.mockResolvedValue(pledge({ state }));
    await show({ payment: hint });

    expect(screen.getByTestId(notice)).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ payment: undefined, raise: undefined });
  });

  it('ignores a hint that is neither returned nor failed', async () => {
    api.readPledge.mockResolvedValue(pledge({ state: 'COLLECTED' }));
    await show({ payment: 'paid' });

    expect(screen.queryByTestId('payment-paid')).toBeNull();
  });

  it('confirms a returned payment once: one success haptic and the pledges re-read', async () => {
    api.readPledge.mockResolvedValue(pledge({ state: 'COLLECTED' }));
    let invalidate: jest.SpyInstance | null = null;
    await show({ payment: 'returned' }, (seed) => {
      invalidate = jest.spyOn(seed, 'invalidateQueries');
    });
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.pledge('pl-1') });
    });
    await settle();

    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith('success');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pledges'] });
  });

  it('keeps the notice after the hint is cleared from the route', async () => {
    api.readPledge.mockResolvedValue(pledge({ state: 'DRAFT' }));
    const view = await show({ payment: 'failed' });
    await view.rerender(tree({}));
    await settle();

    expect(screen.getByTestId('payment-failed')).toBeTruthy();
  });

  it('reads a returned draft every 3 s until it is paid, then stops', async () => {
    jest.useFakeTimers();
    try {
      api.readPledge
        .mockResolvedValueOnce(pledge({ state: 'DRAFT' }))
        .mockResolvedValueOnce(pledge({ state: 'DRAFT' }))
        .mockResolvedValue(pledge({ state: 'COLLECTED' }));
      client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
      await render(tree({ payment: 'returned' }));
      const flush = async (ms: number) => {
        await act(async () => {
          jest.advanceTimersByTime(ms);
          for (let i = 0; i < 5; i += 1) await Promise.resolve();
        });
      };
      await flush(0);
      expect(screen.getByTestId('payment-waiting')).toBeTruthy();
      expect(api.readPledge).toHaveBeenCalledTimes(1);

      await flush(3000);
      await flush(0);
      expect(api.readPledge).toHaveBeenCalledTimes(2);
      await flush(3000);
      await flush(0);
      expect(api.readPledge).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId('payment-paid')).toBeTruthy();
      expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);

      await flush(0);
      const afterPaid = api.readPledge.mock.calls.length;
      for (let i = 0; i < 10; i += 1) await flush(3000);
      expect(api.readPledge).toHaveBeenCalledTimes(afterPaid);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads the raise rather than the pledge after a raise return', async () => {
    api.readPledge.mockResolvedValue(
      pledge({
        state: 'COLLECTED',
        latestRaise: {
          id: 'r',
          state: 'SUCCEEDED',
          amount: money('5.00'),
          total: money('50.00'),
          holdExpiresAt: '2026-10-02T12:00:00Z',
          createdAt: '2026-10-02T11:50:00Z',
        },
      }),
    );
    await show({ raise: 'failed' });

    expect(screen.getByTestId('raise-raised')).toBeTruthy();
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalled();
  });
});

describe('which controls a state offers', () => {
  it.each(STATES)('%s', async (state) => {
    const editor = jest.fn(() => null);
    api.readPledge.mockResolvedValue(pledge({ state }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <IntlProvider locale="en" messages={en}>
            <PledgeDetailScreen id="pl-1" renderEditor={editor} />
          </IntlProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await settle();

    const editable = state === 'DRAFT' || state === 'CONFIRMED';
    expect(editor.mock.calls.length > 0).toBe(editable);
    expect(screen.queryByTestId('pledge-locked') !== null).toBe(!editable);
    expect(screen.queryByTestId('dispute-open') !== null).toBe(state === 'COLLECTED');

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(String(control.props.accessibilityLabel ?? '')).not.toMatch(/cancel|withdraw/i);
      expect(within(control).queryByText(/cancel|withdraw/i)).toBeNull();
    }
  });

  it('offers the raise editor for a paid pledge the service calls raisable', async () => {
    const editor = jest.fn(() => null);
    api.readPledge.mockResolvedValue(pledge({ state: 'COLLECTED', raisable: true }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <IntlProvider locale="en" messages={en}>
            <PledgeDetailScreen id="pl-1" renderEditor={editor} />
          </IntlProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await settle();

    expect(editor).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'COLLECTED' }),
      expect.objectContaining({ disabled: false, raising: true }),
    );
    expect(screen.queryByTestId('pledge-locked')).toBeNull();
  });
});

describe('the pledge', () => {
  it('names its campaign from the list and links to it', async () => {
    api.readPledge.mockResolvedValue(pledge());
    await show();

    await fireEvent.press(screen.getByTestId('pledge-campaign'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'solar-lamp' },
    });
    expect(screen.getByText('Early bird')).toBeTruthy();
  });

  it('says the campaign could not be named when the list does not have it', async () => {
    api.readPledge.mockResolvedValue(pledge());
    api.listMyPledges.mockRejectedValue(new Error('down'));
    await show();

    expect(screen.getByText(M.campaignUnnamed)).toBeTruthy();
    expect(screen.getByTestId('summary-total')).toBeTruthy();
  });

  it('shows the server total, the approximation at its own rate, and supplements outside the total', async () => {
    api.readPledge.mockResolvedValue(
      pledge({
        displayCurrency: 'USD',
        displayRate: '1.70',
        supplements: [
          { id: 's1', kind: 'UPGRADE', amount: money('12.00'), addons: [], createdAt: '2026-10-01T10:00:00Z' },
        ],
      }),
    );
    await show();

    expect(screen.getByTestId('summary-total')).toHaveTextContent('45.00 AZN');
    expect(screen.getByTestId('summary-approximate').props.children).toMatch(/26\.47/);
    expect(screen.getByTestId('pledge-supplements')).toHaveTextContent(/12\.00 AZN/);
  });

  it('links to the address when the reward is posted', async () => {
    api.readPledge.mockResolvedValue(pledge({ shippingCountry: 'AZ' }));
    await show();

    await fireEvent.press(screen.getByTestId('pledge-where-going'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pledges/[id]/address', params: { id: 'pl-1' } });
  });

  it('answers a missing pledge with the not-found wording and no retry', async () => {
    api.readPledge.mockRejectedValue(
      new ApiError(404, { type: 'about:blank', title: 'Not found', status: 404, code: 'PLEDGE_NOT_FOUND' }),
    );
    await show();

    expect(screen.getByTestId('pledge-failed')).toHaveTextContent(new RegExp(en.checkout.failures.codes.PLEDGE_NOT_FOUND.title));
    expect(screen.queryByLabelText(en.common.tryAgain)).toBeNull();
    await fireEvent.press(screen.getByLabelText(M.allPledges));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/pledges');
  });

  it('offers a retry when the pledge could not be read', async () => {
    api.readPledge.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(pledge());
    await show();

    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('summary-total')).toBeTruthy();
  });

  it('keeps the cached pledge offline and disables writes', async () => {
    setOnline(false);
    api.readPledge.mockResolvedValue(pledge({ state: 'COLLECTED' }));
    await show();

    expect(screen.getByText(en.mobile.offline.banner)).toBeTruthy();
    expect(screen.getByLabelText(en.checkout.dispute.heading)).toBeDisabled();
  });
});

describe('the dispute', () => {
  async function open() {
    api.readPledge.mockResolvedValue(pledge({ state: 'COLLECTED' }));
    await show();
    await fireEvent.press(screen.getByTestId('dispute-open'));
    await fireEvent.changeText(screen.getByTestId('dispute-reason'), '  It never arrived  ');
  }

  it('caps the reason and sends it trimmed', async () => {
    await open();
    expect(screen.getByTestId('dispute-reason').props.maxLength).toBe(DISPUTE_REASON_MAX);
    api.openBackerDispute.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('dispute-submit'));
    await settle();

    expect(api.openBackerDispute).toHaveBeenCalledWith('pl-1', 'It never arrived');
    expect(screen.getByTestId('dispute-opened')).toBeTruthy();
    expect(screen.queryByTestId('dispute-form')).toBeNull();
  });

  it.each([
    ['DISPUTE_WINDOW_CLOSED', en.checkout.dispute.windowClosed],
    ['NOTHING_TO_DISPUTE', en.checkout.dispute.nothing],
    ['SOMETHING_ELSE', en.checkout.dispute.failed],
  ])('words %s', async (code, wording) => {
    await open();
    api.openBackerDispute.mockRejectedValue(new ApiError(409, { type: 'about:blank', title: 'No', status: 409, code }));
    await fireEvent.press(screen.getByTestId('dispute-submit'));
    await settle();

    expect(screen.getByTestId('dispute-error')).toHaveTextContent(wording);
  });
});
