import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import SearchScreen from '../app/(tabs)/search';

/**
 * The Search tab — issue #153: no request without a query, results on submit and never as you
 * type, at most 24 with the count line and the way into the feed, a failure that says so with a
 * retry rather than "nothing matched", and the suggestions acting as they do on Discover.
 *
 * <p>Here rather than beside `app/(tabs)/search.tsx` because every file under `src/app` is a route.
 */

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string | undefined> = {};

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
    completionPercent: '40',
    pledged: { amount: '1000.00', currency: 'AZN' },
    backersCount: 3,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = (url: URL) => Response | Promise<Response>;
let routes: { search: Route; suggest: Route };
let requests: URL[];
let client: QueryClient;

beforeEach(() => {
  mockParams = {};
  mockPush.mockReset();
  mockSetParams.mockReset();
  requests = [];
  routes = {
    search: () => json({ items: [card('Solar Lamp', 0)] }),
    suggest: () => json({ items: [] }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/v1/search/suggest')) return routes.suggest(url);
    if (url.pathname.endsWith('/v1/search')) return routes.search(url);
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client.clear());

async function renderSearch() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <SearchScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const S = en.discovery.search;
const searches = () => requests.filter((url) => url.pathname.endsWith('/v1/search'));
const field = () => screen.getByLabelText(en.shell.search.label);

describe('the Search tab without a query', () => {
  it('sends no request and offers the feed', async () => {
    await renderSearch();
    expect(searches()).toHaveLength(0);
    expect(screen.getByRole('header')).toHaveTextContent(S.title);
    await fireEvent.press(screen.getByRole('link', { name: 'browse the whole feed' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
  });

  it('does not search as you type, and submits any non-empty text', async () => {
    await renderSearch();
    await fireEvent.changeText(field(), 'a');
    await settle(250);
    expect(searches()).toHaveLength(0);

    await fireEvent(field(), 'submitEditing', { nativeEvent: { text: 'a' } });
    expect(mockSetParams).toHaveBeenCalledWith({ q: 'a' });
  });
});

describe('the Search tab with a query', () => {
  it('asks for at most 24 and draws the count line, the results and the way into the feed', async () => {
    mockParams = { q: 'lamp' };
    await renderSearch();
    expect(searches()[0]?.searchParams.get('q')).toBe('lamp');
    expect(searches()[0]?.searchParams.get('limit')).toBe('24');
    expect(screen.getByRole('header')).toHaveTextContent('Results for “lamp”');
    expect(screen.getByText('1 campaign')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Solar Lamp, by Aysel' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: S.refineInFeed }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: { q: 'lamp' } });
  });

  it('says there is more in the feed when there is', async () => {
    mockParams = { q: 'lamp' };
    routes.search = () => json({ items: [card('Solar Lamp', 0)], nextCursor: 'next' });
    await renderSearch();
    expect(screen.getByText('1 campaign, with more in the feed')).toBeTruthy();
    expect(screen.getByRole('button', { name: S.moreInFeed })).toBeTruthy();
  });

  it('says a failure is a failure, with a retry — not "nothing matched"', async () => {
    mockParams = { q: 'lamp' };
    routes.search = () => Promise.reject(new TypeError('Network request failed'));
    await renderSearch();
    expect(screen.getByTestId('search-error')).toBeTruthy();
    expect(screen.queryByText('Nothing matched “lamp”')).toBeNull();

    routes.search = () => json({ items: [card('Back', 1)] });
    await fireEvent.press(screen.getByRole('button', { name: en.discovery.feed.tryAgain }));
    await settle();
    expect(screen.getByRole('link', { name: 'Back, by Aysel' })).toBeTruthy();
  });

  it('draws the empty state with a way into the feed', async () => {
    mockParams = { q: 'zzz' };
    routes.search = () => json({ items: [] });
    await renderSearch();
    expect(screen.getByText('Nothing matched “zzz”')).toBeTruthy();
    expect(screen.getByText('No campaigns matched')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: S.emptyAction }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
  });
});

describe('suggestions on the Search tab', () => {
  it('a tag opens Discover with that tag', async () => {
    routes.suggest = () => json({ items: [{ kind: 'tag', label: 'Handmade', slug: 'handmade' }] });
    await renderSearch();
    await fireEvent.changeText(field(), 'hand');
    await settle(250);
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Handmade, Tag' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover', params: { tag: 'handmade' } });
  });
});
