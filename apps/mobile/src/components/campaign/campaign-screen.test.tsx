import type { ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import type { TestInstance } from 'test-renderer';
import { FadeInDown } from 'react-native-reanimated';
import en from '@ideanest/messages/en.json';
import { formatMoney } from '@ideanest/money';
import type { ProjectPage, PublicRewards } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { colors, spacing, staggerDelay } from '../../theme';
import { MotionBudgetProvider, haptics } from '../ui';
import { CampaignScreen } from './campaign-screen';

/**
 * The campaign screen — issue #155: blocks 1–14 by state, the tabs, and the three ways the page
 * can fail to be one (not found, an error with nothing cached, offline with a cache).
 *
 * <p>The reads are real — TanStack Query over the app's own client — and only `fetch` is a double,
 * so the not-found screen is reached by the service's 404 and not by a mocked hook.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));

jest.setTimeout(30_000);

const C = en.campaign;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date();

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function page(state: string, overrides: Partial<ProjectPage> = {}): ProjectPage {
  return {
    id: ID,
    slug: 'solar-lamp',
    state,
    title: 'Solar Lamp',
    blurb: 'A lamp that charges in the sun.',
    creator: { slug: 'aysel', name: 'Aysel' },
    category: { slug: 'design', name: 'Design' },
    coverImage: { url: 'https://cdn.example/lamp.jpg', width: 1600, height: 900 },
    goal: { amount: '1000.00', currency: 'AZN' },
    pledged: { amount: '420.00', currency: 'AZN' },
    backersCount: 3,
    deadline: new Date(NOW.getTime() + 3 * DAY + 2 * HOUR).toISOString(),
    ...overrides,
  };
}

const OUTCOME = {
  goal: { amount: '1000.00', currency: 'AZN' },
  pledged: { amount: '1240.00', currency: 'AZN' },
  backersCount: 31,
  finalisedAt: '2026-08-01T10:00:00Z',
};
const PAST = new Date(NOW.getTime() - 10 * DAY).toISOString();

const REWARDS: PublicRewards = {
  currency: 'AZN',
  rewards: [
    {
      id: 'tier-1',
      title: 'Early lamp',
      description: 'One lamp.',
      price: { amount: '25.00', currency: 'AZN' },
      remainingQuantity: 5,
    },
    {
      id: 'tier-2',
      title: 'Two lamps',
      price: { amount: '45.00', currency: 'AZN' },
      remainingQuantity: 0,
    },
    { id: 'tier-3', title: 'Thanks', price: { amount: '5.00', currency: 'AZN' } },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number) =>
  new Response(JSON.stringify({ status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

type Route = () => Response | Promise<Response>;
let routes: { page: Route; rewards: Route; obligation: Route };
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  mockParams = {};
  jest.clearAllMocks();
  routes = {
    page: () => json(page('LIVE')),
    rewards: () => json(REWARDS),
    obligation: () => new Response(null, { status: 204 }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/projects/aysel/solar-lamp') return routes.page();
    if (url.pathname === '/v1/projects/aysel/other-lamp') return routes.page();
    if (url.pathname === `/v1/projects/${ID}/rewards/public`) return routes.rewards();
    if (url.pathname === `/v1/projects/${ID}/update-obligation`) return routes.obligation();
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
  setOnline(true);
});

async function show({
  cached,
  now = NOW,
  still = false,
}: { cached?: ProjectPage; now?: Date; still?: boolean } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (cached !== undefined) client.setQueryData(['project', 'aysel', 'solar-lamp'], cached);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {still ? <MotionBudgetProvider level="none">{children}</MotionBudgetProvider> : children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(
    <CampaignScreen creatorSlug="aysel" projectSlug="solar-lamp" now={now} />,
    { wrapper },
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

/** What a reader gets: a moving figure (#278) is read by its final value, not its frames. */
function textOf(node: TestInstance | string): string {
  if (typeof node === 'string') return node;
  if (node.props.accessibilityRole === 'text' && typeof node.props.accessibilityLabel === 'string') {
    return node.props.accessibilityLabel;
  }
  return node.children.map(textOf).join('');
}

function background(node: { props: { style?: unknown } }): unknown {
  return StyleSheet.flatten(node.props.style as ViewStyle)?.backgroundColor;
}

const backPill = () => screen.queryByRole('button', { name: C.back.cta });
const selectFor = (title: string) =>
  screen.queryByRole('button', { name: C.rewards.selectNamed.replace('{title}', title) });

interface Expectation {
  readonly tag: string;
  readonly chip: string | null;
  readonly back: boolean;
  readonly countdown: boolean;
  readonly remind: boolean;
  readonly trust: 'open' | 'closed';
  readonly outcome: 'funded' | 'notFunded' | null;
}

const CASES: readonly [string, ProjectPage, Expectation][] = [
  [
    'PRELAUNCH',
    page('PRELAUNCH'),
    { tag: C.state.PRELAUNCH, chip: null, back: false, countdown: false, remind: true, trust: 'open', outcome: null },
  ],
  [
    'LIVE with three days left',
    page('LIVE'),
    { tag: C.state.LIVE, chip: null, back: true, countdown: true, remind: false, trust: 'open', outcome: null },
  ],
  [
    'LIVE on its last day',
    page('LIVE', { deadline: new Date(NOW.getTime() + 5 * HOUR).toISOString() }),
    { tag: C.state.LIVE, chip: 'Last day', back: true, countdown: true, remind: false, trust: 'open', outcome: null },
  ],
  [
    'EXTENDED',
    page('EXTENDED'),
    { tag: C.state.EXTENDED, chip: null, back: true, countdown: false, remind: false, trust: 'open', outcome: null },
  ],
  [
    'CLOSING_WINDOW',
    page('CLOSING_WINDOW', { deadline: PAST }),
    { tag: C.state.CLOSING_WINDOW, chip: null, back: true, countdown: false, remind: false, trust: 'open', outcome: null },
  ],
  [
    'SUCCESSFUL',
    page('SUCCESSFUL', { deadline: PAST, outcome: OUTCOME }),
    { tag: C.state.SUCCESSFUL, chip: null, back: false, countdown: false, remind: false, trust: 'closed', outcome: 'funded' },
  ],
  [
    'UNSUCCESSFUL',
    page('UNSUCCESSFUL', { deadline: PAST, outcome: { ...OUTCOME, pledged: { amount: '300.00', currency: 'AZN' } } }),
    { tag: C.state.UNSUCCESSFUL, chip: null, back: false, countdown: false, remind: false, trust: 'closed', outcome: 'notFunded' },
  ],
  [
    'CANCELED',
    page('CANCELED', { deadline: PAST, outcome: OUTCOME }),
    { tag: C.state.CANCELED, chip: null, back: false, countdown: false, remind: false, trust: 'closed', outcome: 'notFunded' },
  ],
  [
    'LATE_PLEDGE',
    page('LATE_PLEDGE', { deadline: PAST, outcome: OUTCOME }),
    { tag: C.state.LATE_PLEDGE, chip: null, back: false, countdown: false, remind: false, trust: 'closed', outcome: 'funded' },
  ],
];

describe('the campaign page, state by state', () => {
  it.each(CASES)('%s', async (_name, response, expected) => {
    routes.page = () => json(response);
    await show();

    expect(textOf(screen.getByTestId('campaign-state'))).toBe(expected.tag);

    if (expected.chip === null) {
      expect(screen.queryByTestId('campaign-urgency')).toBeNull();
    } else {
      const chip = screen.getByTestId('campaign-urgency');
      expect(textOf(chip)).toBe(expected.chip);
      // The one lime element on the page: a lime fill, never lime text.
      expect(background(chip)).toBe(colors.lime500);
    }

    expect(backPill() !== null).toBe(expected.back);
    expect(screen.queryByRole('timer') !== null).toBe(expected.countdown);
    expect(screen.queryByTestId('action-remind') !== null).toBe(expected.remind);

    const trust = textOf(screen.getByTestId('trust-sentence'));
    if (expected.trust === 'open') {
      // 80% of 1000.00, rounded up to the cent, named beside the goal.
      expect(trust).toContain('800.00');
      expect(trust).toContain('This campaign succeeds if it raises');
    } else {
      expect(trust).toContain('deadline was');
    }

    if (expected.outcome === null) {
      expect(screen.queryByTestId('outcome-notice')).toBeNull();
    } else {
      const notice = textOf(screen.getByTestId('outcome-notice'));
      expect(notice).toContain(expected.outcome === 'funded' ? C.outcome.funded : C.outcome.notFunded);
      expect(notice).toContain(expected.outcome === 'funded' ? C.outcome.settling : C.outcome.refunded);
    }

    // Select is offered exactly where Back is, and never on a sold-out tier.
    expect(selectFor('Early lamp') !== null).toBe(expected.back);
    expect(selectFor('Two lamps')).toBeNull();
  });

  it('draws a funded campaign’s percent in the success colour, with the word', async () => {
    routes.page = () => json(page('SUCCESSFUL', { deadline: PAST, pledged: OUTCOME.pledged, outcome: OUTCOME }));
    await show();
    const percent = screen.getByTestId('funding-percent');
    expect(textOf(percent)).toContain('124%');
    expect(textOf(percent)).toContain(C.funding.funded);
    // The figure counts up on first view and then rolls (#278); whichever is drawn by now, its
    // colour is the success token.
    const figure =
      within(percent).queryByTestId('animated-amount-count', { includeHiddenElements: true }) ??
      within(percent).getByText('%', { includeHiddenElements: true });
    expect(StyleSheet.flatten(figure.props.style).color).toBe(colors.success);
    expect(textOf(screen.getByTestId('campaign-state'))).toBe(C.state.SUCCESSFUL);
  });

  it('has no funding block, no "of goal" line and no rule without a goal', async () => {
    routes.page = () => json(page('LIVE', { goal: undefined }));
    await show();
    expect(screen.queryByTestId('live-funding')).toBeNull();
    expect(screen.queryByTestId('funding-of-goal')).toBeNull();
    expect(screen.queryByText(C.rule)).toBeNull();
    expect(textOf(screen.getByTestId('trust-sentence'))).toContain('80% of its goal by');
  });

  it('adds the days left to the "of goal" line on a live campaign', async () => {
    await show();
    expect(textOf(screen.getByTestId('funding-of-goal'))).toMatch(/^of .*1,000\.00.* goal · 3 days left$/);
  });

  it('says how many places a limited tier has left, and that a tier is sold out', async () => {
    await show();
    const rewards = screen.getByTestId('campaign-rewards');
    expect(within(rewards).getByText('5 places left')).toBeTruthy();
    expect(within(rewards).getByText(C.rewards.soldOut)).toBeTruthy();
    // Unlimited says nothing about stock, as on the web.
    expect(textOf(screen.getByTestId('reward-tier-3'))).not.toMatch(/left|unlimited/i);
  });

  it('draws no rewards section when there are no tiers', async () => {
    routes.rewards = () => json({ rewards: [], currency: 'AZN' });
    await show();
    expect(screen.queryByTestId('campaign-rewards')).toBeNull();
  });
});

describe('Back this campaign and Select this reward', () => {
  it('open the app’s checkout route, never the campaign page, and Back is white', async () => {
    await show();
    const back = backPill();
    expect(back).not.toBeNull();
    expect(background(back as TestInstance)).toBe(colors.whiteSurface);

    // `campaigns/[id]/back` carries `reward` on to the web checkout until #157 builds it.
    await fireEvent.press(back as TestInstance);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/campaigns/[id]/back',
      params: { id: ID },
    });

    await fireEvent.press(selectFor('Early lamp') as TestInstance);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/campaigns/[id]/back',
      params: { id: ID, reward: 'tier-1' },
    });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it('withdraws Back, the bar, Select and the "Last day" chip when the deadline passes on screen', async () => {
    // Real time: the page's clock is a timer set to the deadline, and nothing else moves it.
    routes.page = () =>
      json(page('LIVE', { deadline: new Date(Date.now() + 1_500).toISOString() }));
    await show({ now: new Date() });
    expect(textOf(screen.getByTestId('campaign-urgency'))).toBe('Last day');
    expect(selectFor('Early lamp')).not.toBeNull();

    // The header's pill below the fold of an 800pt list: the persistent bar is up.
    await fireEvent(screen.getByTestId('campaign-list'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
    });
    await fireEvent(screen.getByTestId('back-cta'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 2_000, width: 350, height: 48 } },
    });
    expect(screen.getByTestId('persistent-back', { includeHiddenElements: true })).toBeTruthy();
    expect(backPill()).not.toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_700));
    });

    expect(backPill()).toBeNull();
    expect(screen.queryByTestId('persistent-back', { includeHiddenElements: true })).toBeNull();
    expect(selectFor('Early lamp')).toBeNull();
    expect(screen.queryByTestId('campaign-urgency')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('has no lime control on the page', async () => {
    await show();
    const lime = screen.getAllByRole('button').filter((node) => background(node) === colors.lime500);
    expect(lime).toHaveLength(0);
  });
});

