import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { CategoryIndex } from './category-index';
import { CategoryLanding } from './category-landing';

/**
 * The category screens — issue #154: the index, and the category and subcategory landings, in
 * the web's order and on the web's conditions, with the app's own retry where the web can only
 * say "nothing here".
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();

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
    for (const [name, value] of Object.entries(params)) path = path.replace(`[${name}]`, value);
    return path;
  };
  return {
    Link: ({ children, href }: { children: ReactNode; href: unknown }) =>
      React.createElement(View, { testID: `href:${hrefOf(href)}` }, children),
    Stack: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), setParams: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const TREE = [
  {
    id: 'c1',
    slug: 'games',
    name: 'Games',
    subcategories: [
      { id: 's1', slug: 'tabletop', name: 'Tabletop' },
      { id: 's2', slug: 'video', name: 'Video games' },
    ],
  },
  { id: 'c2', slug: 'art', name: 'Art', subcategories: [] },
];

function card(title: string, index: number) {
  return {
    id: `c-${index}`,
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
const fail = () => Promise.reject(new TypeError('Network request failed'));

type Route = (url: URL) => Response | Promise<Response>;
let routes: { categories: Route; feed: Route };
let requests: URL[];
let client: QueryClient;

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  requests = [];
  routes = {
    categories: () => json(TREE),
    feed: () => json({ items: [card('Solar Lamp', 0)] }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/v1/categories')) return routes.categories(url);
    if (url.pathname.endsWith('/v1/discover')) return routes.feed(url);
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client.clear());

async function show(ui: ReactElement) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {ui}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const L = en.discovery.landing;
const feedRequests = () => requests.filter((url) => url.pathname.endsWith('/v1/discover'));

describe('the category landing', () => {
  it('reads the taxonomy and the feed at once, 24 cards under the route’s category', async () => {
    await show(<CategoryLanding categorySlug="games" />);
    const feed = feedRequests()[0];
    expect(feed?.searchParams.get('category')).toBe('games');
    expect(feed?.searchParams.has('subcategory')).toBe(false);
    expect(feed?.searchParams.get('limit')).toBe('24');
  });

  it('draws the trail, the heading, the standfirst, the chips, the count, the cards, the pill', async () => {
    await show(<CategoryLanding categorySlug="games" />);
    const trail = screen.getByLabelText('Breadcrumb');
    expect(within(trail).getByRole('link', { name: 'Categories' })).toBeTruthy();
    expect(within(trail).getByText('Games')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Games' })).toBeTruthy();
    expect(screen.getByText('Campaigns filed under Games, newest first.')).toBeTruthy();
    const chips = screen.getByLabelText('Subcategories of Games');
    expect(within(chips).getByRole('link', { name: 'Tabletop' })).toBeTruthy();
    expect(screen.getByTestId('href:/categories/games/tabletop')).toBeTruthy();
    expect(screen.getByTestId('landing-count')).toHaveTextContent('1 campaign');
    expect(screen.getByLabelText('Campaigns in Games')).toBeTruthy();
    // One link per card, named by the campaign.
    expect(screen.getAllByRole('link', { name: /Solar Lamp/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Filter and sort Games in the feed' })).toBeTruthy();
  });

  it('clears the home indicator on its stack route, with no tab bar under it', async () => {
    await show(<CategoryLanding categorySlug="games" />);
    const padding = StyleSheet.flatten(
      screen.getByTestId('category-landing').props.contentContainerStyle,
    );
    expect(padding.paddingBottom).toBe(METRICS.insets.bottom);
  });

  it('draws no chip row for a category without children', async () => {
    await show(<CategoryLanding categorySlug="art" />);
    expect(screen.getByRole('header', { name: 'Art' })).toBeTruthy();
    expect(screen.queryByTestId('subcategory-chips')).toBeNull();
  });

  it('says there is more, and offers every campaign in the feed, when a cursor came back', async () => {
    routes.feed = () => json({ items: [card('Solar Lamp', 0), card('Kite', 1)], nextCursor: 'next' });
    await show(<CategoryLanding categorySlug="games" />);
    expect(screen.getByTestId('landing-count')).toHaveTextContent('2 campaigns, with more in the feed');
    await fireEvent.press(screen.getByRole('button', { name: 'See every campaign in Games' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: { category: 'games' } });
  });

  it('opens the feed under the canonical slug, whatever case the link was typed in', async () => {
    await show(<CategoryLanding categorySlug="GAMES" />);
    await fireEvent.press(screen.getByTestId('feed-pill'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: { category: 'games' } });
  });

  it('is the not-found screen for a slug the taxonomy does not name', async () => {
    await show(<CategoryLanding categorySlug="gmaes" />);
    expect(screen.getByTestId('category-not-found')).toBeTruthy();
    expect(screen.getByText(en.shell.failure.pages.notFound.title)).toBeTruthy();
  });

  it('says the service could not be reached, with a retry, when the taxonomy read failed', async () => {
    routes.categories = fail;
    await show(<CategoryLanding categorySlug="games" />);
    expect(screen.getByTestId('taxonomy-error')).toBeTruthy();
    routes.categories = () => json(TREE);
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByRole('header', { name: 'Games' })).toBeTruthy();
  });

  it('shows an error with retry, not "nothing here", when the feed read failed', async () => {
    routes.feed = fail;
    await show(<CategoryLanding categorySlug="games" />);
    expect(screen.getByTestId('landing-error')).toBeTruthy();
    expect(screen.queryByTestId('landing-empty')).toBeNull();
  });

  it('says nothing is published yet, and offers the feed, for an empty category', async () => {
    routes.feed = () => json({ items: [] });
    await show(<CategoryLanding categorySlug="art" />);
    expect(screen.getByTestId('landing-count')).toHaveTextContent('No campaigns here yet');
    expect(screen.getByText('Nothing published in Art yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: L.emptyAction }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
  });
});

describe('the subcategory landing', () => {
  it('asks the feed for both slugs, and draws a two-step trail with no chip row', async () => {
    await show(<CategoryLanding categorySlug="games" subcategorySlug="tabletop" />);
    const feed = feedRequests()[0];
    expect(feed?.searchParams.get('category')).toBe('games');
    expect(feed?.searchParams.get('subcategory')).toBe('tabletop');

    const trail = screen.getByLabelText('Breadcrumb');
    expect(within(trail).getByRole('link', { name: 'Categories' })).toBeTruthy();
    expect(within(trail).getByRole('link', { name: 'Games' })).toBeTruthy();
    expect(screen.getByTestId('href:/categories/games')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tabletop' })).toBeTruthy();
    expect(screen.getByText('Campaigns filed under Games → Tabletop, newest first.')).toBeTruthy();
    expect(screen.queryByTestId('subcategory-chips')).toBeNull();
  });

  it('carries the category and the subcategory into the feed', async () => {
    await show(<CategoryLanding categorySlug="games" subcategorySlug="tabletop" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Filter and sort Tabletop in the feed' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/discover',
      params: { category: 'games', subcategory: 'tabletop' },
    });
  });

  it('is not found for a subcategory of another category', async () => {
    routes.categories = () =>
      json([...TREE, { id: 'c3', slug: 'crafts', name: 'Crafts', subcategories: [{ id: 's9', slug: 'prints', name: 'Prints' }] }]);
    await show(<CategoryLanding categorySlug="games" subcategorySlug="prints" />);
    expect(screen.getByTestId('category-not-found')).toBeTruthy();
  });
});

describe('the categories index', () => {
  it('lists every category and its subcategories as links, in the service’s order', async () => {
    await show(<CategoryIndex />);
    expect(screen.getByRole('header', { name: en.discovery.categories.title })).toBeTruthy();
    const names = screen.getAllByRole('link').map((link) => link.props.accessibilityLabel);
    expect(names).toEqual(['Games', 'Tabletop', 'Video games', 'Art']);
    expect(screen.getByTestId('href:/categories/games')).toBeTruthy();
    expect(screen.getByTestId('href:/categories/games/video')).toBeTruthy();
  });

  it('lists the taxonomy inside the white content sheet', async () => {
    await show(<CategoryIndex />);
    const sheet = screen.getByTestId('category-sheet');
    expect(within(sheet).getAllByRole('link')).toHaveLength(4);
  });

  it.each([
    ['fails', fail],
    ['answers with nothing', () => json([])],
  ])('says so, with a working link to the feed, when the read %s', async (_, route) => {
    routes.categories = route as Route;
    await show(<CategoryIndex />);
    expect(screen.getByTestId('categories-unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('categories-feed-link'));
    expect(mockPush).toHaveBeenCalledWith('/discover');
    expect(screen.getByRole('button', { name: en.discovery.feed.tryAgain })).toBeTruthy();
  });
});
