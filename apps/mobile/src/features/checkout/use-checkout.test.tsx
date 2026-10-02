import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { ApiError } from '@ideanest/api-client';
import type { PledgeFailureCopy } from '@ideanest/checkout/failure';
import type { PledgeResponse, PublicReward, PublicRewardList } from '@ideanest/checkout/types';
import en from '@ideanest/messages/en.json';
import * as checkoutApi from './api';
import { NO_REWARD, useCheckout, type CheckoutOptions } from './use-checkout';

jest.mock('./api', () => ({
  getCheckoutRewards: jest.fn(),
  createPledgeDraft: jest.fn(),
  payForPledge: jest.fn(),
  getPledge: jest.fn(),
}));

const api = jest.mocked(checkoutApi);
const browser = jest.mocked(WebBrowser);
const FAILURES: PledgeFailureCopy = en.checkout.failures;

function tier(id: string, price: string, extra: Partial<PublicReward> = {}): PublicReward {
  return {
    id,
    title: `Tier ${id}`,
    price: { amount: price, currency: 'AZN' },
    shippingType: 'NONE',
    isEarlyBird: false,
    isFeatured: false,
    items: [],
    shippingRates: [],
    ...extra,
  };
}

const CATALOGUE: PublicRewardList = {
  currency: 'AZN',
  rewards: [tier('r1', '45.00'), tier('r2', '10.00', { remainingQuantity: 0 })],
  addons: [tier('a1', '5.00')],
};

function draft(id = 'pl-1', expiresAt = '2030-01-01T00:05:00Z'): PledgeResponse {
  return {
    id,
    projectId: 'p1',
    state: 'DRAFT',
    rewardTierId: 'r1',
    addons: [],
    amounts: {
      base: { amount: '45.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '45.00', currency: 'AZN' },
    },
    isAnonymous: false,
    reservationExpiresAt: expiresAt,
    cardVerified: false,
    latePledge: false,
    supplements: [],
  };
}

function refusal(status: number, code: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, { type: 'about:blank', title: code, status, code, ...extra });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let client: QueryClient;
let counter = 0;

async function mount(overrides: Partial<CheckoutOptions> = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onPaid = jest.fn();
  const onAgreementRequired = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = await renderHook(
    (props: Partial<CheckoutOptions>) =>
      useCheckout({
        projectId: 'p1',
        tokens: [],
        initialRewardId: null,
        agreementVersion: 3,
        failures: FAILURES,
        language: 'en',
        online: true,
        onPaid,
        onAgreementRequired,
        mintKey: () => `key-${++counter}`,
        ...overrides,
        ...props,
      }),
    { wrapper, initialProps: {} },
  );
  await settle();
  return { view, onPaid, onAgreementRequired };
}

beforeEach(() => {
  counter = 0;
  jest.clearAllMocks();
  api.getCheckoutRewards.mockResolvedValue(CATALOGUE);
  browser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult);
});

afterEach(() => client.clear());

describe('useCheckout — selection', () => {
  it('pre-selects ?reward= once, never a sold-out tier', async () => {
    const { view } = await mount({ initialRewardId: 'r1' });
    expect(view.result.current.choice).toBe('r1');
    expect(view.result.current.contributionText).toBe('45.00');

    const soldOut = await mount({ initialRewardId: 'r2' });
    expect(soldOut.view.result.current.choice).toBeNull();
  });

  it('forwards every token to the catalogue request', async () => {
    await mount({ tokens: ['a', 'b'] });
    expect(api.getCheckoutRewards).toHaveBeenCalledWith('p1', ['a', 'b'], expect.anything());
  });

  it('previews with decimal arithmetic and refuses below the tier price', async () => {
    const { view } = await mount();
    await act(async () => view.result.current.chooseReward('r1'));
    await act(async () => view.result.current.setAddonQuantity('a1', 2));
    await act(async () => view.result.current.setContributionText('45.10'));
    const quote = view.result.current.quote;
    expect(quote?.ok && quote.quote.total.toFixed(2)).toBe('55.10');
    await act(async () => view.result.current.setContributionText('44.99'));
    expect(view.result.current.quote).toEqual({
      ok: false,
      refusal: { reason: 'contribution-below-price', price: { amount: '45.00', currency: 'AZN' } },
    });
  });
});