describe('the tabs', () => {
  it('names five tabs from the catalogue, 44pt each, the Campaign tab selected', async () => {
    await show();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      C.tabs.campaign,
      C.tabs.creator,
      C.tabs.faq,
      C.tabs.updates,
      C.tabs.comments,
    ]);
    expect(screen.getByRole('tab', { name: C.tabs.campaign, selected: true })).toBeTruthy();
    for (const tab of tabs) {
      expect(StyleSheet.flatten(tab.props.style as ViewStyle).minHeight).toBe(44);
    }
    expect(screen.getByLabelText(C.tabs.label)).toBeTruthy();
  });

  it('opens the tab a deep link names, and falls back to Campaign for an unknown one', async () => {
    mockParams = { tab: 'updates' };
    await show();
    expect(screen.getByRole('tab', { name: C.tabs.updates, selected: true })).toBeTruthy();
    expect(screen.getByTestId('updates-heading')).toBeTruthy();
    client.clear();

    mockParams = { tab: 'nonsense' };
    await show();
    expect(screen.getByRole('tab', { name: C.tabs.campaign, selected: true })).toBeTruthy();
  });

  it('switches in place and writes the tab to the route, omitting the default', async () => {
    routes.page = () => json(page('LIVE', { risks: 'Shipping may be late.' }));
    await show();
    expect(screen.getByText('Shipping may be late.')).toBeTruthy();
    // The Creator tab's profile is read when that tab opens, and not before (#155).
    const profileReads = () =>
      (global.fetch as jest.Mock).mock.calls.filter(([input]) =>
        new URL(String(input)).pathname.startsWith('/v1/users/aysel'),
      );
    expect(profileReads()).toHaveLength(0);

    await fireEvent.press(screen.getByRole('tab', { name: C.tabs.creator }));
    await settle();
    expect(profileReads()).toHaveLength(2);
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ tab: 'creator', thread: undefined });
    expect(screen.getByRole('tab', { name: C.tabs.creator, selected: true })).toBeTruthy();
    expect(screen.queryByText('Shipping may be late.')).toBeNull();
    // The header and the rewards stay on every tab.
    expect(screen.getByTestId('live-funding')).toBeTruthy();
    expect(screen.getByTestId('campaign-rewards')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: C.tabs.campaign }));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ tab: undefined, thread: undefined });
  });

  it('goes through all five tabs and back without the hook order changing', async () => {
    // A tab hook that skipped a hook while inactive would throw on one of these switches.
    const errors = jest.spyOn(console, 'error');
    routes.page = () => json(page('LIVE', { risks: 'Shipping may be late.' }));
    await show();
    for (const name of [
      C.tabs.creator,
      C.tabs.faq,
      C.tabs.updates,
      C.tabs.comments,
      C.tabs.campaign,
      C.tabs.comments,
      C.tabs.campaign,
    ]) {
      await fireEvent.press(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name, selected: true })).toBeTruthy();
    }
    expect(screen.getByText('Shipping may be late.')).toBeTruthy();
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('hooks'), expect.anything());
    errors.mockRestore();
  });

  it('starts again when the same screen is given another campaign', async () => {
    const view = await show();
    await fireEvent.press(screen.getByRole('tab', { name: C.tabs.creator }));
    expect(screen.getByRole('tab', { name: C.tabs.creator, selected: true })).toBeTruthy();

    // Another campaign in the same screen instance: its own tab state, not the last one's.
    routes.page = () =>
      json(page('LIVE', { id: 'other-id', slug: 'other-lamp', title: 'Other Lamp' }));
    await view.rerender(
      <CampaignScreen creatorSlug="aysel" projectSlug="other-lamp" now={NOW} />,
    );
    await settle();
    expect(textOf(screen.getByTestId('campaign-title'))).toBe('Other Lamp');
    expect(screen.getByRole('tab', { name: C.tabs.campaign, selected: true })).toBeTruthy();
  });

  it('draws the Comments tab in the app, from a deep link, with the report link under it', async () => {
    mockParams = { tab: 'comments' };
    await show();
    expect(screen.getByRole('tab', { name: C.tabs.comments, selected: true })).toBeTruthy();
    expect(screen.getByRole('header', { name: C.comments.heading })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: en.moderation.report.triggerOn.campaign }),
    ).toBeTruthy();
  });
});

