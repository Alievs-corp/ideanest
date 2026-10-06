import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError, type components } from '@ideanest/api-client';
import { readFinance } from '@ideanest/dashboard/finance';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../../api/queries';
import { setOnline } from '../../../lib/connectivity';
import { formatDateTime } from '../../../lib/i18n';
import { setLocale } from '../../../lib/locale';
import { FinancePanel } from './finance-panel';

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

type Body = components['schemas']['CampaignFinanceResponse'];

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const PROJECT = 'campaign-1';
const money = (amount: string) => ({ amount, currency: 'AZN' });
const COMPUTED = '2026-08-20T12:00:00.000Z';

function finance(extra: Partial<Body> = {}): Body {
  return {
    basis: 'PROJECTED',
    currency: 'AZN',
    gross: money('10000.00'),
    refunded: money('250.00'),
    platformFee: money('500.00'),
    processingFee: money('290.00'),
    taxWithheld: money('0.00'),
    taxCollected: false,
    net: money('8960.00'),
    paidOut: money('0.00'),
    payouts: [],
    ledger: [],
    reconciled: true,
    computedAt: COMPUTED,
    ...extra,
  };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(seed?: Body) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } });
  if (seed !== undefined) client.setQueryData(queryKeys.dashboardFinance(PROJECT), readFinance(seed));
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <FinancePanel projectId={PROJECT} />
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

describe('FinancePanel states', () => {
  it('shows three named placeholders while the summary loads', async () => {
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('finance-loading').props.accessibilityLabel).toBe(en.dashboard.finance.loading);
    expect(mockGet).toHaveBeenCalledWith('/v1/projects/{projectId}/finance', expect.objectContaining({ path: { projectId: PROJECT } }));
  });

  it.each([
    [401, en.dashboard.failures.signedOut],
    [403, en.dashboard.finance.notGranted],
    [404, en.dashboard.failures.noCampaign],
    [500, en.dashboard.finance.unavailable],
  ])('words a %i and offers to try again', async (status, words) => {
    mockGet.mockRejectedValueOnce(new ApiError(status, { status })).mockResolvedValueOnce(finance());
    await show();

    expect(screen.getByText(words)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByText(en.dashboard.finance.heading)).toBeTruthy();
    expect(screen.getByTestId('finance-sheet')).toBeTruthy();
  });

  it('offline, keeps what this session read, with its time and a notice', async () => {
    setOnline(false);
    mockGet.mockRejectedValue(new Error('offline'));
    await show(finance());

    expect(screen.getByText(en.mobile.dashboardFigures.stale)).toBeTruthy();
    expect(screen.getByTestId('finance-as-of')).toHaveTextContent(`As of ${formatDateTime(COMPUTED, 'en')}.`);
  });

  it('offline with nothing read says so rather than loading for ever', async () => {
    setOnline(false);
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await show();

    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('signed out, asks to sign in and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: `/campaigns/${PROJECT}/dashboard/finance` },
    });
  });

  it('reads again on pull to refresh', async () => {
    mockGet.mockResolvedValue(finance());
    await show();
    mockGet.mockClear();

    await act(async () => {
      screen.getByTestId('dashboard-finance').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('FinancePanel summary', () => {
  it('labels a projection as one, in words, with its own intro and net', async () => {
    mockGet.mockResolvedValueOnce(finance());
    await show();

    expect(screen.getByTestId('finance-basis')).toHaveTextContent(en.dashboard.finance.projected);
    expect(screen.getByText(en.dashboard.finance.projectedIntro)).toBeTruthy();
    expect(screen.getByText(en.dashboard.finance.netProjected)).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.finance.payableProjected}, 8,960.00 AZN`)).toBeTruthy();
  });

  it('labels settled figures as settled', async () => {
    mockGet.mockResolvedValueOnce(finance({ basis: 'SETTLED' }));
    await show();

    expect(screen.getByTestId('finance-basis')).toHaveTextContent(en.dashboard.finance.settled);
    expect(screen.getByText(en.dashboard.finance.settledIntro)).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.finance.payable}, 8,960.00 AZN`)).toBeTruthy();
  });

  it('prints every deduction as the service sent it, signed, with the tax note', async () => {
    mockGet.mockResolvedValueOnce(finance());
    await show();

    expect(screen.getByLabelText(`${en.dashboard.finance.grossCollected}, 10,000.00 AZN`)).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.finance.platformFee}, − 500.00 AZN`)).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.finance.processingFee}, − 290.00 AZN`)).toBeTruthy();
    expect(
      screen.getByLabelText(`${en.dashboard.finance.taxWithheld}, − 0.00 AZN. ${en.dashboard.finance.taxNote}`),
    ).toBeTruthy();
    expect(screen.getByLabelText(`${en.dashboard.finance.refunded}, − 250.00 AZN`)).toBeTruthy();
  });

  it('leaves the tax note out when tax is collected', async () => {
    mockGet.mockResolvedValueOnce(finance({ taxCollected: true }));
    await show();

    expect(screen.queryByText(en.dashboard.finance.taxNote)).toBeNull();
  });

  it('keeps twelve-digit amounts exact', async () => {
    mockGet.mockResolvedValueOnce(finance({ gross: money('999999999999.99') }));
    await show();

    expect(screen.getByLabelText(`${en.dashboard.finance.grossCollected}, 999,999,999,999.99 AZN`)).toBeTruthy();
  });

  it('explains an empty payout list and an empty ledger', async () => {
    mockGet.mockResolvedValueOnce(finance());
    await show();

    expect(screen.getByTestId('payouts-empty')).toHaveTextContent(en.dashboard.finance.payoutsEmpty);
    expect(screen.getByTestId('ledger-empty')).toHaveTextContent(en.dashboard.finance.ledgerEmpty);
    expect(screen.queryByTestId('finance-unbalanced')).toBeNull();
  });

  it('shows each payout with its state in words, its date and its net', async () => {
    mockGet.mockResolvedValueOnce(
      finance({
        payouts: [
          { id: 'p1', state: 'PAID', net: money('8960.00'), calculatedAt: '2026-08-18T10:00:00.000Z', sentAt: COMPUTED },
          { id: 'p2', state: 'FAILED', net: money('10.00'), calculatedAt: '2026-08-10T10:00:00.000Z' },
          { id: 'p3', state: 'REVERSED', net: money('1.00') },
        ],
      }),
    );
    await show();

    expect(screen.getByTestId('payout-p1').props.accessibilityLabel).toBe(
      `${en.dashboard.finance.payoutStates.PAID}, ${formatDateTime(COMPUTED, 'en')}, 8,960.00 AZN`,
    );
    expect(within(screen.getByTestId('payout-p2')).getByText(en.dashboard.finance.payoutStates.FAILED)).toBeTruthy();
    // A state the app has no words for is printed as it came, never dropped.
    expect(screen.getByTestId('payout-p3').props.accessibilityLabel).toBe('REVERSED, 1.00 AZN');
  });

  it('warns when the books do not balance, and prints each account in the ledger', async () => {
    mockGet.mockResolvedValueOnce(
      finance({ reconciled: false, ledger: [{ account: 'creator:abc', net: money('-10000.00') }] }),
    );
    await show();

    expect(within(screen.getByTestId('finance-unbalanced')).getByText(en.dashboard.finance.unbalancedTitle)).toBeTruthy();
    expect(
      screen.getByLabelText(`${en.dashboard.finance.account} creator:abc, ${en.dashboard.finance.balance} -10,000.00 AZN`),
    ).toBeTruthy();
  });
});
