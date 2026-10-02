import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { PledgeResponse, PublicReward, PublicRewardList } from '@ideanest/checkout/types';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { colors } from '../../theme';
import { setLocale } from '../../lib/locale';
import * as checkoutApi from './api';
import { CheckoutScreen, backActionFor } from './checkout-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock('./api', () => ({
  getCheckoutRewards: jest.fn(),
  getBackerAgreementVersion: jest.fn(),
  getFeeDisclosure: jest.fn(),
  createPledgeDraft: jest.fn(),
  payForPledge: jest.fn(),
  getPledge: jest.fn(),
}));

jest.setTimeout(30_000);

const api = jest.mocked(checkoutApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

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
  rewards: [
    tier('r1', '45.00', { limitQuantity: 10, remainingQuantity: 4 }),
    tier('r2', '10.00', { limitQuantity: 5, remainingQuantity: 0 }),
    tier('r3', '60.00', {
      shippingType: 'DOMESTIC',
      shippingRates: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: null }],
    }),
  ],
  addons: [tier('a1', '5.00', { remainingQuantity: 2 })],
};

function draft(): PledgeResponse {
  const zero = { amount: '0.00', currency: 'AZN' };
  return {
    id: 'pl-1',
    projectId: 'p1',
    state: 'DRAFT',
    rewardTierId: 'r1',
    addons: [],
    amounts: { base: { amount: '45.00', currency: 'AZN' }, addons: zero, bonus: zero, shipping: zero, tax: zero, total: { amount: '45.00', currency: 'AZN' } },
    isAnonymous: false,
    reservationExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    cardVerified: false,
    latePledge: false,
    supplements: [],
  };
}

let client: QueryClient;

type Node = { props?: { style?: unknown }; children?: unknown[] } | null;

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
}

function limeSurfaces(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + limeSurfaces(child), 0);
  if (typeof node !== 'object' || node === null) return 0;
  const element = node as Node;
  const own = flat(element?.props?.style).backgroundColor === colors.lime500 ? 1 : 0;
  return own + limeSurfaces(element?.children ?? []);
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(props: { initialRewardId?: string | null; tokens?: readonly string[] } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <CheckoutScreen projectId="p1" initialRewardId={props.initialRewardId ?? null} tokens={props.tokens ?? []} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

async function reserve() {
  await fireEvent.press(screen.getByTestId('reserve'));
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  api.getCheckoutRewards.mockResolvedValue(CATALOGUE);
  api.getBackerAgreementVersion.mockResolvedValue(3);
  api.getFeeDisclosure.mockResolvedValue({
    configured: true,
    platformRate: '0.05',
    processingRate: '0.025',
    processingFixed: null,
    currency: 'AZN',
  });
  api.createPledgeDraft.mockResolvedValue(draft());
});

afterEach(() => client.clear());