describe('useCheckout — reserve and idempotency', () => {
  it('selecting → reserving → reserved, sending the web body', async () => {
    api.createPledgeDraft.mockResolvedValue(draft());
    const { view } = await mount();
    await act(async () => view.result.current.chooseReward(NO_REWARD));
    await act(async () => view.result.current.setContributionText('20'));
    await act(async () => view.result.current.reserve());
    await settle();
    expect(view.result.current.phase).toBe('reserved');
    expect(api.createPledgeDraft).toHaveBeenCalledWith(
      {
        projectId: 'p1',
        rewardTierId: null,
        addons: [],
        contribution: { amount: '20.00', currency: 'AZN' },
        shippingCountry: null,
        isAnonymous: false,
        referrerCode: null,
      },
      'key-1',
    );
    expect(view.result.current.heldUntil).toBe('2030-01-01T00:05:00Z');
  });

  it('Try again after a network failure reuses the key', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(new TypeError('Network request failed'));
    api.createPledgeDraft.mockResolvedValueOnce(draft());
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    expect(view.result.current.failure?.recovery).toBe('retry');
    expect(view.result.current.phase).toBe('selecting');
    await act(async () => view.result.current.retry());
    await settle();
    expect(api.createPledgeDraft.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-1']);
    expect(view.result.current.phase).toBe('reserved');
  });

  it('RESERVATION_EXPIRED retires the key; Reserve again sends a new one', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(refusal(409, 'RESERVATION_EXPIRED'));
    api.createPledgeDraft.mockResolvedValueOnce(draft());
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    expect(view.result.current.failure?.recovery).toBe('redraft');
    await act(async () => view.result.current.reserve({ fresh: true }));
    await settle();
    expect(api.createPledgeDraft.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-2']);
  });

  it('IDEMPOTENCY_KEY_REUSED retires the key', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(refusal(409, 'IDEMPOTENCY_KEY_REUSED'));
    api.createPledgeDraft.mockResolvedValueOnce(draft());
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    await act(async () => view.result.current.retry());
    await settle();
    expect(api.createPledgeDraft.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-2']);
  });

  it('Change what I chose keeps the key: an identical re-reserve sends the same one', async () => {
    api.createPledgeDraft.mockResolvedValue(draft());
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    await act(async () => view.result.current.startOver());
    expect(view.result.current.phase).toBe('selecting');
    expect(view.result.current.heldUntil).toBe('2030-01-01T00:05:00Z');
    await act(async () => view.result.current.reserve());
    await settle();
    expect(api.createPledgeDraft.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-1']);
  });

  it('refuses nothing and sends nothing while offline', async () => {
    const { view } = await mount({ initialRewardId: 'r1', online: false });
    await act(async () => view.result.current.reserve());
    await settle();
    expect(api.createPledgeDraft).not.toHaveBeenCalled();
    expect(view.result.current.phase).toBe('selecting');
  });

  it('carries REWARD_SOLD_OUT alternatives', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(
      refusal(409, 'REWARD_SOLD_OUT', { meta: { availableAlternatives: ['r9'] } }),
    );
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    expect(view.result.current.failure?.alternatives).toEqual(['r9']);
    expect(view.result.current.failure?.title).toBe(en.checkout.failures.codes.REWARD_SOLD_OUT.title);
  });
});

