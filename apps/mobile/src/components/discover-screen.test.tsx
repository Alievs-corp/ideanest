import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import DiscoverScreen from '../app/discover';

/**
 * The Discover screen — issue #153's "Tests" list for Discover, the range fields and the
 * suggestions: what a filter does to the request and to the route, chips, blame, paging, a
 * next-page failure, and the names a screen reader hears.
 *
 * <p>Here rather than beside `app/discover.tsx` because every file under `src/app` is a route.
 */

const mockSetParams = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const React = require('react');
  return {
    Link: ({ children }: { children: ReactNode }) => React.createElement(View, null, children),
    Stack: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), setParams: mockSetParams }),
    useLocalSearchParams: () => mockParams,
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

const NO_FACETS = {
  status: [
    { value: 'upcoming', count: 2 },
    { value: 'live', count: 5 },
    { value: 'extended', count: 0 },
    { value: 'successful', count: 1 },
  ],
  categories: [
    {
      slug: 'games',
      name: 'Games',
      count: 4,
      subcategories: [{ slug: 'tabletop', name: 'Tabletop games', count: 2 }],
    },
  ],
  tags: [],
  completion: [],
  goalAmount: [],
  amountRaised: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = (url: URL) => Response | Promise<Response>;
let routes: { feed: Route; facets: Route; suggest: Route };
let requests: URL[];
let client: QueryClient;

beforeEach(() => {
  mockParams = {};
  mockSetParams.mockReset();
  mockPush.mockReset();
  requests = [];
  routes = {
    feed: () => json({ items: [card('Solar Lamp', 0)] }),
    facets: () => json(NO_FACETS),
    suggest: () => json({ items: [] }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/v1/discover/facets')) return routes.facets(url);
    if (url.pathname.endsWith('/v1/discover')) return routes.feed(url);
    if (url.pathname.endsWith('/v1/search/suggest')) return routes.suggest(url);
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client.clear());

async function renderDiscover() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <DiscoverScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

/** Lets fetches resolve and FlashList finish its first layout. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const feedRequests = () => requests.filter((url) => url.pathname.endsWith('/v1/discover'));
const lastSetParams = () => mockSetParams.mock.calls.at(-1)?.[0] as Record<string, unknown>;
const T = en.discovery.feed;

describe('the request follows the route', () => {
  it('asks for 24 cards with the filters the params carry', async () => {
    mockParams = { status: 'live', category: ['Games'], sort: 'ending_soon' };
    await renderDiscover();
    const url = feedRequests()[0];
    expect(url?.searchParams.get('status')).toBe('live');
    expect(url?.searchParams.get('category')).toBe('games');
    expect(url?.searchParams.get('sort')).toBe('ending_soon');
    expect(url?.searchParams.get('limit')).toBe('24');
  });

  it('omits the default sort and an unknown status', async () => {
    mockParams = { sort: 'newest', status: 'finished' };
    await renderDiscover();
    const url = feedRequests()[0];
    expect(url?.searchParams.has('sort')).toBe(false);
    expect(url?.searchParams.has('status')).toBe(false);
  });
});

describe('the filter sheet', () => {
  it('ticking a status replaces the route params with it', async () => {
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('filters-button'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Live' }));
    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(lastSetParams()).toMatchObject({ status: 'live', category: undefined, q: undefined });
  });

  it('shows "None" and disables a box whose count is zero', async () => {
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('filters-button'));
    const extended = screen.getByRole('checkbox', { name: 'Extended' });
    expect(extended.props.accessibilityState).toMatchObject({ disabled: true });
    expect(extended).toHaveAccessibilityValue({ text: T.none });
    expect(screen.getByRole('checkbox', { name: 'Live' })).toHaveAccessibilityValue({ text: '5' });
  });

  it('opens a category’s subcategories once it is ticked', async () => {
    mockParams = { category: 'games' };
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('filters-button'));
    expect(screen.getByLabelText('Games subcategories')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Tabletop games' })).toBeTruthy();
  });

  it('says there are no tags when the facets list none', async () => {
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('filters-button'));
    expect(screen.getByText(T.noTags)).toBeTruthy();
  });
});

describe('the custom range', () => {
  async function openGoalRange() {
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('filters-button'));
    return within(screen.getByTestId('range-goal'));
  }

  it('refuses "abc" with rangeInvalid', async () => {
    const range = await openGoalRange();
    await fireEvent.changeText(range.getByLabelText('Lowest goal amount'), 'abc');
    await fireEvent.press(range.getByRole('button', { name: 'Apply the custom goal amount range' }));
    expect(range.getByText(T.rangeInvalid)).toBeTruthy();
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('refuses 5000 to 1000 with rangeUnordered', async () => {
    const range = await openGoalRange();
    await fireEvent.changeText(range.getByLabelText('Lowest goal amount'), '5000');
    await fireEvent.changeText(range.getByLabelText('Highest goal amount'), '1000');
    await fireEvent.press(range.getByRole('button', { name: 'Apply the custom goal amount range' }));
    expect(range.getByText(T.rangeUnordered)).toBeTruthy();
  });

  it('applies "2500.00" as typed', async () => {
    const range = await openGoalRange();
    await fireEvent.changeText(range.getByLabelText('Lowest goal amount'), '2500.00');
    await fireEvent.press(range.getByRole('button', { name: 'Apply the custom goal amount range' }));
    expect(lastSetParams()).toMatchObject({ goalMin: '2500.00', goalMax: undefined });
  });
});

describe('active filters', () => {
  it('removing a chip removes exactly that filter, and clear keeps the query and the sort', async () => {
    mockParams = { status: 'live', category: 'games', q: 'lamp', sort: 'ending_soon' };
    await renderDiscover();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Status filter: Live' }));
    expect(lastSetParams()).toMatchObject({
      status: undefined,
      category: 'games',
      q: 'lamp',
      sort: 'ending_soon',
    });

    await fireEvent.press(screen.getByRole('button', { name: T.clearAll }));
    expect(lastSetParams()).toMatchObject({
      status: undefined,
      category: undefined,
      q: 'lamp',
      sort: 'ending_soon',
    });
  });
});

describe('an empty feed', () => {
  it('blames the one filter whose facet counts zero', async () => {
    mockParams = { status: 'extended', category: 'games' };
    routes.feed = () => json({ items: [] });
    await renderDiscover();
    expect(screen.getByText(T.emptyFilteredTitle)).toBeTruthy();
    expect(
      screen.getByText(
        'Extended has no campaigns once the rest of your filters are applied. Removing it should bring results back.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Extended' }));
    expect(lastSetParams()).toMatchObject({ status: undefined, category: 'games' });
  });

  it('names every filter when several count zero', async () => {
    mockParams = { status: 'extended', category: 'comics' };
    routes.feed = () => json({ items: [] });
    await renderDiscover();
    expect(
      screen.getByText(
        'These filters have nothing in common: Extended, comics. Removing one of them should bring results back.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Extended' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove comics' })).toBeTruthy();
  });

  it('says nothing is published when there is no filter and no query', async () => {
    routes.feed = () => json({ items: [] });
    await renderDiscover();
    expect(screen.getByText(T.emptyTitle)).toBeTruthy();
  });
});

describe('paging', () => {
  it('never asks for the same cursor twice, and appends the page', async () => {
    let release: (() => void) | undefined;
    routes.feed = (url) => {
      if (url.searchParams.get('cursor') === 'page-2') {
        return new Promise<Response>((resolve) => {
          release = () => resolve(json({ items: [card('Second', 1)] }));
        });
      }
      return json({ items: [card('First', 0)], nextCursor: 'page-2' });
    };
    await renderDiscover();

    await fireEvent.press(screen.getByTestId('show-more'));
    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(feedRequests().filter((url) => url.searchParams.get('cursor') === 'page-2')).toHaveLength(1);

    release?.();
    await settle();
    expect(screen.getByRole('link', { name: 'Second, by Aysel' })).toBeTruthy();
    expect(screen.getByText(T.endAll)).toBeTruthy();
  });

  it('keeps the loaded cards when the next page fails', async () => {
    routes.feed = (url) =>
      url.searchParams.get('cursor') === 'page-2'
        ? json({ title: 'Down', detail: 'The feed is resting.' }, 503)
        : json({ items: [card('First', 0)], nextCursor: 'page-2' });
    await renderDiscover();

    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(screen.getByRole('link', { name: 'First, by Aysel' })).toBeTruthy();
    expect(screen.getByTestId('next-page-error')).toBeTruthy();

    // The button retries the failed page; the end of the list does not hammer it.
    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(feedRequests().filter((url) => url.searchParams.get('cursor') === 'page-2')).toHaveLength(2);
  });

  it('shows the error with a retry when the first page fails', async () => {
    routes.feed = () => Promise.reject(new TypeError('Network request failed'));
    await renderDiscover();
    expect(screen.getByText(T.unreachable)).toBeTruthy();
    expect(screen.getByRole('button', { name: T.tryAgain })).toBeTruthy();
  });
});

describe('suggestions', () => {
  async function typeAndWait(text: string) {
    await fireEvent.changeText(screen.getByLabelText(en.discovery.suggest.inputLabel), text);
    await settle(250);
  }

  it('opens a campaign suggestion', async () => {
    routes.suggest = () =>
      json({ items: [{ kind: 'campaign', label: 'Solar Lamp', slug: 'solar-lamp', parentSlug: 'aysel' }] });
    await renderDiscover();
    await typeAndWait('sol');
    await fireEvent.press(screen.getByRole('button', { name: 'Solar Lamp, Campaign' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'solar-lamp' },
    });
  });

  it('a category suggestion clears the query and adds the filter', async () => {
    mockParams = { q: 'old' };
    routes.suggest = () => json({ items: [{ kind: 'category', label: 'Games', slug: 'games' }] });
    await renderDiscover();
    await typeAndWait('gam');
    await fireEvent.press(screen.getByRole('button', { name: 'Games, Category' }));
    expect(lastSetParams()).toMatchObject({ q: undefined, category: 'games' });
  });

  it('asks at most once per settled term, with limit 10, and draws only the current term’s answer', async () => {
    routes.suggest = (url) =>
      json({ items: [{ kind: 'tag', label: `tag for ${url.searchParams.get('q')}`, slug: 'x' }] });
    await renderDiscover();
    await fireEvent.changeText(screen.getByLabelText(en.discovery.suggest.inputLabel), 'so');
    await fireEvent.changeText(screen.getByLabelText(en.discovery.suggest.inputLabel), 'sol');
    await settle(250);
    const asked = requests.filter((url) => url.pathname.endsWith('/v1/search/suggest'));
    expect(asked.map((url) => url.searchParams.get('q'))).toEqual(['sol']);
    expect(asked[0]?.searchParams.get('limit')).toBe('10');
    expect(screen.getByRole('button', { name: 'tag for sol, Tag' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'tag for so, Tag' })).toBeNull();
  });

  it('says what failed and that the text can still be searched', async () => {
    routes.suggest = () => Promise.reject(new TypeError('Network request failed'));
    await renderDiscover();
    await typeAndWait('sol');
    expect(screen.getByText(en.discovery.suggest.failedFallback)).toBeTruthy();
  });

  it('applies free text with the return key and moves a default sort to best match', async () => {
    await renderDiscover();
    await fireEvent(screen.getByLabelText(en.discovery.suggest.inputLabel), 'submitEditing', {
      nativeEvent: { text: 'solar' },
    });
    expect(lastSetParams()).toMatchObject({ q: 'solar', sort: undefined });
  });
});

describe('what a screen reader hears', () => {
  it('names the controls', async () => {
    mockParams = { status: 'live' };
    await renderDiscover();
    expect(screen.getByRole('button', { name: `${T.railLabel} (1)` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort by: Newest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Status filter: Live' })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.discovery.suggest.submit })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Solar Lamp, by Aysel' })).toBeTruthy();
  });

  it('offers best match only while there is a query', async () => {
    await renderDiscover();
    await fireEvent.press(screen.getByTestId('sort-control'));
    expect(screen.queryByRole('radio', { name: 'Best match' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Newest' })).toBeTruthy();
  });
});