describe('the design language (#281)', () => {
  afterEach(() => jest.restoreAllMocks());

  /** The press scale's transform on a press-scale surface's wrapper, or none when it is still. */
  const scaleOf = (node: TestInstance) =>
    StyleSheet.flatten(node.parent?.props.style as ViewStyle | undefined)?.transform;

  it('puts the notices, the tabs, their rows and the rewards on the white content sheet', async () => {
    await show();
    expect(background(screen.getByTestId('campaign-tabs'))).toBe(colors.whiteSurface);
    expect(background(screen.getByTestId('trust-block'))).toBe(colors.whiteMuted);
    expect(background(screen.getByTestId('reward-tier-1'))).toBe(colors.whiteMuted);
    expect(background(screen.getByTestId('campaign-footer'))).toBe(colors.whiteSurface);
    // The chosen tab is the sheet's primary pill, inverted; the others are raised blocks.
    expect(background(screen.getByRole('tab', { name: C.tabs.campaign }))).toBe(colors.surface1);
    expect(background(screen.getByRole('tab', { name: C.tabs.faq }))).toBe(colors.whiteMuted);
    // Select inverts on the sheet; Back, on the canvas, stays white.
    expect(background(selectFor('Early lamp') as TestInstance)).toBe(colors.surface1);
    expect(background(backPill() as TestInstance)).toBe(colors.whiteSurface);
  });

  it('leads with what has been pledged as the hero figure, formatted by @ideanest/money', async () => {
    await show();
    const pledged = screen.getByTestId('funding-pledged');
    // One accessible figure, named by the formatted amount, not one stop per digit.
    expect(within(pledged).getByLabelText(formatMoney({ amount: '420.00', currency: 'AZN' }))).toBeTruthy();
  });

  it('shows the hero figure at once, without a count, when motion is off', async () => {
    await show({ still: true });
    const pledged = screen.getByTestId('funding-pledged');
    expect(
      within(pledged).queryByTestId('animated-amount-count', { includeHiddenElements: true }),
    ).toBeNull();
    expect(textOf(pledged)).toContain('420.00');
  });

  it('raises the first screenful in, staggered, and never a tab row', async () => {
    const delays: number[] = [];
    const build = FadeInDown.duration.bind(FadeInDown);
    jest.spyOn(FadeInDown, 'duration').mockImplementation((ms: number) => {
      const builder = build(ms);
      const delay = builder.delay.bind(builder);
      builder.delay = ((wait: number) => {
        delays.push(wait);
        return delay(wait);
      }) as typeof builder.delay;
      return builder;
    });
    await show();
    // Cover, header, funding, countdown, Back and the actions: six rises, nothing past them.
    expect([...new Set(delays)].sort((a, b) => a - b)).toEqual(
      [0, 1, 2, 3, 4, 5].map((index) => staggerDelay(index)),
    );
  });

  it('raises nothing in when motion is off', async () => {
    const built = jest.spyOn(FadeInDown, 'duration');
    await show({ still: true });
    expect(built).not.toHaveBeenCalled();
    expect(screen.getByTestId('campaign-title')).toBeTruthy();
  });

  it('makes a selectable reward card a press-scale surface that opens the checkout on its tier', async () => {
    const select = jest.spyOn(haptics, 'selectReward').mockImplementation(() => undefined);
    await show();
    const card = screen.getByTestId('reward-tier-1');
    expect(scaleOf(card)).toEqual([{ scale: 1 }]);
    // A bigger target for a thumb, not a second stop for a screen reader: the pill is that.
    expect(card.props.accessible).toBe(false);

    await fireEvent.press(card);
    expect(select).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/campaigns/[id]/back',
      params: { id: ID, reward: 'tier-1' },
    });

    // A sold-out tier is a still block that opens nothing.
    mockRouter.push.mockClear();
    await fireEvent.press(screen.getByTestId('reward-tier-2'));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('keeps the reward cards and the tabs still when motion is off', async () => {
    await show({ still: true });
    expect(scaleOf(screen.getByTestId('reward-tier-1'))).toBeUndefined();
    const tab = screen.getByRole('tab', { name: C.tabs.faq });
    expect(StyleSheet.flatten(tab.props.style as ViewStyle).transform).toBeUndefined();
  });

  it('gives the tabs the press scale with full motion', async () => {
    await show();
    const tab = screen.getByRole('tab', { name: C.tabs.faq });
    expect(StyleSheet.flatten(tab.props.style as ViewStyle).transform).toEqual([{ scale: 1 }]);
  });

  it('floats the persistent Back pill above the home indicator, inverted on the sheet', async () => {
    await show();
    await fireEvent(screen.getByTestId('campaign-list'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
    });
    await fireEvent(screen.getByTestId('back-cta'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 2_000, width: 350, height: 48 } },
    });
    const bar = screen.getByTestId('persistent-back', { includeHiddenElements: true });
    const style = StyleSheet.flatten(bar.props.style as ViewStyle);
    expect(style.position).toBe('absolute');
    expect(style.bottom).toBe(METRICS.insets.bottom + spacing[2]);
    const pill = within(bar).getByRole('button', { includeHiddenElements: true });
    expect(background(pill)).toBe(colors.surface1);
    // The end of the list clears it, so it never covers the report link.
    const footer = StyleSheet.flatten(screen.getByTestId('campaign-footer').props.style as ViewStyle);
    expect(Number(footer.paddingBottom)).toBeGreaterThan(Number(style.bottom) + 48);
  });
});