describe('checkout step 1', () => {
  it('offers no reward first, then the tiers as radios, with sold out disabled and said', async () => {
    await show();
    expect(screen.getByTestId('checkout-step')).toHaveTextContent(en.checkout.steps.choose);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAccessibleName(en.checkout.reward.none);
    expect(screen.getByTestId('reward-option-r2')).toBeDisabled();
    expect(screen.getByTestId('reward-option-r2')).toHaveAccessibleName(/Sold out/);
    expect(screen.getByText('4 of 10 left')).toBeTruthy();
  });

  it('pre-selects ?reward= and forwards every token', async () => {
    await show({ initialRewardId: 'r1', tokens: ['t1', 't2'] });
    expect(screen.getByTestId('reward-option-r1')).toBeChecked();
    expect(screen.getByTestId('contribution').props.value).toBe('45.00');
    expect(api.getCheckoutRewards).toHaveBeenCalledWith('p1', ['t1', 't2'], expect.anything());
  });

  it('asks for a choice before reserving', async () => {
    await show();
    await reserve();
    expect(screen.getByTestId('choose-one')).toBeTruthy();
    expect(api.createPledgeDraft).not.toHaveBeenCalled();
  });

  it('reads a decimal-pad comma as the point, and refuses an amount below the tier price', async () => {
    await show({ initialRewardId: 'r1' });
    await fireEvent.changeText(screen.getByTestId('contribution'), '45,50');
    expect(screen.getByTestId('contribution').props.value).toBe('45.50');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('45.50 AZN');
    await fireEvent.changeText(screen.getByTestId('contribution'), '40');
    expect(screen.getByText('This reward costs 45.00 AZN. Give that or more, or choose a cheaper reward.')).toBeTruthy();
  });

  it('asks where to post a posted reward, from the countries it is priced for', async () => {
    await show({ initialRewardId: 'r3' });
    expect(screen.getByTestId('destination')).toBeTruthy();
    await reserve();
    expect(screen.getByText(en.checkout.errors.destinationMissing)).toBeTruthy();
    expect(api.createPledgeDraft).not.toHaveBeenCalled();
  });

  it('gives each add-on a named stepper with a value and range', async () => {
    await show({ initialRewardId: 'r1' });
    const stepper = screen.getByTestId('addon-quantity-a1');
    expect(stepper.props.accessibilityValue).toEqual({ min: 0, max: 2, now: 0 });
    await fireEvent.press(screen.getByLabelText('Add one: Tier a1'));
    await fireEvent.press(screen.getByLabelText('Add one: Tier a1'));
    expect(screen.getByTestId('addon-quantity-a1').props.accessibilityValue.now).toBe(2);
    expect(screen.getByTestId('addon-increase-a1')).toBeDisabled();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('55.00 AZN');
  });

  it('disables reserving offline and says so, sending nothing', async () => {
    await show({ initialRewardId: 'r1' });
    await act(async () => setOnline(false));
    expect(screen.getByTestId('checkout-offline')).toBeTruthy();
    expect(screen.getByTestId('reserve')).toBeDisabled();
  });

  it('drops the destination from the summary once nothing is posted', async () => {
    await show({ initialRewardId: 'r3' });
    await fireEvent.press(screen.getByTestId('destination'));
    await fireEvent.press(screen.getByText('Azerbaijan'));
    expect(screen.getByTestId('pledge-summary')).toHaveTextContent(/Delivered to Azerbaijan/);
    await fireEvent.press(screen.getByTestId('reward-option-r1'));
    expect(screen.getByTestId('pledge-summary')).not.toHaveTextContent(/Delivered to/);
  });

  it('says nothing about fees until they have loaded', async () => {
    api.getFeeDisclosure.mockReturnValue(new Promise(() => undefined));
    await show();
    expect(screen.queryByTestId('fee-disclosure')).toBeNull();
  });

  it('shows the fee disclosure with percentages', async () => {
    await show();
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/keeps 5% and the payment provider keeps 2\.5%/);
  });
});

