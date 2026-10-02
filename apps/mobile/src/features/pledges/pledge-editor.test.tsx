import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { PledgeResponse, PublicReward, PublicRewardList } from '@ideanest/checkout/types';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { colors } from '../../theme';
import * as checkoutApi from '../checkout/api';
import * as pledgeApi from './api';
import { PledgeEditor } from './pledge-editor';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../checkout/api', () => ({
  ...jest.requireActual('../checkout/api'),
  getCheckoutRewards: jest.fn(),
}));
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  editPledge: jest.fn(),
  raisePledge: jest.fn(),
}));

jest.setTimeout(30_000);

const rewards = jest.mocked(checkoutApi);
const api = jest.mocked(pledgeApi);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const money = (amount: string) => ({ amount, currency: 'AZN' });

function tier(id: string, price: string, extra: Partial<PublicReward> = {}): PublicReward {
  return {
    id,
    title: `Tier ${id}`,
    price: money(price),
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
    tier('r1', '40.00'),
    tier('r2', '60.00', {
      shippingType: 'DOMESTIC',
      shippingRates: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: null }],
    }),
    tier('r3', '20.00', { limitQuantity: 5, remainingQuantity: 0 }),
  ],
  addons: [tier('a1', '5.00')],
};

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
    cardVerified: false,
    latePledge: false,
    supplements: [],
    ...extra,
  };
}

let client: QueryClient;

type Node = { props?: { style?: unknown; accessibilityRole?: string }; children?: unknown[] } | null;

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
}

function limeSurfaces(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + limeSurfaces(child), 0);
  if (typeof node !== 'object' || node === null) return 0;
  const element = node as Node;
  const own =
    element?.props?.accessibilityRole === 'button' && flat(element.props.style).backgroundColor === colors.lime500 ? 1 : 0;
  return own + limeSurfaces(element?.children ?? []);
}
let minted: number;
const onSaved = jest.fn();
const onReload = jest.fn();
const onRaiseReturned = jest.fn();

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(current: PledgeResponse = pledge(), mode: 'edit' | 'raise' = 'edit', disabled = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <PledgeEditor
            pledge={current}
            mode={mode}
            disabled={disabled}
            onSaved={onSaved}
            onReload={onReload}
            onRaiseReturned={onRaiseReturned}
            mintKey={() => `key-${(minted += 1)}`}
          />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

async function type(value: string) {
  await fireEvent.changeText(screen.getByTestId('editor-contribution'), value);
}

async function save() {
  await fireEvent.press(screen.getByTestId('editor-save'));
  await settle();
}

const key = (call: number) => api.editPledge.mock.calls[call]?.[2];

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  minted = 0;
  rewards.getCheckoutRewards.mockResolvedValue(CATALOGUE);
});