describe('useCheckout — payment hand-off', () => {
  async function reserved(overrides: Partial<CheckoutOptions> = {}) {
    api.createPledgeDraft.mockResolvedValue(draft());
    const mounted = await mount({ initialRewardId: 'r1', ...overrides });
    await act(async () => mounted.view.result.current.reserve());
    await settle();
    return mounted;
  }

  it('opens the provider page in an auth session and lands on the pledge', async () => {
    api.payForPledge.mockResolvedValue({ pledgeId: 'pl-1', providerTransactionId: 't', redirectUrl: 'https://pay/x' });
    browser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'ideanest://pledges/pl-1?payment=failed',
    });
    const { view, onPaid } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    expect(api.payForPledge).toHaveBeenCalledWith(
      'pl-1',
      {
        acknowledgedAgreementVersion: 3,
        language: 'en',
        successUrl: 'https://test.invalid/en/pledges/pl-1?payment=returned&via=app',
        errorUrl: 'https://test.invalid/en/pledges/pl-1?payment=failed&via=app',
      },
      'key-2',
    );
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith('https://pay/x', 'ideanest://pledges/pl-1');
    expect(onPaid).toHaveBeenCalledWith('pl-1', 'failed');
  });

  it('a dismissed browser keeps the reservation, reads the pledge once, and paying again reuses the key', async () => {
    api.payForPledge.mockResolvedValue({ pledgeId: 'pl-1', providerTransactionId: 't', redirectUrl: 'https://pay/x' });
    api.getPledge.mockResolvedValue(draft());
    const { view, onPaid } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    expect(api.getPledge).toHaveBeenCalledTimes(1);
    expect(view.result.current.phase).toBe('reserved');
    expect(onPaid).not.toHaveBeenCalled();
    await act(async () => view.result.current.pay());
    await settle();
    expect(api.payForPledge.mock.calls.map((call) => call[2])).toEqual(['key-2', 'key-2']);
  });

  it('a dismissed browser on a collected pledge goes to the pledge as returned', async () => {
    api.payForPledge.mockResolvedValue({ pledgeId: 'pl-1', providerTransactionId: 't', redirectUrl: 'https://pay/x' });
    api.getPledge.mockResolvedValue({ ...draft(), state: 'COLLECTED' });
    const { view, onPaid } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    expect(onPaid).toHaveBeenCalledWith('pl-1', 'returned');
  });

  it('a failure while paying returns to reserved; a redraft returns to selecting with no pledge', async () => {
    api.payForPledge.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { view } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    expect(view.result.current.phase).toBe('reserved');

    api.payForPledge.mockRejectedValueOnce(refusal(409, 'PLEDGE_MODIFIED'));
    await act(async () => view.result.current.retry());
    await settle();
    expect(view.result.current.phase).toBe('selecting');
    expect(view.result.current.pledge).toBeNull();
    expect(view.result.current.heldUntil).toBeNull();
  });

  it('RESERVATION_EXPIRED on pay retires both keys', async () => {
    api.payForPledge.mockRejectedValueOnce(refusal(409, 'RESERVATION_EXPIRED'));
    api.createPledgeDraft.mockResolvedValue(draft('pl-2'));
    const { view } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    await act(async () => view.result.current.reserve());
    await settle();
    expect(api.createPledgeDraft.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-3']);
  });

  it('AGREEMENT_REQUIRED asks for the agreement again and marks it stale', async () => {
    api.payForPledge.mockRejectedValueOnce(refusal(409, 'AGREEMENT_REQUIRED'));
    const { view, onAgreementRequired } = await reserved();
    await act(async () => view.result.current.pay());
    await settle();
    expect(onAgreementRequired).toHaveBeenCalledTimes(1);
    expect(view.result.current.agreementStale).toBe(true);
    expect(view.result.current.phase).toBe('reserved');
  });

  it('a 401 is the signed-out refusal', async () => {
    api.createPledgeDraft.mockReset();
    api.createPledgeDraft.mockRejectedValueOnce(new ApiError(401, null));
    const { view } = await mount({ initialRewardId: 'r1' });
    await act(async () => view.result.current.reserve());
    await settle();
    expect(view.result.current.failure?.status).toBe(401);
    expect(view.result.current.failure?.title).toBe(en.checkout.failures.signedOut.title);
  });
});