describe('when the page is not a page', () => {
  it('shows not-found for a 404, with a way to other campaigns', async () => {
    routes.page = () => problem(404);
    await show();
    expect(screen.getByTestId('campaign-not-found')).toBeTruthy();
    expect(screen.getByText(en.shell.failure.pages.notFound.title)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.failure.links.browse }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/discover');
  });

  it('shows not-found for a state without a public page', async () => {
    routes.page = () => json(page('DRAFT'));
    await show();
    expect(screen.getByTestId('campaign-not-found')).toBeTruthy();
    // Nothing else is asked about a campaign that is not public.
    const asked = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
    expect(asked.some((url) => url.includes('/rewards/public'))).toBe(false);
  });

  it('shows an error with a retry, not not-found, when the service fails and nothing is cached', async () => {
    routes.page = () => problem(500);
    await show();
    expect(screen.queryByTestId('campaign-not-found')).toBeNull();
    expect(screen.getByText(en.mobile.campaign.failedTitle)).toBeTruthy();

    routes.page = () => json(page('LIVE'));
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('campaign-screen')).toBeTruthy();
  });

  it('draws the page’s shape, named once, while the first answer is on its way', async () => {
    routes.page = () => new Promise<Response>(() => {});
    await show();
    expect(screen.getByLabelText(C.prelaunch.loading)).toBeTruthy();
    expect(screen.queryByTestId('campaign-screen')).toBeNull();
  });

  it('shows the cached page offline with the notice, and disables Save and Remind with the reason', async () => {
    routes.page = () => Promise.reject(new TypeError('Network request failed'));
    await act(async () => setOnline(false));
    await show({ cached: page('PRELAUNCH') });
    expect(screen.getByTestId('campaign-stale')).toBeTruthy();
    expect(screen.getByText(en.mobile.campaign.stale)).toBeTruthy();

    const save = screen.getByTestId('action-save');
    expect(save.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('action-remind').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(textOf(screen.getByTestId('actions-notice'))).toBe(en.mobile.campaign.actionsOffline);
  });
});

describe('the story on the Campaign tab', () => {
  it('renders a valid version-1 document and nothing for an invalid one', async () => {
    routes.page = () =>
      json(
        page('LIVE', {
          story: {
            version: 1,
            blocks: [{ type: 'paragraph', spans: [{ text: 'Made in Baku.', marks: [] }] }],
          } as ProjectPage['story'],
        }),
      );
    await show();
    expect(screen.getByText('Made in Baku.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'About Solar Lamp' })).toBeTruthy();
    client.clear();

    routes.page = () =>
      json(page('LIVE', { story: { version: 2, blocks: [] } as ProjectPage['story'] }));
    await show();
    expect(screen.queryByTestId('campaign-story')).toBeNull();
  });
});
