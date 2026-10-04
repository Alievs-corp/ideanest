import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import HomeScreen from '../app/(tabs)/index';
import { TabBarInsetProvider, tabBarFootprint } from './tab-bar';
import { MotionBudgetProvider } from './ui';
import { motion } from '../theme';

/**
 * The Home tab — issue #153: the hero, the two rails and the categories in the web's order and
 * on the web's conditions, the three reads in parallel, a failed read hiding only its section,
 * and both campaign reads failing drawing the error rather than the empty card.
 *
 * <p>Here rather than beside `app/(tabs)/index.tsx` because every file under `src/app` is a route.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const React = require('react');
  const hrefOf = (href: unknown): string => {
    if (typeof href === 'string') return href;
    const { pathname = '', params = {} } = href as {
      pathname?: string;
      params?: Record<string, string>;
    };
    let path = pathname;
    const query: string[] = [];
    for (const [name, value] of Object.entries(params)) {
      if (path.includes(`[${name}]`)) path = path.replace(`[${name}]`, value);
      else query.push(`${name}=${value}`);
    }
    return query.length === 0 ? path : `${path}?${query.join('&')}`;
  };
  return {
    Link: ({ children, href }: { children: ReactNode; href: unknown }) =>
      React.createElement(View, { testID: 'link', accessibilityValue: { text: hrefOf(href) } }, children),
    Stack: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), setParams: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function card(title: string, index: number) {
  return {
    id: `c-${title}-${index}`,
    slug: `campaign-${index}`,
    creatorSlug: 'aysel',
    creator: { name: 'Aysel', slug: 'aysel' },
    title,
    state: 'LIVE',
    badge: 'live',
    completionPercent: '40',
    pledged: { amount: '1000.00', currency: 'AZN' },
    backersCount: 3,
    daysLeft: 12,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = (url: URL) => Response | Promise<Response>;
let routes: { closing: Route; launched: Route; categories: Route };
let requests: URL[];
let client: QueryClient;

beforeEach(() => {
  mockPush.mockReset();
  requests = [];
  routes = {
    closing: () => json({ items: [card('Closing', 0)] }),
    launched: () => json({ items: [card('Launched', 1)] }),
    categories: () => json([{ id: 'cat-1', slug: 'games', name: 'Games' }]),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/v1/categories')) return routes.categories(url);
    if (url.pathname.endsWith('/v1/discover')) {
      return url.searchParams.get('sort') === 'ending_soon' ? routes.closing(url) : routes.launched(url);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client.clear());

async function renderHome(wrap: (home: ReactElement) => ReactElement = (home) => home) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {wrap(<HomeScreen />)}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

const H = en.home;
const fail = () => Promise.reject(new TypeError('Network request failed'));

describe('the Home tab', () => {
  it('asks for the three reads at once, with the web’s parameters', async () => {
    await renderHome();
    const discover = requests.filter((url) => url.pathname.endsWith('/v1/discover'));
    expect(discover.map((url) => url.search).sort()).toEqual([
      '?status=live&limit=6',
      '?status=live&sort=ending_soon&limit=6',
    ]);
    expect(requests.some((url) => url.pathname.endsWith('/v1/categories'))).toBe(true);
  });

  it('draws the hero, then Ending soon, Recently launched and the categories, in that order', async () => {
    await renderHome();
    const headings = screen.getAllByRole('header').map((node) => node.props.children);
    expect(headings).toEqual([
      H.hero.title,
      H.closing.heading,
      H.launched.heading,
      H.categories.heading,
    ]);
    expect(screen.getByRole('link', { name: 'Closing, by Aysel' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Games' })).toBeTruthy();
  });

  it('points each rail’s link at the feed it previews', async () => {
    await renderHome();
    const targets = screen.getAllByTestId('link').map((link) => link.props.accessibilityValue.text);
    expect(targets).toContain('/discover?status=live&sort=ending_soon');
    expect(targets).toContain('/discover?status=live');
    expect(targets).toContain('/categories');
    expect(targets).toContain('/categories/games');
  });

  it('hides only the section whose read failed', async () => {
    routes.closing = fail;
    await renderHome();
    expect(screen.queryByText(H.closing.heading)).toBeNull();
    expect(screen.getByText(H.launched.heading)).toBeTruthy();
    expect(screen.getByText(H.categories.heading)).toBeTruthy();
    expect(screen.queryByTestId('home-error')).toBeNull();
  });

  it('says the service could not be reached, with a retry, when both campaign reads fail', async () => {
    routes.closing = fail;
    routes.launched = fail;
    await renderHome();
    expect(screen.getByTestId('home-error')).toBeTruthy();
    expect(screen.queryByTestId('home-empty')).toBeNull();

    routes.closing = () => json({ items: [card('Back', 2)] });
    await fireEvent.press(screen.getByRole('button', { name: en.discovery.feed.tryAgain }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('link', { name: 'Back, by Aysel' })).toBeTruthy();
  });

  it('draws the empty card when both rails are empty', async () => {
    routes.closing = () => json({ items: [] });
    routes.launched = () => json({ items: [] });
    await renderHome();
    expect(screen.getByTestId('home-empty')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: H.empty.action }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
  });

  it('opens the feed and the new-campaign screen from the hero', async () => {
    await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: H.hero.browse }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
    await fireEvent.press(screen.getByRole('button', { name: H.hero.start }));
    expect(mockPush).toHaveBeenCalledWith('/campaigns/new');
  });
});

describe('the Home tab in the design language', () => {
  const tile = () => screen.getByRole('link', { name: 'Games' });

  it('clears the floating tab bar once, through the screen scaffold', async () => {
    await renderHome((home) => <TabBarInsetProvider>{home}</TabBarInsetProvider>);
    const padding = StyleSheet.flatten(screen.getByTestId('home').props.contentContainerStyle);
    expect(padding.paddingBottom).toBe(tabBarFootprint(METRICS.insets.bottom));
  });

  it('gives a category tile under the thumb with full motion', async () => {
    await renderHome();
    fireEvent(tile(), 'pressIn');
    await waitFor(
      () => {
        const style = getAnimatedStyle(tile().parent as never) as {
          transform?: { scale: number }[];
        };
        expect(style.transform?.[0]?.scale).toBeCloseTo(motion.pressScale, 2);
      },
      { timeout: 3000 },
    );
  });

  it('keeps a category tile still with reduced motion', async () => {
    await renderHome((home) => <MotionBudgetProvider level="none">{home}</MotionBudgetProvider>);
    fireEvent(tile(), 'pressIn');
    expect(StyleSheet.flatten(tile().parent?.props.style)?.transform).toBeUndefined();
  });
});