describe('checkout step 2', () => {
  it('moves focus to the step heading and shows server amounts with one accent action', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await show({ initialRewardId: 'r1' });
    await reserve();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(screen.getByTestId('checkout-step')).toHaveTextContent(en.checkout.steps.review);
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    expect(screen.getByTestId('summary-quoted')).toBeTruthy();
    expect(screen.queryByTestId('summary-preview')).toBeNull();
    expect(limeSurfaces(screen.toJSON())).toBe(1);
    expect(screen.getByTestId('confirm')).toHaveAccessibleName(en.checkout.risk.confirm);
    expect(screen.getByTestId('reservation-clock')).toHaveTextContent(/held for [45]:\d\d/);
    focus.mockRestore();
  });

  it('disables confirm and offers to reserve again once the hold has ended', async () => {
    api.createPledgeDraft.mockResolvedValue({ ...draft(), reservationExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await show({ initialRewardId: 'r1' });
    await reserve();
    expect(screen.getByTestId('reservation-expired')).toBeTruthy();
    expect(screen.getByTestId('confirm')).toBeDisabled();
  });

  it('Change what I chose returns to step 1', async () => {
    await show({ initialRewardId: 'r1' });
    await reserve();
    await fireEvent.press(screen.getByTestId('change'));
    expect(screen.getByTestId('checkout-step')).toHaveTextContent(en.checkout.steps.choose);
  });

  it('asks before closing while a reward is held', async () => {
    await show({ initialRewardId: 'r1' });
    await reserve();
    await fireEvent.press(screen.getByTestId('checkout-close'));
    expect(screen.getByText(en.mobile.checkout.leaveTitle)).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('leave'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('the Android back button', () => {
  it('leaves freely with nothing held, asks while a reward is held, and never leaves mid-request', () => {
    expect(backActionFor(false, 0)).toBe('leave');
    expect(backActionFor(false, 120_000)).toBe('ask');
    expect(backActionFor(true, 120_000)).toBe('block');
    expect(backActionFor(true, 0)).toBe('block');
  });
});

describe('checkout refusals', () => {
  it('a 401 offers sign-in that returns to this checkout with its reward and tokens', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(new ApiError(401, null));
    await show({ initialRewardId: 'r1', tokens: ['t1'] });
    await reserve();
    expect(screen.getByText(en.checkout.failures.signedOut.title)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('failure-sign-in'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/campaigns/p1/back?reward=r1&token=t1' },
    });
  });

  it('PLEDGE_ALREADY_EXISTS links to the pledge the backer already has', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(
      new ApiError(409, { type: 'about:blank', title: 'x', status: 409, code: 'PLEDGE_ALREADY_EXISTS', meta: { pledgeId: 'pl-9' } }),
    );
    await show({ initialRewardId: 'r1' });
    await reserve();
    await fireEvent.press(screen.getByTestId('failure-open-pledge'));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/pledges/[id]', params: { id: 'pl-9' } });
  });

  it('REWARD_SOLD_OUT offers the alternatives as pills that select them', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(
      new ApiError(409, {
        type: 'about:blank',
        title: 'x',
        status: 409,
        code: 'REWARD_SOLD_OUT',
        meta: { availableAlternatives: ['r3'] },
      }),
    );
    await show({ initialRewardId: 'r1' });
    await reserve();
    expect(screen.getByText(en.checkout.failures.codes.REWARD_SOLD_OUT.title)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('alternative-r3'));
    expect(screen.getByTestId('reward-option-r3')).toBeChecked();
  });

  it('a network failure offers Try again', async () => {
    api.createPledgeDraft.mockRejectedValueOnce(new TypeError('Network request failed'));
    await show({ initialRewardId: 'r1' });
    await reserve();
    await fireEvent.press(screen.getByTestId('failure-try-again'));
    await settle();
    expect(api.createPledgeDraft).toHaveBeenCalledTimes(2);
    expect(api.createPledgeDraft.mock.calls[0]?.[1]).toBe(api.createPledgeDraft.mock.calls[1]?.[1]);
  });

  it('cannot open without the backer agreement', async () => {
    api.getBackerAgreementVersion.mockRejectedValue(new TypeError('Network request failed'));
    await show();
    expect(screen.getByText(en.checkout.agreementUnavailable.title)).toBeTruthy();
  });
});

describe('checkout source rules', () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')] as const);

  it('does no number arithmetic on money', () => {
    for (const [name, source] of sources) {
      expect([name, /parseFloat\(|Number\(|parseInt\(/.test(source)]).toEqual([name, false]);
    }
  });

  it('has no motion', () => {
    for (const [name, source] of sources) {
      expect([name, /\bentering=|\bexiting=|\blayout=\{|FadeUp|react-native-reanimated/.test(source)]).toEqual([name, false]);
    }
  });
});