describe('the edit', () => {
  it('is seeded from the pledge, shows its figures and cannot be saved unchanged', async () => {
    await show();

    expect(screen.getByTestId('editor-contribution').props.value).toBe('45.00');
    expect(screen.getByTestId('summary-quoted')).toBeTruthy();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('45.00 AZN');
    expect(screen.getByTestId('editor-save')).toBeDisabled();
    expect(screen.getByTestId('editor-no-changes')).toBeTruthy();
  });

  it('sends only the contribution, as a string, and adopts the whole answer', async () => {
    const answer = pledge({ amounts: { ...pledge().amounts, bonus: money('20.00'), total: money('60.00') } });
    api.editPledge.mockResolvedValue(answer);
    await show();
    await type('60');

    expect(screen.getByTestId('summary-preview')).toBeTruthy();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('60.00 AZN');
    await save();

    expect(api.editPledge).toHaveBeenCalledWith('pl-1', { contribution: money('60.00') }, 'key-1');
    expect(onSaved).toHaveBeenCalledWith(answer);
    expect(screen.getByTestId('editor-saved')).toBeTruthy();
  });

  it('drops the reward with rewardTierId null', async () => {
    api.editPledge.mockResolvedValue(pledge());
    await show();
    await fireEvent.press(screen.getByTestId('reward-option-none'));
    await save();

    expect(api.editPledge.mock.calls[0]?.[1]).toEqual({ rewardTierId: null });
  });

  it('sends the whole add-on list when one changes, and the destination a posted reward needs', async () => {
    api.editPledge.mockResolvedValue(pledge());
    await show(pledge({ addons: [{ rewardTierId: 'a1', quantity: 1 }] }));
    await fireEvent.press(screen.getByTestId('addon-increase-a1'));
    await save();

    expect(api.editPledge.mock.calls[0]?.[1]).toEqual({ addons: [{ rewardTierId: 'a1', quantity: 2 }] });
  });

  it('previews an added add-on on a posted reward from client prices, labelled as such', async () => {
    await show(
      pledge({
        rewardTierId: 'r2',
        shippingCountry: 'AZ',
        amounts: {
          base: money('60.00'),
          addons: money('0.00'),
          bonus: money('0.00'),
          shipping: money('5.00'),
          tax: money('0.00'),
          total: money('65.00'),
        },
      }),
    );
    expect(screen.getByTestId('editor-destination')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addon-increase-a1'));

    expect(screen.getByTestId('summary-preview')).toBeTruthy();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('70.00 AZN');
  });

  it('never shows server figures as a preview when the selection cannot be priced', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('reward-option-r2'));
    await type('60');

    expect(screen.queryByTestId('summary-preview')).toBeNull();
    expect(screen.queryByTestId('summary-quoted')).toBeNull();
    expect(screen.getByTestId('editor-save')).toBeEnabled();
  });

  it('retries a dropped request with the same key, and a different edit with a new one', async () => {
    api.editPledge.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue(pledge());
    await show();
    await type('50');
    await save();
    expect(screen.getByTestId('editor-failure')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('editor-try-again'));
    await settle();
    expect(key(1)).toBe(key(0));

    await type('55');
    await save();
    expect(key(2)).not.toBe(key(0));
  });

  it('never replays an edit sent again after it succeeded', async () => {
    api.editPledge.mockResolvedValue(pledge());
    await show();
    await fireEvent.press(screen.getByTestId('editor-anonymous'));
    await save();
    await save();

    expect(api.editPledge).toHaveBeenCalledTimes(2);
    expect(api.editPledge.mock.calls[0]?.[1]).toEqual({ isAnonymous: true });
    expect(key(1)).not.toBe(key(0));
  });

  it('retires a reused key so the next attempt mints another', async () => {
    api.editPledge
      .mockRejectedValueOnce(new ApiError(409, { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }))
      .mockResolvedValue(pledge());
    await show();
    await type('50');
    await save();
    await fireEvent.press(screen.getByTestId('editor-try-again'));
    await settle();

    expect(key(1)).not.toBe(key(0));
  });

  it('waits out a request still in progress with the same key, at most three times', async () => {
    const busy = new ApiError(409, { status: 409, code: 'IDEMPOTENT_REQUEST_IN_PROGRESS', retryAfterSeconds: 0 });
    api.editPledge.mockRejectedValue(busy);
    await show();
    await type('50');
    await save();
    await settle();

    expect(api.editPledge).toHaveBeenCalledTimes(4);
    expect(new Set(api.editPledge.mock.calls.map((call) => call[2])).size).toBe(1);
  });

  it.each([
    ['PLEDGE_DECREASE_NOT_ALLOWED'],
    ['PROJECT_NOT_LIVE'],
    ['PLEDGE_NOT_EDITABLE'],
    ['PLEDGE_NOT_FOUND'],
    ['REWARD_NOT_FOUND'],
    ['PLEDGE_CANNOT_BE_CANCELLED'],
  ] as const)('words %s from the catalogue', async (code) => {
    api.editPledge.mockRejectedValue(new ApiError(409, { status: 409, code }));
    await show();
    await type('50');
    await save();

    expect(screen.getByTestId('editor-failure')).toHaveTextContent(new RegExp(en.checkout.failures.codes[code].title));
  });

  it.each([['IDEMPOTENCY_KEY_REQUIRED'], ['IDEMPOTENCY_KEY_INVALID']] as const)(
    'offers no retry for the client bug %s',
    async (code) => {
      api.editPledge.mockRejectedValue(new ApiError(400, { status: 400, code }));
      await show();
      await type('50');
      await save();

      expect(screen.getByTestId('editor-failure')).toBeTruthy();
      expect(screen.queryByTestId('editor-try-again')).toBeNull();
    },
  );

  it('puts an unpriced destination under the field', async () => {
    api.editPledge.mockRejectedValue(new ApiError(422, { status: 422, code: 'SHIPPING_DESTINATION_UNPRICED' }));
    await show(
      pledge({
        rewardTierId: 'r2',
        shippingCountry: 'AZ',
        amounts: {
          base: money('60.00'),
          addons: money('0.00'),
          bonus: money('0.00'),
          shipping: money('5.00'),
          tax: money('0.00'),
          total: money('65.00'),
        },
      }),
    );
    await type('70');
    await save();

    expect(
      screen.getAllByText(en.checkout.failures.codes.SHIPPING_DESTINATION_UNPRICED.detail).length,
    ).toBeGreaterThan(1);
  });

  it('reloads the pledge when it changed underneath the edit', async () => {
    api.editPledge.mockRejectedValue(new ApiError(409, { status: 409, code: 'PLEDGE_MODIFIED' }));
    await show();
    await type('50');
    await save();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('puts a refused contribution under the field', async () => {
    api.editPledge.mockRejectedValue(
      new ApiError(422, { status: 422, code: 'CONTRIBUTION_BELOW_REWARD_PRICE', detail: 'Too low.' }),
    );
    await show();
    await type('41');
    await save();

    expect(
      screen.getAllByText(en.checkout.failures.codes.CONTRIBUTION_BELOW_REWARD_PRICE.detail).length,
    ).toBeGreaterThan(0);
  });

  it('offers the alternatives when a tier sold out', async () => {
    api.editPledge.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'REWARD_SOLD_OUT', meta: { availableAlternatives: ['r2'] } }),
    );
    await show();
    await type('50');
    await save();

    await fireEvent.press(screen.getByTestId('editor-alternative-r2'));
    expect(screen.getByTestId('reward-option-r2').props.accessibilityState.checked).toBe(true);
  });

  it('reloads the pledge when its reservation expired', async () => {
    api.editPledge.mockRejectedValue(new ApiError(409, { status: 409, code: 'RESERVATION_EXPIRED' }));
    await show(pledge({ state: 'DRAFT' }));
    await type('50');
    await save();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('asks a signed-out backer to sign in and come back', async () => {
    api.editPledge.mockRejectedValue(new ApiError(401, { status: 401 }));
    await show();
    await type('50');
    await save();
    await fireEvent.press(screen.getByTestId('editor-sign-in'));

    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/pledges/pl-1' } });
  });

  it('sends nothing offline', async () => {
    await show(pledge(), 'edit', true);
    await type('50');

    expect(screen.getByTestId('editor-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect(api.editPledge).not.toHaveBeenCalled();
  });

  it('has exactly one lime control, Save', async () => {
    await show();
    await type('50');
    expect(limeSurfaces(screen.toJSON())).toBe(1);
  });
});

describe('the raise', () => {
  const paid = () => pledge({ state: 'COLLECTED', raisable: true });
  const opened = {
    pledgeId: 'pl-1',
    raiseId: 'r',
    amount: money('5.00'),
    total: money('50.00'),
    holdExpiresAt: '2026-10-02T12:00:00Z',
    providerTransactionId: 'x',
    redirectUrl: 'https://pay.example/r',
  };
  const raiseKey = (call: number) => api.raisePledge.mock.calls[call]?.[2];
  const pay = async () => {
    await fireEvent.press(screen.getByTestId('editor-raise'));
    await settle();
  };

  it('retries a dropped raise with the same key, and a different amount with a new one', async () => {
    api.raisePledge.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue(opened);
    await show(paid(), 'raise');
    await type('50');
    await pay();
    await fireEvent.press(screen.getByTestId('editor-try-again'));
    await settle();
    expect(raiseKey(1)).toBe(raiseKey(0));

    await type('55');
    await pay();
    expect(raiseKey(2)).not.toBe(raiseKey(0));
    expect(api.raisePledge.mock.calls[2]?.[1]).toMatchObject({ expectedAmount: money('10.00') });
  });

  it('starts a fresh payment for the same raise once the last one came back', async () => {
    api.raisePledge.mockResolvedValue(opened);
    await show(paid(), 'raise');
    await type('50');
    await pay();
    await pay();

    expect(raiseKey(1)).not.toBe(raiseKey(0));
  });

  it.each([['RAISE_AMOUNT_CHANGED'], ['PLEDGE_RAISE_IN_PROGRESS'], ['PLEDGE_NOT_RAISABLE']] as const)(
    'words %s from the catalogue',
    async (code) => {
      api.raisePledge.mockRejectedValue(new ApiError(409, { status: 409, code }));
      await show(paid(), 'raise');
      await type('50');
      await pay();

      expect(screen.getByTestId('editor-failure')).toHaveTextContent(new RegExp(en.checkout.failures.codes[code].title));
    },
  );

  it('reloads the pledge when the difference changed', async () => {
    api.raisePledge.mockRejectedValue(new ApiError(409, { status: 409, code: 'RAISE_AMOUNT_CHANGED' }));
    await show(paid(), 'raise');
    await type('50');
    await pay();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('puts RAISE_NOT_AN_INCREASE under the contribution', async () => {
    api.raisePledge.mockRejectedValue(new ApiError(409, { status: 409, code: 'RAISE_NOT_AN_INCREASE' }));
    await show(paid(), 'raise');
    await type('50');
    await pay();

    expect(screen.getAllByText(en.checkout.failures.codes.RAISE_NOT_AN_INCREASE.detail).length).toBeGreaterThan(1);
  });

  it.each([['edit'], ['raise']] as const)('offers nothing that cancels or withdraws in %s mode', async (mode) => {
    await show(mode === 'raise' ? paid() : pledge(), mode);
    await type('50');

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(String(control.props.accessibilityLabel ?? '')).not.toMatch(/cancel|withdraw/i);
      expect(within(control).queryByText(/cancel|withdraw/i)).toBeNull();
    }
  });

  it('offers only an increase, priced as the difference, without the anonymity box', async () => {
    await show(paid(), 'raise');

    expect(screen.queryByTestId('editor-anonymous')).toBeNull();
    expect(screen.getByTestId('editor-raise')).toBeDisabled();
    await type('44');
    expect(screen.getByTestId('editor-not-higher')).toBeTruthy();
    expect(screen.getByTestId('editor-raise')).toBeDisabled();

    await type('50.50');
    expect(screen.getByTestId('editor-due')).toHaveTextContent(/5\.50/);
    expect(screen.getByTestId('editor-raise')).toBeEnabled();
  });

  it('pays the difference on the provider page and reports the return', async () => {
    api.raisePledge.mockResolvedValue({
      pledgeId: 'pl-1',
      raiseId: 'r',
      amount: money('5.00'),
      total: money('50.00'),
      holdExpiresAt: '2026-10-02T12:00:00Z',
      providerTransactionId: 'x',
      redirectUrl: 'https://pay.example/r',
    });
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
      type: 'success',
      url: 'ideanest://pledges/pl-1?raise=returned',
    });
    await show(paid(), 'raise');
    await type('50');
    await fireEvent.press(screen.getByTestId('editor-raise'));
    await settle();

    const [id, body, idempotencyKey] = api.raisePledge.mock.calls[0] ?? [];
    expect(id).toBe('pl-1');
    expect(body).toMatchObject({
      contribution: money('50.00'),
      expectedAmount: money('5.00'),
      language: 'en',
    });
    expect(body?.successUrl).toMatch(/\/en\/pledges\/pl-1\?raise=returned&via=app$/);
    expect(body?.errorUrl).toMatch(/\?raise=failed&via=app$/);
    expect(idempotencyKey).toBe('key-1');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://pay.example/r', 'ideanest://pledges/pl-1');
    expect(onRaiseReturned).toHaveBeenCalledWith('returned');
  });

  it('reads the pledge again when the payment page is dismissed', async () => {
    api.raisePledge.mockResolvedValue({
      pledgeId: 'pl-1',
      raiseId: 'r',
      amount: money('5.00'),
      total: money('50.00'),
      holdExpiresAt: '2026-10-02T12:00:00Z',
      providerTransactionId: 'x',
      redirectUrl: 'https://pay.example/r',
    });
    await show(paid(), 'raise');
    await type('50');
    await fireEvent.press(screen.getByTestId('editor-raise'));
    await settle();

    expect(onRaiseReturned).toHaveBeenCalledWith(null);
  });

  it('holds the button while an earlier raise is pending, and offers to continue it', async () => {
    const hold = new Date(Date.now() + 600_000).toISOString();
    await show(
      pledge({
        state: 'COLLECTED',
        raisable: true,
        latestRaise: {
          id: 'r',
          state: 'PENDING',
          amount: money('5.00'),
          total: money('50.00'),
          holdExpiresAt: hold,
          createdAt: new Date().toISOString(),
          resumeUrl: 'https://pay.example/resume',
        },
      }),
      'raise',
    );
    await type('50');

    expect(screen.getByTestId('editor-in-flight')).toBeTruthy();
    expect(screen.getByTestId('editor-raise')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('editor-resume'));
    await settle();
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://pay.example/resume', 'ideanest://pledges/pl-1');
  });
});
