import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import en from '@ideanest/messages/en.json';
import { announce } from '../../components/ui/announce';
import { setLocale } from '../../lib/locale';
import { setOnline } from '../../lib/connectivity';
import { shouldPersistQuery } from '../../lib/offline';
import { queryKeys } from '../../api/queries';
import { PricingScreen } from './pricing-screen';

/**
 * Pricing — issue #164: the subscription's four standings and the signed-out reader, the plan
 * cards' money, the from-submit return, the refusal map, the AppState re-read, offline, the fee
 * disclosure's three answers, and where a plan is chosen (on the web unless the build says
 * otherwise).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSession = { signedIn: true, locked: false, unlocked: false };
let mockInApp = false;

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/config', () => ({
  ...jest.requireActual('../../api/config'),
  inAppPlanChoice: () => mockInApp,
}));
jest.mock('../../components/ui/announce', () => ({ announce: jest.fn() }));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const P = en.pricing;
const PROJECT = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const starter = {
  id: 'plan-starter',
  code: 'STARTER',
  name: 'Starter',
  price: '0.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  maxActiveCampaigns: 1,
  goalCeiling: '5000.00',
  listed: true,
  sortOrder: 1,
  updatedAt: '2026-09-01T00:00:00Z',
};
const growth = {
  ...starter,
  id: 'plan-growth',
  code: 'GROWTH',
  name: 'Growth',
  description: 'For a second campaign',
  price: '19.00',
  maxActiveCampaigns: null,
  goalCeiling: null,
};
const yearly = { ...growth, id: 'plan-studio', code: 'STUDIO', name: 'Studio', price: '190.00', billingPeriod: 'YEARLY' };

function held(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    state: 'ACTIVE',
    entitled: true,
    plan: growth,
    price: '19.00',
    currency: 'AZN',
    billingPeriod: 'MONTHLY',
    currentPeriodEnd: '2026-11-14T10:00:00Z',
    cancelAtPeriodEnd: false,
    createdAt: '2026-10-14T10:00:00Z',
    ...overrides,
  };
}

const RATES = {
  configured: true,
  platformRate: '0.05000',
  processingRate: '0.02500',
  processingFixed: '0.3000',
  creatorReceivesRate: '0.92500',
  currency: 'AZN',
  effectiveFrom: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code?: string) =>
  new Response(JSON.stringify({ status, title: 'x', ...(code === undefined ? {} : { code }) }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

interface Request {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

let plans: () => Response;
let mine: () => Response;
let fees: () => Response;
let write: (request: Request) => Response;
let requests: Request[];
let client: QueryClient;

let appStateListeners: ((state: AppStateStatus) => void)[];

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    const entry = listener as (state: AppStateStatus) => void;
    appStateListeners.push(entry);
    return { remove: () => appStateListeners.splice(appStateListeners.indexOf(entry), 1) } as never;
  });
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
  mockInApp = false;
  plans = () => json({ plans: [starter, growth, yearly] });
  mine = () => json({ subscription: null });
  fees = () => json(RATES);
  write = () => json({ subscription: null });
  requests = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const request = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    requests.push(request);
    if (request.method !== 'GET') return write(request);
    if (url.pathname === '/v1/plans') return plans();
    if (url.pathname === '/v1/me/subscription') return mine();
    if (url.pathname === '/v1/fees/disclosure') return fees();
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client?.clear());

async function show(fromProjectId?: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <PricingScreen fromProjectId={fromProjectId} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const writes = () => requests.filter((request) => request.method !== 'GET');
const reads = (path: string) => requests.filter((request) => request.method === 'GET' && request.path === path);

describe('the plan cards', () => {
  it('prints prices from their decimal strings: free, a month, a year', async () => {
    await show();
    expect(screen.getByTestId('pricing-plan-STARTER')).toHaveTextContent(new RegExp(P.free));
    expect(screen.getByTestId('pricing-plan-STARTER')).not.toHaveTextContent(new RegExp(P.perMonth));
    expect(screen.getByTestId('pricing-plan-GROWTH')).toHaveTextContent(/19\.00 AZN/);
    expect(screen.getByTestId('pricing-plan-GROWTH')).toHaveTextContent(new RegExp(P.perMonth));
    expect(screen.getByTestId('pricing-plan-STUDIO')).toHaveTextContent(/190\.00 AZN/);
    expect(screen.getByTestId('pricing-plan-STUDIO')).toHaveTextContent(new RegExp(P.perYear));
  });

  it('states both limits, or that there is none', async () => {
    await show();
    const starterCard = screen.getByTestId('pricing-plan-STARTER');
    expect(starterCard).toHaveTextContent(/1 campaigns at a time/);
    expect(starterCard).toHaveTextContent(/Goals up to 5,000\.00 AZN/);
    const growthCard = screen.getByTestId('pricing-plan-GROWTH');
    expect(growthCard).toHaveTextContent(new RegExp(P.limits.campaignsUnlimited));
    expect(growthCard).toHaveTextContent(new RegExp(P.limits.goalUnlimited));
    expect(growthCard).toHaveTextContent(/For a second campaign/);
  });

  it('says the plans could not be loaded, with a retry — never "no plans on sale"', async () => {
    plans = () => problem(500);
    await show();
    expect(screen.getByTestId('pricing-plans-failed')).toHaveTextContent(new RegExp(P.unavailable));
    expect(screen.queryByTestId('pricing-empty')).toBeNull();

    plans = () => json({ plans: [growth] });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain })));
    await settle();
    expect(screen.getByTestId('pricing-plan-GROWTH')).toBeTruthy();
  });

  it('says so when nothing is on sale', async () => {
    plans = () => json({ plans: [] });
    await show();
    expect(screen.getByTestId('pricing-empty')).toHaveTextContent(P.empty);
  });

  it('keeps plans, the subscription and the fee terms out of the persisted cache', () => {
    for (const key of [queryKeys.plans(), queryKeys.mySubscription(), queryKeys.platformFeeDisclosure()]) {
      expect(shouldPersistQuery({ queryKey: key } as never)).toBe(false);
    }
  });
});

describe('what the reader holds', () => {
  it('shows a signed-out reader the prices and a way to sign in, without asking for a subscription', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show(PROJECT);
    expect(screen.getByTestId('pricing-signed-out')).toHaveTextContent(new RegExp(P.signedOut));
    expect(reads('/v1/me/subscription')).toHaveLength(0);
    expect(screen.getByTestId('pricing-plan-GROWTH')).toBeTruthy();

    fireEvent.press(screen.getByTestId('pricing-sign-in'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: `/pricing?from=submit&project=${PROJECT}` },
    });
  });

  it('reads a 401 as signed out, not as an error', async () => {
    mine = () => problem(401);
    await show();
    expect(screen.getByTestId('pricing-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('pricing-subscription-failed')).toBeNull();
  });

  it('names any other failure, with a retry', async () => {
    mine = () => problem(500);
    await show();
    expect(screen.getByTestId('pricing-subscription-failed')).toHaveTextContent(
      new RegExp(en.mobile.pricing.subscriptionUnavailable),
    );
  });

  it.each([
    ['pending', { state: 'PENDING_PAYMENT', entitled: false }, 'You chose Growth and we are waiting for your payment'],
    ['active', {}, 'You are on Growth until 14 November 2026'],
    ['ending', { cancelAtPeriodEnd: true }, 'Your Growth plan runs until 14 November 2026 and will not renew'],
    ['lapsed', { state: 'EXPIRED', entitled: false }, 'Your Growth plan ended on 14 November 2026'],
  ])('says where a %s holder stands', async (_name, overrides, sentence) => {
    mine = () => json({ subscription: held(overrides) });
    await show();
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(new RegExp(sentence));
  });

  it('explains what a pending plan is waiting for', async () => {
    mine = () => json({ subscription: held({ state: 'PENDING_PAYMENT', entitled: false }) });
    await show();
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(new RegExp(P.held.pendingBody));
  });

  it('marks the held plan on its card, unless it was cancelled', async () => {
    mine = () => json({ subscription: held() });
    await show();
    expect(screen.getByTestId('pricing-plan-GROWTH')).toHaveTextContent(new RegExp(P.held.currentTag));
    expect(screen.getByTestId('pricing-plan-STARTER')).not.toHaveTextContent(new RegExp(P.held.currentTag));
  });
});

describe('from a refused submission', () => {
  it('says why the creator is here and links back to the campaign', async () => {
    await show(PROJECT);
    expect(screen.getByTestId('pricing-from-submit')).toHaveTextContent(new RegExp(P.fromSubmit.title));
    fireEvent.press(screen.getByRole('button', { name: P.fromSubmit.back }));
    expect(mockPush).toHaveBeenCalledWith(`/campaigns/${PROJECT}/edit/review`);
  });

  it('says the plan is ready once one entitles them', async () => {
    mine = () => json({ subscription: held() });
    await show(PROJECT);
    expect(screen.getByTestId('pricing-from-submit')).toHaveTextContent(new RegExp(P.fromSubmit.ready));
    expect(screen.getByRole('button', { name: P.fromSubmit.resume })).toBeTruthy();
  });

  it('shows no banner to somebody who came from the navigation', async () => {
    await show();
    expect(screen.queryByTestId('pricing-from-submit')).toBeNull();
  });
});

describe('re-reading a pending plan when the app comes back', () => {
  async function becomeActive() {
    await act(async () => {
      for (const listener of [...appStateListeners]) listener('active');
    });
    await settle();
  }

  it('reads the subscription once per return, while a pending plan is held from a submission', async () => {
    mine = () => json({ subscription: held({ state: 'PENDING_PAYMENT', entitled: false }) });
    await show(PROJECT);
    const before = reads('/v1/me/subscription').length;

    await becomeActive();
    expect(reads('/v1/me/subscription')).toHaveLength(before + 1);
    await becomeActive();
    expect(reads('/v1/me/subscription')).toHaveLength(before + 2);
  });

  it('does not listen without a submission to return to, or without a pending plan', async () => {
    mine = () => json({ subscription: held({ state: 'PENDING_PAYMENT', entitled: false }) });
    await show();
    await becomeActive();
    expect(reads('/v1/me/subscription')).toHaveLength(1);

    client.clear();
    requests = [];
    mine = () => json({ subscription: held() });
    await show(PROJECT);
    await becomeActive();
    expect(reads('/v1/me/subscription')).toHaveLength(1);
  });
});

describe('choosing on the web (the default until the store-billing decision)', () => {
  it('offers no button on a card, and opens the web page instead', async () => {
    await show(PROJECT);
    expect(screen.queryByTestId('pricing-choose-GROWTH')).toBeNull();
    expect(screen.getByTestId('pricing-web-only')).toHaveTextContent(new RegExp(en.mobile.pricing.webOnly.title));

    await act(async () => fireEvent.press(screen.getByTestId('pricing-open-web')));
    await settle();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      `https://test.invalid/en/pricing?from=submit&project=${PROJECT}`,
    );
  });

  it('re-reads the subscription when the browser closes, and returns to the campaign once entitled', async () => {
    await show(PROJECT);
    mine = () => json({ subscription: held() });
    await act(async () => fireEvent.press(screen.getByTestId('pricing-open-web')));
    await settle();
    expect(mockReplace).toHaveBeenCalledWith(`/campaigns/${PROJECT}/edit/review`);
  });

  it('stays when the plan chosen on the web is still pending', async () => {
    await show(PROJECT);
    mine = () => json({ subscription: held({ state: 'PENDING_PAYMENT', entitled: false }) });
    await act(async () => fireEvent.press(screen.getByTestId('pricing-open-web')));
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(/waiting for your payment/);
  });

  it('offers no cancel in the app', async () => {
    mine = () => json({ subscription: held() });
    await show();
    expect(screen.queryByTestId('pricing-cancel')).toBeNull();
  });
});

describe('choosing in the app (with the flag on)', () => {
  beforeEach(() => {
    mockInApp = true;
  });

  it('names each choice by its plan and sends the plan id', async () => {
    write = () => json({ subscription: held() });
    await show();
    expect(screen.queryByTestId('pricing-web-only')).toBeNull();
    const pill = screen.getByTestId('pricing-choose-GROWTH');
    expect(pill.props.accessibilityLabel).toBe('Choose this plan: Growth');

    await act(async () => fireEvent.press(pill));
    await settle();
    expect(writes()).toEqual([{ method: 'POST', path: '/v1/me/subscription', body: { planId: 'plan-growth' } }]);
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(/You are on Growth/);
    expect(announce).toHaveBeenCalledWith('You are on Growth until 14 November 2026');
  });

  it('returns a creator from a submission to the campaign when the plan entitles them', async () => {
    write = () => json({ subscription: held({ plan: starter, price: '0.00' }) });
    await show(PROJECT);
    await act(async () => fireEvent.press(screen.getByTestId('pricing-choose-STARTER')));
    await settle();
    expect(mockReplace).toHaveBeenCalledWith(`/campaigns/${PROJECT}/edit/review`);
  });

  it('never sends anybody on for a plan that is pending payment', async () => {
    write = () => json({ subscription: held({ state: 'PENDING_PAYMENT', entitled: false }) });
    await show(PROJECT);
    await act(async () => fireEvent.press(screen.getByTestId('pricing-choose-GROWTH')));
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(/waiting for your payment/);
  });

  it('disables every choice while a plan is held', async () => {
    mine = () => json({ subscription: held() });
    await show();
    expect(screen.getByTestId('pricing-choose-STARTER')).toBeDisabled();
    expect(screen.getByTestId('pricing-choose-GROWTH')).toBeDisabled();
  });

  it.each([
    ['ALREADY_SUBSCRIBED', problem(409, 'ALREADY_SUBSCRIBED'), P.errors.alreadySubscribed],
    ['PLAN_NOT_ON_SALE', problem(409, 'PLAN_NOT_ON_SALE'), P.errors.notOnSale],
    ['a 401', problem(401), P.errors.signedOut],
    ['anything else', problem(500, 'SOMETHING_ELSE'), P.errors.generic],
  ])('maps %s to its sentence', async (_name, response, sentence) => {
    write = () => response;
    await show();
    await act(async () => fireEvent.press(screen.getByTestId('pricing-choose-GROWTH')));
    await settle();
    expect(screen.getByTestId('pricing-refusal')).toHaveTextContent(new RegExp(sentence.replace(/\./g, '\\.')));
  });

  it('cancels at the end of the period', async () => {
    mine = () => json({ subscription: held() });
    write = () => json({ subscription: held({ cancelAtPeriodEnd: true }) });
    await show();
    await act(async () => fireEvent.press(screen.getByTestId('pricing-cancel')));
    await settle();
    expect(writes()).toEqual([{ method: 'DELETE', path: '/v1/me/subscription', body: undefined }]);
    expect(screen.getByTestId('pricing-held-standing')).toHaveTextContent(/will not renew/);
    expect(screen.queryByTestId('pricing-cancel')).toBeNull();
  });

  it('sends nothing offline, and says why', async () => {
    mine = () => json({ subscription: held({ state: 'CANCELED', entitled: false }) });
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('pricing-offline')).toHaveTextContent(new RegExp(en.mobile.pricing.offline));
    const pill = screen.getByTestId('pricing-choose-GROWTH');
    expect(pill).toBeDisabled();
    await act(async () => fireEvent.press(pill));
    expect(writes()).toHaveLength(0);
  });
});

describe("the creator's fee disclosure", () => {
  it('states the rates, the fixed fee and that they are two fees', async () => {
    await show();
    const disclosure = screen.getByTestId('fee-disclosure');
    expect(disclosure).toHaveTextContent(/IdeyaNest keeps 5% of every pledge collected/);
    expect(disclosure).toHaveTextContent(/keeps 2\.5%, so you receive 92\.5%/);
    expect(disclosure).toHaveTextContent(/0\.30 AZN per transaction/);
    expect(screen.getByTestId('fee-disclosure-two-fees')).toBeTruthy();
  });

  it('leaves the fixed fee out when it is zero', async () => {
    fees = () => json({ ...RATES, processingFixed: '0.0000' });
    await show();
    expect(screen.getByTestId('fee-disclosure')).not.toHaveTextContent(/per transaction/);
  });

  it('says nothing is deducted only when the service said nothing is configured', async () => {
    fees = () =>
      json({ configured: false, platformRate: null, processingRate: null, processingFixed: null, creatorReceivesRate: null, currency: null, effectiveFrom: null });
    await show();
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/nothing is being deducted/);
  });

  it('never says nothing is deducted when the read failed, and retries from its link', async () => {
    fees = () => problem(500);
    await show();
    const disclosure = screen.getByTestId('fee-disclosure');
    expect(disclosure).toHaveTextContent(/This does not mean that no fee is charged/);
    expect(disclosure).not.toHaveTextContent(/nothing is being deducted/);

    const before = reads('/v1/fees/disclosure').length;
    fees = () => json(RATES);
    await act(async () => fireEvent.press(screen.getByText('Plans and pricing')));
    await settle();
    expect(reads('/v1/fees/disclosure')).toHaveLength(before + 1);
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/you receive 92\.5%/);
  });
});
